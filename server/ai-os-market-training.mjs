/* FinPilot AI OS market-learning worker.
 * It records only fresh provider-timestamped observations and scores a cautious,
 * non-executable momentum baseline against later matching observations. It does not
 * place orders, promote agents, modify source code, or train foundation-model weights.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import {recordAgentMemory} from './agent-memory-ledger.mjs';
const { Pool } = pg;

const VERSION='AIOS-MARKET-TRAINING-1.0';
const MODEL='MOMENTUM_BASELINE_V1';
const MAX_SYMBOLS=8, MAX_MEMORY_OBSERVATIONS=6000, MAX_MEMORY_FORECASTS=12000, MAX_EVENTS=80;
const MOVE_DEADBAND_PCT=0.5, MAX_QUOTE_AGE_MS=90000, FUTURE_TOLERANCE_MS=30000;
const clamp=(x,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(x))?Number(x):min));
const safeText=(value,max=80)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,max);
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const nowIso=()=>new Date().toISOString();
const hash=text=>createHash('sha256').update(String(text)).digest('hex');
const hasDatabase=env=>Boolean(String(env.DATABASE_URL||'').trim());
const isRequested=env=>String(env.FINPILOT_AI_OS_TRAINING_ENABLED||'false').toLowerCase()==='true';
const watchlistFor=env=>[...new Set(String(env.FINPILOT_AI_OS_TRAINING_WATCHLIST||'BTC,ETH,SPY,NIFTY').split(',').map(x=>safeText(x,32).toUpperCase()).filter(x=>/^[A-Z0-9][A-Z0-9._:+!-]{0,31}$/.test(x)))].slice(0,MAX_SYMBOLS);
const intervalFor=env=>clamp(Number(env.FINPILOT_AI_OS_TRAINING_INTERVAL_MS||900000),300000,3600000);

const state={
 env:process.env, loadSnapshot:null, clock:()=>Date.now(), pool:null, schemaReady:false, initPromise:null, timer:null,
 running:false, requestedEnabled:false, enabled:false, persistence:'UNINITIALIZED', persistent:false,
 persistenceDetail:'Market-learning storage has not initialized.', blockedReason:null, intervalMs:900000,
 watchlist:['BTC','ETH','SPY','NIFTY'], lastStartedAt:null, lastCompletedAt:null, lastSuccessAt:null,
 lastError:null, cycleCount:0,
 counters:{observationsStored:0,duplicateObservations:0,rejectedSnapshots:0,forecastsCreated:0,forecastsSettled:0,failedSymbols:0},
 observationKeys:new Set(), observations:[], forecasts:[], events:[]
};

function event(type,details={}){state.events.unshift({type,at:nowIso(),...details});state.events=state.events.slice(0,MAX_EVENTS);}
function average(rows,key){const values=rows.map(x=>Number(x[key])).filter(Number.isFinite);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
function finiteOrNull(value){return value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;}

export function normalizeSnapshot(requestedTicker,snapshot,nowMs=Date.now()){
 if(!snapshot||typeof snapshot!=='object')return {ok:false,reasons:['NO_SNAPSHOT']};
 const ticker=safeText(snapshot.ticker||requestedTicker,32).toUpperCase();
 const price=positive(snapshot.price);
 const asOfMs=snapshot.asOf?Date.parse(snapshot.asOf):NaN;
 const ageMs=Number.isFinite(asOfMs)?nowMs-asOfMs:null;
 const provider=safeText(snapshot.provider,100);
 const timestampType=safeText(snapshot.sourceTimestampType||'UNKNOWN_TIMESTAMP',48).toUpperCase();
 const reasons=[];
 if(ticker!==requestedTicker)reasons.push('TICKER_IDENTITY_MISMATCH');
 if(snapshot.verified!==true||snapshot.status!=='LIVE'||snapshot.stale===true)reasons.push('QUOTE_NOT_VERIFIED_LIVE');
 if(price===null)reasons.push('INVALID_PRICE');
 if(!Number.isFinite(asOfMs))reasons.push('PROVIDER_TIMESTAMP_REQUIRED');
 else {if(ageMs < -FUTURE_TOLERANCE_MS)reasons.push('PROVIDER_TIMESTAMP_IN_FUTURE');if(ageMs>MAX_QUOTE_AGE_MS)reasons.push('QUOTE_TOO_OLD');}
 if(!provider)reasons.push('PROVIDER_NAME_REQUIRED');
 if(timestampType==='UNKNOWN_TIMESTAMP')reasons.push('UNKNOWN_TIMESTAMP_TYPE');
 if(timestampType!=='PROVIDER_TIMESTAMP')reasons.push('PROVIDER_TIMESTAMP_PROVENANCE_REQUIRED');
 return {ok:reasons.length===0,reasons,observation:{
  ticker,price,
  changePct:Number.isFinite(Number(snapshot.changePct))?Number(snapshot.changePct):null,
  volume:Number.isFinite(Number(snapshot.volume))&&Number(snapshot.volume)>=0?Number(snapshot.volume):null,
  provider,sourceTimestampType:timestampType,sourceAsOf:Number.isFinite(asOfMs)?new Date(asOfMs).toISOString():null,
  capturedAt:nowIso(),ageMs,fingerprint:hash([ticker,asOfMs,price,provider].join('|')),payload:snapshot
 }};
}

function forecastProbabilities(history){
 const prices=history.map(x=>Number(x.price)).filter(x=>Number.isFinite(x)&&x>0);
 if(prices.length<3)return null;
 const returns=[];
 for(let i=1;i<prices.length;i++)returns.push((prices[i]/prices[i-1]-1)*100);
 const momentumPct=(prices[prices.length-1]/prices[0]-1)*100;
 const avgAbsStep=returns.length?returns.reduce((n,x)=>n+Math.abs(x),0)/returns.length:0;
 const threshold=Math.max(0.08,avgAbsStep*0.65),absMove=Math.abs(momentumPct);
 if(absMove<threshold)return {up:30,down:30,hold:40,signal:'NEUTRAL',momentumPct,sampleCount:prices.length};
 const conviction=clamp(42+(absMove-threshold)*3,42,55),signal=momentumPct>0?'UP':'DOWN';
 return {up:signal==='UP'?conviction:100-conviction-20,down:signal==='DOWN'?conviction:100-conviction-20,hold:20,signal,momentumPct,sampleCount:prices.length};
}
function outcomeForReturn(actualReturnPct){return actualReturnPct>MOVE_DEADBAND_PCT?'UP':actualReturnPct< -MOVE_DEADBAND_PCT?'DOWN':'HOLD';}
function score(probabilities,outcome){
 const p={UP:Number(probabilities.up)/100,DOWN:Number(probabilities.down)/100,HOLD:Number(probabilities.hold)/100};
 const keys=['UP','DOWN','HOLD'];
 const brierScore=keys.reduce((sum,key)=>sum+(p[key]-(outcome===key?1:0))**2,0);
 const logLoss=-Math.log(Math.max(1e-6,p[outcome]));
 const predictedOutcome=[...keys].sort((a,b)=>p[b]-p[a])[0];
 return {brierScore:Number(brierScore.toFixed(8)),logLoss:Number(logLoss.toFixed(8)),predictedOutcome,correctTopClass:predictedOutcome===outcome};
}

async function initializeStorage(){
 if(state.initPromise)return state.initPromise;
 state.initPromise=(async()=>{
  if(!hasDatabase(state.env)){
   state.persistence='PROCESS_MEMORY';state.persistent=false;
   state.persistenceDetail='DATABASE_URL is not configured. Market observations and forecasts cannot survive a restart.';
   return;
  }
  try{
   state.pool=new Pool({connectionString:state.env.DATABASE_URL,ssl:state.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:2,idleTimeoutMillis:15000,connectionTimeoutMillis:1800});
   await state.pool.query('CREATE TABLE IF NOT EXISTS finpilot_ai_os_market_observations (fingerprint TEXT PRIMARY KEY,ticker TEXT NOT NULL,price DOUBLE PRECISION NOT NULL,change_pct DOUBLE PRECISION,volume DOUBLE PRECISION,provider TEXT NOT NULL,source_timestamp_type TEXT NOT NULL,source_as_of TIMESTAMPTZ NOT NULL,captured_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL)');
   await state.pool.query('CREATE INDEX IF NOT EXISTS finpilot_ai_os_market_obs_ticker_time_idx ON finpilot_ai_os_market_observations(ticker,source_as_of DESC)');
   await state.pool.query('CREATE TABLE IF NOT EXISTS finpilot_ai_os_market_forecasts (id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,ticker TEXT NOT NULL,model_name TEXT NOT NULL,reference_price DOUBLE PRECISION NOT NULL,reference_as_of TIMESTAMPTZ NOT NULL,horizon_minutes INTEGER NOT NULL,due_at TIMESTAMPTZ NOT NULL,p_up DOUBLE PRECISION NOT NULL,p_down DOUBLE PRECISION NOT NULL,p_hold DOUBLE PRECISION NOT NULL,signal TEXT NOT NULL,sample_count INTEGER NOT NULL,momentum_pct DOUBLE PRECISION NOT NULL,status TEXT NOT NULL DEFAULT \'PENDING_OUTCOME\',outcome TEXT,actual_return_pct DOUBLE PRECISION,brier_score DOUBLE PRECISION,log_loss DOUBLE PRECISION,predicted_outcome TEXT,correct_top_class BOOLEAN,settled_at TIMESTAMPTZ,settlement_source_as_of TIMESTAMPTZ,settlement_provider TEXT,created_at TIMESTAMPTZ NOT NULL)');
   await state.pool.query('CREATE INDEX IF NOT EXISTS finpilot_ai_os_forecasts_due_idx ON finpilot_ai_os_market_forecasts(ticker,status,due_at)');
   const [observations,forecasts]=await Promise.all([
    state.pool.query('SELECT COUNT(*)::int AS n FROM finpilot_ai_os_market_observations'),
    state.pool.query('SELECT COUNT(*)::int AS n,COUNT(*) FILTER (WHERE status=\'RESOLVED\')::int AS resolved,COUNT(*) FILTER (WHERE status=\'PENDING_OUTCOME\')::int AS pending FROM finpilot_ai_os_market_forecasts')
   ]);
   state.counters.observationsStored=Number(observations.rows[0]?.n||0);
   state.counters.forecastsCreated=Number(forecasts.rows[0]?.n||0);
   state.counters.forecastsSettled=Number(forecasts.rows[0]?.resolved||0);
   state.schemaReady=true;state.persistence='POSTGRES';state.persistent=true;
   state.persistenceDetail='Market observations and scored baseline forecasts are persisted in PostgreSQL.';
  }catch(error){
   try{await state.pool?.end();}catch{}
   state.pool=null;state.schemaReady=false;state.persistence='DATABASE_ERROR';state.persistent=false;
   state.persistenceDetail='PostgreSQL is configured but training storage initialization failed: '+safeText(error?.message||'database unavailable',120);
  }
 })();
 return state.initPromise;
}

async function getHistory(ticker,limit=8){
 if(state.pool&&state.schemaReady&&state.persistence==='POSTGRES'){
  const result=await state.pool.query('SELECT price,source_as_of AS "sourceAsOf",provider FROM finpilot_ai_os_market_observations WHERE ticker=$1 ORDER BY source_as_of DESC LIMIT $2',[ticker,limit]);
  return result.rows.reverse();
 }
 return state.observations.filter(x=>x.ticker===ticker).slice(-limit).map(x=>({price:x.price,sourceAsOf:x.sourceAsOf,provider:x.provider}));
}
async function saveObservation(o){
 if(state.pool&&state.schemaReady&&state.persistence==='POSTGRES'){
  const result=await state.pool.query('INSERT INTO finpilot_ai_os_market_observations(fingerprint,ticker,price,change_pct,volume,provider,source_timestamp_type,source_as_of,captured_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (fingerprint) DO NOTHING RETURNING fingerprint',[o.fingerprint,o.ticker,o.price,o.changePct,o.volume,o.provider,o.sourceTimestampType,o.sourceAsOf,o.capturedAt,JSON.stringify(o.payload)]);
  return Boolean(result.rowCount);
 }
 if(state.observationKeys.has(o.fingerprint))return false;
 state.observationKeys.add(o.fingerprint);state.observations.push(o);
 if(state.observations.length>MAX_MEMORY_OBSERVATIONS){
  const removed=state.observations.splice(0,state.observations.length-MAX_MEMORY_OBSERVATIONS);
  for(const row of removed)state.observationKeys.delete(row.fingerprint);
 }
 return true;
}
async function settleDue(ticker,o){
 const rows=state.pool&&state.schemaReady&&state.persistence==='POSTGRES'
  ?(await state.pool.query('SELECT * FROM finpilot_ai_os_market_forecasts WHERE ticker=$1 AND status=$2 AND due_at<=$3 AND reference_as_of<$3 ORDER BY due_at ASC LIMIT 100',[ticker,'PENDING_OUTCOME',o.sourceAsOf])).rows
  :state.forecasts.filter(x=>x.ticker===ticker&&x.status==='PENDING_OUTCOME'&&Date.parse(x.dueAt)<=Date.parse(o.sourceAsOf)&&Date.parse(x.referenceAsOf)<Date.parse(o.sourceAsOf)).slice(0,100);
 let settled=0;
 for(const row of rows){
  const refPrice=Number(row.reference_price??row.referencePrice),actualReturnPct=(o.price/refPrice-1)*100;
  if(!(Number.isFinite(actualReturnPct)&&refPrice>0))continue;
  const outcome=outcomeForReturn(actualReturnPct);
  const scored=score({up:Number(row.p_up??row.pUp),down:Number(row.p_down??row.pDown),hold:Number(row.p_hold??row.pHold)},outcome);
  const settledAt=nowIso();
  if(state.pool&&state.schemaReady&&state.persistence==='POSTGRES'){
   await state.pool.query('UPDATE finpilot_ai_os_market_forecasts SET status=$1,outcome=$2,actual_return_pct=$3,brier_score=$4,log_loss=$5,predicted_outcome=$6,correct_top_class=$7,settled_at=$8,settlement_source_as_of=$9,settlement_provider=$10 WHERE id=$11 AND status=$12',['RESOLVED',outcome,actualReturnPct,scored.brierScore,scored.logLoss,scored.predictedOutcome,scored.correctTopClass,settledAt,o.sourceAsOf,o.provider,row.id,'PENDING_OUTCOME']);
  }else{
   Object.assign(row,{status:'RESOLVED',outcome,actualReturnPct,brierScore:scored.brierScore,logLoss:scored.logLoss,predictedOutcome:scored.predictedOutcome,correctTopClass:scored.correctTopClass,settledAt,settlementSourceAsOf:o.sourceAsOf,settlementProvider:o.provider});
  }
  try{
   const horizonMinutes=Number(row.horizon_minutes??row.horizonMinutes);
   await recordAgentMemory({
    agent:'Forecast Outcome Evaluator',
    layer:'OUTCOME',
    source:'VERIFIED_OUTCOME',
    content:`${ticker} ${horizonMinutes}-minute baseline forecast resolved as ${outcome}; actual return ${actualReturnPct.toFixed(4)}% from ${o.provider} timestamped data.`,
    decision:`Predicted class ${scored.predictedOutcome}; realized class ${outcome}; Brier ${scored.brierScore}; log loss ${scored.logLoss}.`,
    observedAt:settledAt,
    metadata:{
     domain:'forecast calibration',outcome,horizonMinutes,
     provider:o.provider,sourceAsOf:o.sourceAsOf,settledAt,
     decisionId:String(row.id),modelVersion:String(row.model_name??row.modelName??MODEL),
     referencePrice:refPrice,actualReturnPct,
     brierScore:scored.brierScore,logLoss:scored.logLoss,
     pUp:Number(row.p_up??row.pUp),pDown:Number(row.p_down??row.pDown),pHold:Number(row.p_hold??row.pHold)
    }
   });
  }catch{}
  settled++;
 }
 state.counters.forecastsSettled+=settled;return settled;
}
async function saveForecast(ticker,o,history){
 const prediction=forecastProbabilities(history);
 if(!prediction)return false;
 const horizonMinutes=clamp(Number(state.env.FINPILOT_AI_OS_FORECAST_HORIZON_MINUTES||60),15,240);
 const createdAt=nowIso(),fingerprint=hash([ticker,MODEL,o.sourceAsOf,horizonMinutes].join('|'));
 const forecast={id:'aif_'+fingerprint.slice(0,24),fingerprint,ticker,modelName:MODEL,referencePrice:o.price,referenceAsOf:o.sourceAsOf,horizonMinutes,dueAt:new Date(Date.parse(o.sourceAsOf)+horizonMinutes*60000).toISOString(),pUp:prediction.up,pDown:prediction.down,pHold:prediction.hold,signal:prediction.signal,sampleCount:prediction.sampleCount,momentumPct:prediction.momentumPct,status:'PENDING_OUTCOME',createdAt,outcome:null,actualReturnPct:null};
 if(state.pool&&state.schemaReady&&state.persistence==='POSTGRES'){
  const result=await state.pool.query('INSERT INTO finpilot_ai_os_market_forecasts(id,fingerprint,ticker,model_name,reference_price,reference_as_of,horizon_minutes,due_at,p_up,p_down,p_hold,signal,sample_count,momentum_pct,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (fingerprint) DO NOTHING RETURNING id',[forecast.id,forecast.fingerprint,forecast.ticker,forecast.modelName,forecast.referencePrice,forecast.referenceAsOf,forecast.horizonMinutes,forecast.dueAt,forecast.pUp,forecast.pDown,forecast.pHold,forecast.signal,forecast.sampleCount,forecast.momentumPct,forecast.status,forecast.createdAt]);
  if(!result.rowCount)return false;
 }else{
  if(state.forecasts.some(x=>x.fingerprint===forecast.fingerprint))return false;
  state.forecasts.push(forecast);
  if(state.forecasts.length>MAX_MEMORY_FORECASTS)state.forecasts.length=MAX_MEMORY_FORECASTS;
 }
 state.counters.forecastsCreated++;event('FORECAST_CREATED',{ticker,id:forecast.id,signal:forecast.signal,horizonMinutes});return true;
}
function markStorageError(error){
 state.persistence='DATABASE_ERROR';state.persistent=false;
 state.persistenceDetail='PostgreSQL write/read failed: '+safeText(error?.message||'storage unavailable',120);
 state.lastError=state.persistenceDetail;
 state.enabled=false;
 if(state.timer){clearInterval(state.timer);state.timer=null;}
}

async function processTicker(ticker,snapshot,nowMs){
 if(state.persistence==='DATABASE_ERROR')return {ticker,accepted:false,error:'TRAINING_STORAGE_UNAVAILABLE'};
 const checked=normalizeSnapshot(ticker,snapshot,nowMs);
 if(!checked.ok){state.counters.rejectedSnapshots++;return {ticker,accepted:false,reasons:checked.reasons};}
 const o=checked.observation;
 let isNew;
 try{isNew=await saveObservation(o);}catch(error){markStorageError(error);throw error;}
 if(!isNew){state.counters.duplicateObservations++;return {ticker,accepted:true,duplicate:true,forecastCreated:false,settled:0};}
 state.counters.observationsStored++;
 try{
  const settled=await settleDue(ticker,o),history=await getHistory(ticker,8),forecastCreated=await saveForecast(ticker,o,history);
  event('MARKET_OBSERVATION_ACCEPTED',{ticker,provider:o.provider,asOf:o.sourceAsOf,settled,forecastCreated});
  return {ticker,accepted:true,duplicate:false,forecastCreated,settled,provider:o.provider,asOf:o.sourceAsOf};
 }catch(error){markStorageError(error);throw error;}
}

export async function initializeAIOSMarketTrainingDirector(options={}){
 if(typeof options.loadSnapshot==='function')state.loadSnapshot=options.loadSnapshot;
 if(typeof options.clock==='function')state.clock=options.clock;
 if(options.env&&typeof options.env==='object')state.env=options.env;
 state.requestedEnabled=isRequested(state.env);state.intervalMs=intervalFor(state.env);state.watchlist=watchlistFor(state.env);
 await initializeStorage();
 state.enabled=state.requestedEnabled&&state.persistent&&state.schemaReady&&typeof state.loadSnapshot==='function';
 state.blockedReason=state.requestedEnabled&&!state.persistent?'PERSISTENT_STORAGE_REQUIRED':state.requestedEnabled&&typeof state.loadSnapshot!=='function'?'MARKET_SNAPSHOT_ADAPTER_REQUIRED':state.requestedEnabled&&!state.schemaReady?'TRAINING_STORAGE_NOT_READY':null;
 if(state.enabled){
  if(state.timer)clearInterval(state.timer);
  state.timer=setInterval(()=>{runAIOSMarketTrainingCycle({trigger:'scheduled'}).catch(()=>{});},state.intervalMs);
  state.timer.unref?.();
 }
 return getAIOSMarketTrainingStatus();
}

export async function runAIOSMarketTrainingCycle(options={}){
 await initializeStorage();
 if(state.running)return {ok:false,error:'TRAINING_CYCLE_ALREADY_RUNNING',status:await getAIOSMarketTrainingStatus()};
 if(typeof state.loadSnapshot!=='function')return {ok:false,error:'MARKET_SNAPSHOT_ADAPTER_REQUIRED'};
 state.running=true;state.lastStartedAt=nowIso();state.cycleCount++;
 const result={ok:true,version:VERSION,cycle:state.cycleCount,trigger:safeText(options.trigger||'manual',40),startedAt:state.lastStartedAt,watchlist:[...state.watchlist],symbols:[],summary:{}};
 try{
  for(const ticker of state.watchlist){
   if(state.persistence==='DATABASE_ERROR'){result.symbols.push({ticker,accepted:false,error:'TRAINING_STORAGE_UNAVAILABLE'});continue;}
   try{const snapshot=await state.loadSnapshot(ticker);result.symbols.push(await processTicker(ticker,snapshot,Number(state.clock())));}
   catch(error){state.counters.failedSymbols++;state.lastError=safeText(error?.message||error,160);result.symbols.push({ticker,accepted:false,error:state.lastError});}
  }
  const successful=result.symbols.filter(x=>x.accepted===true&&!x.duplicate).length;
  const anyFetchError=result.symbols.some(x=>x.error);
  state.lastCompletedAt=nowIso();
  if(successful>0)state.lastSuccessAt=state.lastCompletedAt;
  if(anyFetchError)state.lastError=result.symbols.find(x=>x.error)?.error||state.lastError;
  else if(successful>0&&state.persistence!=='DATABASE_ERROR')state.lastError=null;
  result.completedAt=state.lastCompletedAt;
  result.summary={accepted:successful,duplicates:result.symbols.filter(x=>x.duplicate).length,rejected:result.symbols.filter(x=>x.accepted===false&&!x.error).length,forecastsCreated:result.symbols.filter(x=>x.forecastCreated).length,forecastsSettled:result.symbols.reduce((n,x)=>n+Number(x.settled||0),0),failedSymbols:result.symbols.filter(x=>x.error).length,persistence:state.persistence,persistent:state.persistent,automaticExecution:false};
  event('TRAINING_CYCLE_COMPLETED',{cycle:result.cycle,trigger:result.trigger,summary:result.summary});
  return result;
 }catch(error){
  state.lastError=safeText(error?.message||error,160);event('TRAINING_CYCLE_FAILED',{cycle:result.cycle,error:state.lastError});
  return {ok:false,version:VERSION,cycle:result.cycle,error:state.lastError};
 }finally{state.running=false;}
}

const OUTCOME_CLASSES = ['UP','DOWN','HOLD'];
const UNIFORM_BRIER = 2/3;
const UNIFORM_LOG_LOSS = Math.log(3);

function rowValue(row, ...keys) {
 for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
 return undefined;
}
function normalizedOutcomeRow(row) {
 const outcome=String(rowValue(row,'outcome')||'').toUpperCase();
 const pUp=Number(rowValue(row,'pUp','p_up'));
 const pDown=Number(rowValue(row,'pDown','p_down'));
 const pHold=Number(rowValue(row,'pHold','p_hold'));
 const sum=pUp+pDown+pHold;
 if(!OUTCOME_CLASSES.includes(outcome)||![pUp,pDown,pHold].every(Number.isFinite)||
    [pUp,pDown,pHold].some(x=>x<0||x>100)||Math.abs(sum-100)>0.05)return null;
 const referenceAt=Date.parse(String(rowValue(row,'referenceAsOf','reference_as_of','createdAt','created_at')||''));
 const settledAt=Date.parse(String(rowValue(row,'settledAt','settled_at')||''));
 if(!Number.isFinite(referenceAt)||!Number.isFinite(settledAt)||settledAt<referenceAt)return null;
 return {
  id:String(rowValue(row,'id')||''),
  ticker:String(rowValue(row,'ticker')||'').toUpperCase(),
  modelName:String(rowValue(row,'modelName','model_name')||MODEL),
  outcome,pUp,pDown,pHold,referenceAt,settledAt
 };
}
function scoreProbabilityVector(probabilities,outcome) {
 const p=probabilities.map(x=>Number(x)/100);
 const brier=OUTCOME_CLASSES.reduce((sum,label,i)=>sum+(p[i]-(outcome===label?1:0))**2,0);
 const logLoss=-Math.log(Math.max(1e-6,p[OUTCOME_CLASSES.indexOf(outcome)]));
 const predicted=OUTCOME_CLASSES.reduce((best,label,i)=>p[i]>p[OUTCOME_CLASSES.indexOf(best)]?label:best,OUTCOME_CLASSES[0]);
 return {brier,logLoss,correct:predicted===outcome,predicted};
}
function aggregateBenchmarkScores(rows) {
 if(!rows.length)return {count:0,meanBrier:null,meanLogLoss:null,topClassAccuracyPct:null};
 return {
  count:rows.length,
  meanBrier:Number((rows.reduce((n,x)=>n+x.brier,0)/rows.length).toFixed(6)),
  meanLogLoss:Number((rows.reduce((n,x)=>n+x.logLoss,0)/rows.length).toFixed(6)),
  topClassAccuracyPct:Number((rows.filter(x=>x.correct).length/rows.length*100).toFixed(2))
 };
}

/**
 * Evaluates the deterministic forecast probabilities against a uniform baseline and a
 * chronology-safe, Laplace-smoothed prior built only from forecasts settled before each
 * prediction's reference timestamp. This is an evaluation report, not a training step.
 */
export function evaluateForecastBenchmarks(inputRows=[], options={}) {
 const minimumPriorOutcomes=Math.max(3,Math.floor(Number(options.minimumPriorOutcomes)||5));
 const minimumForModelSelection=Math.max(30,Math.floor(Number(options.minimumForModelSelection)||100));
 const rows=(Array.isArray(inputRows)?inputRows:[])
  .map(normalizedOutcomeRow).filter(Boolean)
  .sort((a,b)=>a.referenceAt-b.referenceAt||a.settledAt-b.settledAt);
 const seen=new Set();
 const unique=rows.filter(row=>{
  const key=row.id||[row.ticker,row.referenceAt,row.pUp,row.pDown,row.pHold,row.outcome].join('|');
  if(seen.has(key))return false;seen.add(key);return true;
 });
 const modelScores=[];
 const uniformScores=[];
 const priorScores=[];
 const classCounts={UP:0,DOWN:0,HOLD:0};
 for(const row of unique) {
  const model=scoreProbabilityVector([row.pUp,row.pDown,row.pHold],row.outcome);
  const uniform=scoreProbabilityVector([100/3,100/3,100/3],row.outcome);
  modelScores.push(model);
  uniformScores.push(uniform);
  classCounts[row.outcome]++;

  const prior=unique.filter(other=>other.id!==row.id&&other.settledAt<row.referenceAt);
  if(prior.length>=minimumPriorOutcomes) {
   const counts={UP:1,DOWN:1,HOLD:1};
   for(const earlier of prior)counts[earlier.outcome]++;
   const total=prior.length+3;
   const probabilities=OUTCOME_CLASSES.map(label=>counts[label]/total*100);
   priorScores.push(scoreProbabilityVector(probabilities,row.outcome));
  }
 }
 const model=aggregateBenchmarkScores(modelScores);
 const uniform=aggregateBenchmarkScores(uniformScores);
 const rollingPrior=aggregateBenchmarkScores(priorScores);
 const brierSkillPct=model.meanBrier===null?null:Number(((uniform.meanBrier-model.meanBrier)/uniform.meanBrier*100).toFixed(2));
 const logLossSkillPct=model.meanLogLoss===null?null:Number(((uniform.meanLogLoss-model.meanLogLoss)/uniform.meanLogLoss*100).toFixed(2));
 const modelUnderperformsUniform=model.count>0&&model.meanBrier!==null&&model.meanLogLoss!==null&&
  (model.meanBrier>uniform.meanBrier||model.meanLogLoss>uniform.meanLogLoss);
 // Compare the current model to the rolling prior on exactly the same eligible forecast rows.
 const priorEligibleRows=unique.filter(row=>{
  const prior=unique.filter(other=>other.id!==row.id&&other.settledAt<row.referenceAt);
  return prior.length>=minimumPriorOutcomes;
 });
 const sameSetModel=aggregateBenchmarkScores(priorEligibleRows.map(row=>scoreProbabilityVector([row.pUp,row.pDown,row.pHold],row.outcome)));
 const rollingSkills={
  model:sameSetModel,
  baseline:rollingPrior,
  brierSkillPct:sameSetModel.meanBrier===null||rollingPrior.meanBrier===null||rollingPrior.meanBrier===0?null:Number(((rollingPrior.meanBrier-sameSetModel.meanBrier)/rollingPrior.meanBrier*100).toFixed(2)),
  logLossSkillPct:sameSetModel.meanLogLoss===null||rollingPrior.meanLogLoss===null||rollingPrior.meanLogLoss===0?null:Number(((rollingPrior.meanLogLoss-sameSetModel.meanLogLoss)/rollingPrior.meanLogLoss*100).toFixed(2)),
  sampleCount:Math.min(sameSetModel.count,rollingPrior.count)
 };
 let modelSelectionStatus='INSUFFICIENT_OUTCOMES_FOR_MODEL_SELECTION';
 let reason='At least '+minimumForModelSelection+' verified resolved forecasts are required before model-selection review.';
 if(model.count>=minimumForModelSelection) {
  if(modelUnderperformsUniform) {
   modelSelectionStatus='UNDERPERFORMS_UNIFORM_BASELINE';
   reason='Current probabilities underperform a uniform baseline on Brier score or log loss; do not promote this model.';
  } else if(rollingSkills.sampleCount<minimumForModelSelection) {
   modelSelectionStatus='NEEDS_MORE_CHRONOLOGICAL_HOLDOUTS';
   reason='Uniform baseline comparison is available, but the rolling-prior holdout sample is still too small for model selection.';
  } else if((rollingSkills.brierSkillPct??-Infinity)>0&&(rollingSkills.logLossSkillPct??-Infinity)>0) {
   modelSelectionStatus='OUTPERFORMS_NAIVE_BASELINES_NEEDS_REVIEW';
   reason='Candidate beats both baselines in this evaluation, but still requires a frozen holdout, calibration review and human approval.';
  } else {
   modelSelectionStatus='NOT_BETTER_THAN_ROLLING_PRIOR';
   reason='Candidate does not beat the chronology-safe rolling-prior baseline on both proper scoring rules.';
  }
 }
 return {
  version:'FORECAST-BASELINE-BENCHMARK-1.0.0',
  evaluatedForecasts:model.count,
  classCounts,
  currentModel:model,
  uniformBaseline:{...uniform,description:'Equal 33.33% probability for UP, DOWN and HOLD.'},
  currentVsUniform:{brierSkillPct,logLossSkillPct,underperforms:modelUnderperformsUniform},
  rollingPriorBaseline:rollingPrior,
  currentVsRollingPrior:rollingSkills,
  rollingPriorMinPreviousSettledOutcomes:minimumPriorOutcomes,
  modelSelectionStatus,reason,
  minimumOutcomesForModelSelection:minimumForModelSelection,
  probabilitiesCalibrated:false,
  promotionEligible:false,
  automaticPromotion:false,
  note:'Benchmarks diagnose forecast quality only. No weights, probabilities, or model versions are changed automatically.'
 };
}

export async function getAIOSMarketTrainingStatus(){
 await initializeStorage();
 let totals;
 try{
  totals=state.pool&&state.schemaReady&&state.persistence==='POSTGRES'
   ?(await state.pool.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status=\'PENDING_OUTCOME\')::int AS pending,COUNT(*) FILTER (WHERE status=\'RESOLVED\')::int AS resolved,AVG(brier_score) FILTER (WHERE status=\'RESOLVED\') AS mean_brier,AVG(log_loss) FILTER (WHERE status=\'RESOLVED\') AS mean_log_loss,COUNT(*) FILTER (WHERE status=\'RESOLVED\' AND correct_top_class)::int AS correct FROM finpilot_ai_os_market_forecasts')).rows[0]
   :{total:state.forecasts.length,pending:state.forecasts.filter(x=>x.status==='PENDING_OUTCOME').length,resolved:state.forecasts.filter(x=>x.status==='RESOLVED').length,mean_brier:average(state.forecasts.filter(x=>x.status==='RESOLVED'),'brierScore'),mean_log_loss:average(state.forecasts.filter(x=>x.status==='RESOLVED'),'logLoss'),correct:state.forecasts.filter(x=>x.status==='RESOLVED'&&x.correctTopClass).length};
 }catch(error){markStorageError(error);totals={total:state.forecasts.length,pending:state.forecasts.filter(x=>x.status==='PENDING_OUTCOME').length,resolved:state.forecasts.filter(x=>x.status==='RESOLVED').length,mean_brier:null,mean_log_loss:null,correct:0};}
 const resolved=Number(totals.resolved||0);
 let benchmarkRows=[],benchmarkLoadError=null;
 try {
  benchmarkRows=state.pool&&state.schemaReady&&state.persistence==='POSTGRES'
   ?(await state.pool.query(`SELECT id,ticker,model_name AS "modelName",reference_as_of AS "referenceAsOf",horizon_minutes AS "horizonMinutes",p_up AS "pUp",p_down AS "pDown",p_hold AS "pHold",outcome,actual_return_pct AS "actualReturnPct",brier_score AS "brierScore",log_loss AS "logLoss",predicted_outcome AS "predictedOutcome",settled_at AS "settledAt",created_at AS "createdAt" FROM finpilot_ai_os_market_forecasts WHERE status='RESOLVED' ORDER BY reference_as_of DESC LIMIT 1000`)).rows.reverse()
   :state.forecasts.filter(x=>x.status==='RESOLVED').slice(-1000);
 } catch(error) {
  benchmarkLoadError=safeText(error?.message||'Forecast benchmark records unavailable',180);
 }
 const benchmark=evaluateForecastBenchmarks(benchmarkRows);
 if(benchmarkLoadError) {
  benchmark.modelSelectionStatus='BENCHMARK_DATA_UNAVAILABLE';
  benchmark.reason='Forecast benchmark records could not be loaded: '+benchmarkLoadError;
  benchmark.promotionEligible=false;
 }
 return {
  ok:true,version:VERSION,model:MODEL,enabled:state.enabled,requestedEnabled:state.requestedEnabled,running:state.running,
  intervalMs:state.intervalMs,watchlist:[...state.watchlist],persistence:state.persistence,persistent:state.persistent,
  persistenceDetail:state.persistenceDetail,blockedReason:state.blockedReason,lastStartedAt:state.lastStartedAt,
  lastCompletedAt:state.lastCompletedAt,lastSuccessAt:state.lastSuccessAt,lastError:state.lastError,cycleCount:state.cycleCount,
  counters:{...state.counters},observationCount:state.counters.observationsStored,forecastCount:Number(totals.total||0),
  pendingForecastCount:Number(totals.pending||0),resolvedForecastCount:resolved,
  meanBrierScore:finiteOrNull(totals.mean_brier),meanLogLoss:finiteOrNull(totals.mean_log_loss),
  topClassAccuracyPct:resolved?Number((Number(totals.correct||0)/resolved*100).toFixed(2)):null,
  benchmark,calibrationStatus:resolved<100?'INSUFFICIENT_RESOLVED_OUTCOMES':benchmark.modelSelectionStatus,
  probabilitiesCalibrated:false,foundationModelTraining:false,realMoneyExecution:false,automaticPromotion:false,
  nextRunAt:state.enabled&&state.lastCompletedAt?new Date(Date.parse(state.lastCompletedAt)+state.intervalMs).toISOString():state.enabled?new Date(Date.now()+state.intervalMs).toISOString():null,
  requiresAlwaysOnWorkerFor24x7:true,scheduleMode:state.enabled?'IN_PROCESS_INTERVAL_REQUIRES_ALWAYS_ON_HOST':'IN_PROCESS_INTERVAL_DISABLED_EXTERNAL_TRIGGER_SUPPORTED',
  recentEvents:state.events.slice(0,12)
 };
}

export async function resetAIOSMarketTrainingForTests(){
 if(state.timer)clearInterval(state.timer);try{await state.pool?.end();}catch{}
 Object.assign(state,{env:{},loadSnapshot:null,clock:()=>Date.now(),pool:null,schemaReady:false,initPromise:null,timer:null,running:false,requestedEnabled:false,enabled:false,persistence:'UNINITIALIZED',persistent:false,persistenceDetail:'Test registry reset.',blockedReason:null,intervalMs:900000,watchlist:['BTC','ETH','SPY','NIFTY'],lastStartedAt:null,lastCompletedAt:null,lastSuccessAt:null,lastError:null,cycleCount:0,counters:{observationsStored:0,duplicateObservations:0,rejectedSnapshots:0,forecastsCreated:0,forecastsSettled:0,failedSymbols:0},observationKeys:new Set(),observations:[],forecasts:[],events:[]});
}
