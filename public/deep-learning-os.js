/* FinPilot Deep Learning OS
   Adaptive, auditable learning layer for every agent.
   This is an online learning/calibration system, not a claim of training a foundation model.
   It learns from FinPilot outcomes, evidence quality and agent disagreement while keeping
   high-impact actions approval-gated.
*/
(function(){
'use strict';
const VERSION='DLO-1.1';
const KEY='finpilot_deep_learning_v1';
const AGENTS=['CEO','CFO','Risk','Judge','Market','Portfolio','Budget','Goals','Debt','Research','Investment','Markets','Tax','Security','Business','Assets','RedTeam'];
const FEATURES=['evidence','freshness','sentiment','market','risk','liquidity','disagreement','dataDepth','marketDataQuality','marketMomentum'];
const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
function load(){
  let loaded;
  try{loaded=JSON.parse(localStorage.getItem(KEY)||'null')}catch{loaded=null}
  const s=loaded&&typeof loaded==='object'?loaded:{};
  s.version=VERSION;s.runs=Number.isFinite(Number(s.runs))?Number(s.runs):0;
  s.events=Array.isArray(s.events)?s.events:[];s.outcomes=Array.isArray(s.outcomes)?s.outcomes:[];
  s.weights=s.weights&&typeof s.weights==='object'?s.weights:{};
  s.agents=s.agents&&typeof s.agents==='object'?s.agents:{};
  s.forecasts=Array.isArray(s.forecasts)?s.forecasts:[];
  s.blockedForecastAttempts=Math.max(0,Number(s.blockedForecastAttempts)||0);
  return s;
}
function save(x){try{localStorage.setItem(KEY,JSON.stringify(x))}catch{}}
function ensureAgent(s,name){
  if(!s.agents[name])s.agents[name]={runs:0,correct:0,accuracy:null,confidenceSum:0,calibration:0,weights:{}};
  const a=s.agents[name];
  FEATURES.forEach(f=>{if(!Number.isFinite(Number(a.weights[f])))a.weights[f]=1});
  return a;
}
function features(state,web,marketSnapshot){
  const ev=Array.isArray(state?.evidence)?state.evidence.length:0;
  const tx=Array.isArray(state?.transactions)?state.transactions.length:0;
  const reserve=Number(state?.emergency||0)/Math.max(1,Number(state?.spending||0));
  const free=Number(state?.income||0)-Number(state?.spending||0);
  const text=(Array.isArray(state?.evidence)?state.evidence.slice(0,12):[]).map(e=>String(e.claim||'')).join(' ').toLowerCase();
  const positive=(text.match(/\b(gain|rise|bullish|growth|profit|strong|beat|award|deal|contract)\b/g)||[]).length;
  const negative=(text.match(/\b(fall|drop|bearish|loss|risk|warning|downgrade|debt|default|weak)\b/g)||[]).length;
  const snapshot=marketSnapshot||state?.marketSnapshot||null;
  const quality=snapshot?.quality||{};
  const quote=snapshot?.quote||{};
  const change=Number(quote.changePct);
  const validChange=Number.isFinite(change);
  const verified=quality.forecastEligible===true;
  const dataQuality=!snapshot?10:verified?100:quality.status==='DELAYED'?30:quality.status==='STALE'?5:15;
  const marketMomentum=verified&&validChange?clamp(50+Math.max(-10,Math.min(10,change))*2):50;
  const existingMarket=50+(web?.stance==='Positive'?18:web?.stance==='Cautious'?-18:0);
  return {
    evidence:clamp(45+ev*4),
    freshness:snapshot?(verified?100:quality.status==='STALE'?5:30):clamp(state?.lastEvidenceSync?75:35),
    sentiment:clamp(50+(positive-negative)*5+(web?.stance==='Positive'?12:web?.stance==='Cautious'?-12:0)),
    market:clamp(verified&&validChange?50+Math.max(-5,Math.min(5,change))*4:existingMarket),
    risk:clamp(75-(reserve<3?25:0)-(free<0?25:0)),
    liquidity:clamp(50+(reserve-3)*9+(free>0?12:-18)),
    disagreement:clamp(85),
    dataDepth:clamp(tx*4+ev*3),
    marketDataQuality:clamp(dataQuality),
    marketMomentum:clamp(marketMomentum)
  };
}
function weighted(a,f){
  let sum=0,den=0;FEATURES.forEach(k=>{const w=Number(a.weights[k]||1);sum+=Number(f[k]||0)*w;den+=Math.abs(w)});
  return den?clamp(sum/den):50;
}
function resolveCandidate(query,search,web){
  const q=String(query||'').toUpperCase();
  const catalog=[
    ['NIFTY','Nifty 50'],['BANKNIFTY','Nifty Bank'],['FINNIFTY','Nifty Financial Services'],['SENSEX','BSE Sensex'],
    ['TCS','Tata Consultancy Services'],['INFY','Infosys'],['RELIANCE','Reliance Industries'],['GAIL','GAIL (India)'],
    ['HINDZINC','Hindustan Zinc'],['ITC','ITC'],['TATAPOWER','Tata Power'],['TATASTEEL','Tata Steel'],
    ['SUNPHARMA','Sun Pharmaceutical'],['TRENT','Trent'],['TECHM','Tech Mahindra'],['HCLTECH','HCLTech'],
    ['INDIGO','InterGlobe Aviation'],['JUBLFOOD','Jubilant FoodWorks'],['SENCO','Senco Gold'],
    ['PAYTM','One97 Communications'],['IRFC','Indian Railway Finance Corporation'],['SBIN','State Bank of India'],['AXISBANK','Axis Bank Limited'],
    ['HDFCBANK','HDFC Bank'],['ICICIBANK','ICICI Bank'],['BHARTIARTL','Bharti Airtel'],['LT','Larsen & Toubro'],
    ['ADANIPORTS','Adani Ports'],['BAJFINANCE','Bajaj Finance'],['HINDALCO','Hindalco']
  ];
  const normalizePhrase=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  const hasPhrase=(text,term)=>{
    const hay=' '+normalizePhrase(text)+' ';
    const needle=' '+normalizePhrase(term)+' ';
    return needle.length>2&&hay.includes(needle);
  };
  const queryForResolve=normalizePhrase(q.replace(/\b(BUY|SELL|STOCKS?|SHARES?|ANALYZE|ANALYSIS|TODAY|TRADE|TRADING|PICK|BEST|TOP|FOR|THE|OF|TO|PRICE|CHART|COMPANY|QUOTE|FORECAST|LATEST|CURRENT|LIVE|NEWS|REPORT|PERFORMANCE|OUTLOOK|UPDATE|INVEST|INVESTMENT|SHOW|FIND|ME|MY|PLEASE|GIVE|ABOUT|ON|IN|WHAT|IS|A|AN)\b/g,' '));
  const compactQuery=queryForResolve.replace(/\s/g,'');
  const aliases={
    AXISBANK:'AXISBANK',AXISBANKLIMITED:'AXISBANK',
    SBI:'SBIN',STATEBANKINDIA:'SBIN',STATEBANKOFINDIA:'SBIN',
    LARSENTOUBRO:'LT',LARSENANDTOUBRO:'LT'
  };
  const exactTicker=aliases[compactQuery]||compactQuery;
  const exact=catalog.find(c=>normalizePhrase(c[0]).replace(/\s/g,'')===exactTicker||normalizePhrase(c[1]).replace(/\s/g,'')===compactQuery);
  if(exact&&compactQuery){
    const [ticker,name]=exact;
    return {ticker,name,confidence:88,score:84,evidenceMentions:0,positive:0,negative:0,candidates:[{ticker,name,confidence:88,evidenceScore:84,evidenceMentions:0,positive:0,negative:0}],method:'Exact query match',reason:'The requested symbol/company name matched the instrument registry directly.',disclaimer:'Instrument match only; verify the exchange quote, freshness and risk gates before acting.'};
  }
  // Search headlines are evidence, not identity resolution. Never select a company merely
  // because an unrelated headline mentions it. Unlisted/global entities go to live lookup.
  const explicit=catalog.filter(c=>hasPhrase(q,c[0])||hasPhrase(q,c[1]));
  const aliasMatches=Object.entries(aliases).filter(([alias])=>hasPhrase(q,alias)).map(([,ticker])=>catalog.find(c=>c[0]===ticker)).filter(Boolean);
  const matches=[...new Map([...explicit,...aliasMatches].map(c=>[c[0],c])).values()];
  if(matches.length===1){
    const [ticker,name]=matches[0];
    return {ticker,name,confidence:84,score:80,evidenceMentions:0,positive:0,negative:0,candidates:[{ticker,name,confidence:84,evidenceScore:80,evidenceMentions:0,positive:0,negative:0}],method:'Explicit query entity match',reason:'The requested query explicitly names this instrument; news mentions are not used to choose its identity.',disclaimer:'Instrument identity only; price, timestamp and risk checks are separate.'};
  }
  return null;
}
const FORECAST_HORIZON_DAYS=1;
const FORECAST_MOVE_THRESHOLD_PCT=0.5;
const MAX_FORECASTS=1200;
const MIN_PRIOR_OUTCOMES_FOR_SHRINKAGE=30;
const MIN_CALIBRATION_OUTCOMES=100;
const CLASS_KEYS=['UP','DOWN','HOLD'];
const CLASS_PROB_KEYS={UP:'up',DOWN:'down',HOLD:'hold'};
function normalizeTicker(value){
 return String(value||'').trim().toUpperCase().replace(/\.(?:NS|BO)$/,'').replace(/USDT$/,'').replace(/\s+/g,'');
}
function verifiedSnapshot(snapshot,nowMs=Date.now()){
 if(!snapshot||snapshot.quality?.forecastEligible!==true||snapshot.quality?.status!=='VERIFIED_LIVE')return false;
 const ticker=normalizeTicker(snapshot.instrument?.ticker||snapshot.instrument?.symbol);
 const requested=normalizeTicker(snapshot.requested?.ticker||snapshot.requested?.symbol||ticker);
 const price=Number(snapshot.quote?.price);
 const asOf=Date.parse(snapshot.timing?.sourceAsOf||'');
 const age=nowMs-asOf;
 const maxAge=Math.max(1000,Number(snapshot.timing?.maxAgeMs)||120000);
 return Boolean(ticker&&requested===ticker&&Number.isFinite(price)&&price>0&&Number.isFinite(asOf)
  &&age>=-30000&&age<=maxAge&&snapshot.timing?.fresh===true&&snapshot.timing?.providerMarkedLive===true
  &&Number(snapshot.candles?.count)>=2&&snapshot.instrument?.symbolMatches===true);
}
function priorResolved(s,agent,createdAt){
 const cutoff=Date.parse(createdAt||'');
 return s.forecasts.filter(x=>x.agent===agent&&x.forecastStatus==='RESOLVED'
  &&Number.isFinite(Date.parse(x.resolvedAt||''))&&Date.parse(x.resolvedAt)<cutoff
  &&Number.isFinite(Date.parse(x.createdAt||''))&&Date.parse(x.createdAt)<cutoff);
}
function empiricalClassRates(rows){
 const counts={UP:1,DOWN:1,HOLD:1};
 rows.forEach(x=>{if(CLASS_KEYS.includes(x.outcome))counts[x.outcome]++});
 const total=counts.UP+counts.DOWN+counts.HOLD;
 return {up:counts.UP/total*100,down:counts.DOWN/total*100,hold:counts.HOLD/total*100};
}
function directionalEdge(agentName,f){
 const role=String(agentName||'').toUpperCase();
 let sw=.32,mw=.35,pw=.33,damp=1;
 if(['MARKET','MARKETS'].includes(role)){sw=.15;mw=.35;pw=.50;}
 else if(['RESEARCH','BUSINESS'].includes(role)){sw=.60;mw=.25;pw=.15;}
 else if(['INVESTMENT','PORTFOLIO','ASSETS'].includes(role)){sw=.25;mw=.42;pw=.33;}
 else if(['CFO','BUDGET','GOALS','DEBT','TAX'].includes(role)){sw=.20;mw=.35;pw=.45;damp=.40;}
 else if(['RISK','REDTEAM','SECURITY','JUDGE'].includes(role)){sw=.22;mw=.33;pw=.45;damp=.55;}
 const edge=((Number(f.sentiment)||50)-50)*sw+((Number(f.market)||50)-50)*mw+((Number(f.marketMomentum)||50)-50)*pw;
 return Math.max(-50,Math.min(50,edge*damp));
}
function distributionFromEdge(edge){
 const hold=Math.max(28,Math.min(58,55-Math.abs(edge)*.55));
 const moving=100-hold;
 const upShare=Math.max(.15,Math.min(.85,.5+edge/140));
 const up=Number((moving*upShare).toFixed(4));
 const down=Number((moving-up).toFixed(4));
 return {up,down,hold:Number((100-up-down).toFixed(4))};
}
function normalizeProbabilities(p){
 if(!p||typeof p!=='object')return null;
 const vals=[Number(p.up),Number(p.down),Number(p.hold)];
 if(vals.some(v=>!Number.isFinite(v)||v<0||v>100))return null;
 const sum=vals.reduce((a,b)=>a+b,0);
 if(sum<98||sum>102)return null;
 return {up:vals[0]/sum*100,down:vals[1]/sum*100,hold:vals[2]/sum*100};
}
function outcomeForReturn(returnPct,threshold=FORECAST_MOVE_THRESHOLD_PCT){
 return returnPct>=threshold?'UP':returnPct<=-threshold?'DOWN':'HOLD';
}
function brierFor(probabilities,outcome){
 if(!probabilities||!CLASS_KEYS.includes(outcome))return null;
 return CLASS_KEYS.reduce((sum,key)=>{const p=Number(probabilities[CLASS_PROB_KEYS[key]])/100;return sum+Math.pow(p-(key===outcome?1:0),2)},0);
}
function logLossFor(probabilities,outcome){
 if(!probabilities||!CLASS_KEYS.includes(outcome))return null;
 return -Math.log(Math.max(1e-6,Math.min(1,Number(probabilities[CLASS_PROB_KEYS[outcome]])/100)));
}
function calibrationMetrics(rows){
 if(!rows.length)return {ece:null,bins:[]};
 const bins=[],total=rows.length*3;let gapSum=0;
 for(const key of CLASS_KEYS){
  const pKey=CLASS_PROB_KEYS[key];
  for(let i=0;i<5;i++){
   const selected=rows.filter(x=>{const p=Number(x.probabilities?.[pKey])/100;return p>=i*.2&&(i===4?p<=1:p<(i+1)*.2)});
   if(!selected.length)continue;
   const predicted=selected.reduce((n,x)=>n+Number(x.probabilities[pKey])/100,0)/selected.length;
   const observed=selected.filter(x=>x.outcome===key).length/selected.length;
   const gap=Math.abs(predicted-observed);gapSum+=selected.length*gap;
   bins.push({class:key,lowerPct:i*20,upperPct:(i+1)*20,count:selected.length,meanPredictedPct:+(predicted*100).toFixed(2),observedPct:+(observed*100).toFixed(2),absoluteGapPct:+(gap*100).toFixed(2)});
  }
 }
 return {ece:gapSum/total,bins};
}
function agentForecastMetrics(s,agent){
 const rows=s.forecasts.filter(x=>x.agent===agent&&x.forecastStatus==='RESOLVED'&&normalizeProbabilities(x.probabilities));
 const count=rows.length;
 if(!count)return {agent,count:0,pending:s.forecasts.filter(x=>x.agent===agent&&x.forecastStatus==='PENDING_OUTCOME').length,brier:null,baselineBrier:null,logLoss:null,topClassAccuracy:null,calibrationError:null,calibrationBins:[],probabilitiesCalibrated:false,calibrationStatus:'INSUFFICIENT_SAMPLE'};
 const briers=rows.map(x=>brierFor(x.probabilities,x.outcome)).filter(Number.isFinite);
 const baseline=rows.map(x=>brierFor(x.baselineProbabilities,x.outcome)).filter(Number.isFinite);
 const losses=rows.map(x=>logLossFor(x.probabilities,x.outcome)).filter(Number.isFinite);
 const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 const top=rows.filter(x=>CLASS_KEYS.reduce((best,key)=>Number(x.probabilities[CLASS_PROB_KEYS[key]])>Number(x.probabilities[CLASS_PROB_KEYS[best]])?key:best,CLASS_KEYS[0])===x.outcome).length/count;
 const cm=calibrationMetrics(rows);
 const outcomesSeen=new Set(rows.map(x=>x.outcome)).size;
 const recent=rows.slice().sort((a,b)=>Date.parse(a.resolvedAt)-Date.parse(b.resolvedAt)).slice(-30);
 const recentBrier=avg(recent.map(x=>brierFor(x.probabilities,x.outcome)).filter(Number.isFinite));
 const recentBaseline=avg(recent.map(x=>brierFor(x.baselineProbabilities,x.outcome)).filter(Number.isFinite));
 const brier=avg(briers),baselineBrier=avg(baseline);
 const calibrated=count>=MIN_CALIBRATION_OUTCOMES&&outcomesSeen>=2&&cm.ece!==null&&cm.ece<=.08&&baselineBrier!==null&&brier<baselineBrier&&recent.length>=30&&recentBaseline!==null&&recentBrier<recentBaseline;
 let calibrationStatus='INSUFFICIENT_SAMPLE';
 if(count>=30)calibrationStatus='EXPLORATORY_UNCALIBRATED';
 if(count>=MIN_CALIBRATION_OUTCOMES){
  calibrationStatus=calibrated?'PROBABILITIES_CALIBRATED':cm.ece!==null&&cm.ece>.08?'CALIBRATION_ERROR_TOO_HIGH':'NOT_BEATING_WALK_FORWARD_BASELINE';
 }
 return {agent,count,pending:s.forecasts.filter(x=>x.agent===agent&&x.forecastStatus==='PENDING_OUTCOME').length,
  brier:brier===null?null:+brier.toFixed(5),baselineBrier:baselineBrier===null?null:+baselineBrier.toFixed(5),
  logLoss:avg(losses)===null?null:+avg(losses).toFixed(5),topClassAccuracy:+(top*100).toFixed(2),
  calibrationError:cm.ece===null?null:+(cm.ece*100).toFixed(2),calibrationBins:cm.bins,
  recentBrier:recentBrier===null?null:+recentBrier.toFixed(5),recentBaselineBrier:recentBaseline===null?null:+recentBaseline.toFixed(5),
  probabilitiesCalibrated:calibrated,calibrationStatus,outcomesSeen};
}
function settleDueForecasts(s,snapshot,nowMs=Date.now()){
 if(!verifiedSnapshot(snapshot,nowMs))return 0;
 const ticker=normalizeTicker(snapshot.instrument?.ticker||snapshot.instrument?.symbol);
 const currentPrice=Number(snapshot.quote?.price),asOf=Date.parse(snapshot.timing.sourceAsOf);
 if(!ticker||!Number.isFinite(currentPrice)||currentPrice<=0||!Number.isFinite(asOf))return 0;
 let resolved=0;
 for(const row of s.forecasts){
  if(row.forecastStatus!=='PENDING_OUTCOME'||normalizeTicker(row.ticker)!==ticker)continue;
  const due=Date.parse(row.dueAt||'');
  const reference=Number(row.referencePrice);
  if(!Number.isFinite(due)||asOf<due||!Number.isFinite(reference)||reference<=0)continue;
  const returnPct=(currentPrice/reference-1)*100;
  const outcome=outcomeForReturn(returnPct,Number(row.moveThresholdPct)||FORECAST_MOVE_THRESHOLD_PCT);
  row.forecastStatus='RESOLVED';row.outcome=outcome;row.actualReturnPct=+returnPct.toFixed(5);
  row.settlementPrice=currentPrice;row.settlementAsOf=new Date(asOf).toISOString();
  row.settlementSnapshotId=snapshot.snapshotId||null;row.resolvedAt=new Date(nowMs).toISOString();
  row.brierScore=brierFor(row.probabilities,outcome);row.logLoss=logLossFor(row.probabilities,outcome);
  row.outcomeMethod='VERIFIED_PROVIDER_QUOTE_AT_OR_AFTER_DUE_TIME';resolved++;
 }
 if(resolved){
  s.events.unshift({type:'FORECAST_OUTCOME_RESOLUTION',time:new Date(nowMs).toISOString(),ticker,resolved,snapshotId:snapshot.snapshotId||null});
  s.events=s.events.slice(0,100);
 }
 return resolved;
}
function buildAgentForecast(agentName,agent,featuresValue,snapshot,s,nowMs=Date.now(),horizonDays=FORECAST_HORIZON_DAYS){
 const ticker=normalizeTicker(snapshot.instrument?.ticker||snapshot.instrument?.symbol);
 const createdAt=new Date(nowMs).toISOString();
 const horizon=Math.max(1,Math.min(30,Math.floor(Number(horizonDays)||FORECAST_HORIZON_DAYS)));
 const dueAt=new Date(nowMs+horizon*86400000).toISOString();
 const key=[snapshot.snapshotId||snapshot.timing?.sourceAsOf,ticker,agentName,horizon].join('|');
 const existing=s.forecasts.find(x=>x.key===key);
 if(existing)return existing;
 const history=priorResolved(s,agentName,createdAt);
 const baselineProbabilities=empiricalClassRates(history);
 const edge=directionalEdge(agentName,featuresValue);
 const rawProbabilities=distributionFromEdge(edge);
 const rawSum=rawProbabilities.up+rawProbabilities.down+rawProbabilities.hold;
 const raw={up:rawProbabilities.up/rawSum*100,down:rawProbabilities.down/rawSum*100,hold:rawProbabilities.hold/rawSum*100};
 const sampleCount=history.length;
 const shrinkageWeight=sampleCount>=MIN_PRIOR_OUTCOMES_FOR_SHRINKAGE?Math.min(.5,sampleCount/(sampleCount+60)):0;
 const probabilities={
  up:raw.up*(1-shrinkageWeight)+baselineProbabilities.up*shrinkageWeight,
  down:raw.down*(1-shrinkageWeight)+baselineProbabilities.down*shrinkageWeight,
  hold:raw.hold*(1-shrinkageWeight)+baselineProbabilities.hold*shrinkageWeight
 };
 const total=probabilities.up+probabilities.down+probabilities.hold;
 const normalized={up:+(probabilities.up/total*100).toFixed(4),down:+(probabilities.down/total*100).toFixed(4),hold:0};
 normalized.hold=+(100-normalized.up-normalized.down).toFixed(4);
 const metrics=agentForecastMetrics(s,agentName);
 return {id:'fc_'+Math.random().toString(36).slice(2,10)+'_'+nowMs.toString(36),key,agent:agentName,ticker,market:snapshot.instrument?.market||'UNKNOWN',currency:snapshot.instrument?.currency||'UNKNOWN',
  snapshotId:snapshot.snapshotId||null,createdAt,dueAt,horizonDays:horizon,referencePrice:Number(snapshot.quote.price),quoteAsOf:snapshot.timing.sourceAsOf,
  forecastEligible:true,dataStatus:snapshot.quality.status,moveThresholdPct:FORECAST_MOVE_THRESHOLD_PCT,probabilities:normalized,rawProbabilities:raw,
  baselineProbabilities,priorResolvedSampleCount:sampleCount,shrinkageWeight:+shrinkageWeight.toFixed(4),
  forecastMethod:'ROLE_WEIGHTED_RULE_BASELINE_V1',probabilitiesCalibrated:metrics.probabilitiesCalibrated,calibrationStatus:metrics.calibrationStatus,
  forecastStatus:'PENDING_OUTCOME',outcome:null,actualReturnPct:null,resolvedAt:null};
}
function recordAgentForecasts(s,agentDefs,featuresValue,snapshot,nowMs=Date.now(),horizonDays=FORECAST_HORIZON_DAYS){
 const eligible=verifiedSnapshot(snapshot,nowMs);
 const ticker=normalizeTicker(snapshot?.instrument?.ticker||snapshot?.instrument?.symbol);
 if(!eligible){
  s.blockedForecastAttempts++;
  s.lastForecastAttempt={createdAt:new Date(nowMs).toISOString(),ticker:ticker||null,snapshotId:snapshot?.snapshotId||null,status:'BLOCKED_UNVERIFIED_DATA',reasons:Array.isArray(snapshot?.quality?.reasons)?snapshot.quality.reasons.slice(0,8):['VERIFIED_PROVIDER_SNAPSHOT_REQUIRED']};
  return {};
 }
 const output={};
 for(const [name,agent] of Object.entries(agentDefs)){
  const forecast=buildAgentForecast(name,agent,featuresValue,snapshot,s,nowMs,horizonDays);
  const duplicate=s.forecasts.some(x=>x.key===forecast.key);
  if(!duplicate){s.forecasts.unshift(forecast);s.forecasts=s.forecasts.slice(0,MAX_FORECASTS);}
  output[name]={status:'PENDING_OUTCOME',forecastId:forecast.id,ticker:forecast.ticker,horizonDays:forecast.horizonDays,
   probabilities:forecast.probabilities,probabilitiesCalibrated:forecast.probabilitiesCalibrated,calibrationStatus:forecast.calibrationStatus,
   priorResolvedSampleCount:forecast.priorResolvedSampleCount,method:forecast.forecastMethod,forecastEligible:true};
 }
 s.lastForecastAttempt={createdAt:new Date(nowMs).toISOString(),ticker,snapshotId:snapshot.snapshotId||null,status:'FORECASTS_RECORDED',agents:Object.keys(output).length,horizonDays:Math.max(1,Math.min(30,Math.floor(Number(horizonDays)||FORECAST_HORIZON_DAYS))),reasons:[]};
 return output;
}
function forecastTrainingReport(){
 const s=load();
 const agentReports=AGENTS.map(agent=>{
  const stats=agentForecastMetrics(s,agent);
  const latest=s.forecasts.find(x=>x.agent===agent)||null;
  return {...stats,latestForecast:latest?{ticker:latest.ticker,createdAt:latest.createdAt,dueAt:latest.dueAt,horizonDays:latest.horizonDays,referencePrice:latest.referencePrice,probabilities:latest.probabilities,probabilitiesCalibrated:latest.probabilitiesCalibrated,calibrationStatus:latest.calibrationStatus,forecastStatus:latest.forecastStatus,outcome:latest.outcome,actualReturnPct:latest.actualReturnPct,forecastEligible:latest.forecastEligible}:null};
 });
 const forecasts=s.forecasts;
 const resolved=forecasts.filter(x=>x.forecastStatus==='RESOLVED');
 const uniqueEvents=new Set(resolved.map(x=>[x.ticker,x.dueAt,x.settlementSnapshotId||'NO_SETTLEMENT_ID'].join('|')));
 return {version:VERSION,mode:'OUTCOME_SUPERVISED_WALK_FORWARD',persistence:'BROWSER_LOCAL_STORAGE',persistentAcrossPageReloads:true,
  foundationModelTraining:false,realMoneyExecution:false,horizonDays:FORECAST_HORIZON_DAYS,moveThresholdPct:FORECAST_MOVE_THRESHOLD_PCT,
  forecastCount:forecasts.length,resolvedForecasts:resolved.length,pendingForecasts:forecasts.filter(x=>x.forecastStatus==='PENDING_OUTCOME').length,
  uniqueSettledEvents:uniqueEvents.size,blockedForecastAttempts:s.blockedForecastAttempts,calibratedAgentCount:agentReports.filter(x=>x.probabilitiesCalibrated).length,
  lastForecastAttempt:s.lastForecastAttempt||null,minimumCalibrationOutcomes:MIN_CALIBRATION_OUTCOMES,agents:agentReports,
  governance:{outcomeSource:'Fresh matching provider-timestamped snapshots only',baseline:'Prior resolved outcomes captured before each forecast (chronological walk-forward)',probabilityCalibrationRequires:'At least 100 resolved outcomes per agent, calibration ECE <= 8%, and lower Brier score than the walk-forward base-rate benchmark overall and on the latest 30 outcomes.',autoPromotion:false,weightMutationFromOutcomes:false,approvalRequiredForExecution:true,
   notes:'Forecast probabilities are rule-based and uncalibrated until each agent passes the measured validation conditions. Client/browser data is not treated as a verified price. Records live in this browser localStorage and are not cloud-persistent.'}};
}
function runFleet(state,context){
 const s=load(),marketSnapshot=context?.marketSnapshot||state?.marketSnapshot||null,nowMs=Date.now();
 if(verifiedSnapshot(marketSnapshot,nowMs))settleDueForecasts(s,marketSnapshot,nowMs);
 const f=features(state,context?.web||null,marketSnapshot),results={},agentDefs={};
 AGENTS.forEach(name=>{
  const a=ensureAgent(s,name),raw=weighted(a,f),cal=Number(a.calibration||0);
  agentDefs[name]=a;
  results[name]={score:Math.round(clamp(raw+cal)),confidence:Math.round(clamp(raw+cal*.7)),features:f,marketSnapshotId:marketSnapshot?.snapshotId||null,marketDataStatus:marketSnapshot?.quality?.status||'UNAVAILABLE',forecastEligible:verifiedSnapshot(marketSnapshot,nowMs)};
 });
 const forecasts=recordAgentForecasts(s,agentDefs,f,marketSnapshot,nowMs,context?.forecastHorizonDays||FORECAST_HORIZON_DAYS);
 AGENTS.forEach(name=>{
  const a=agentDefs[name];a.runs++;a.confidenceSum+=results[name].confidence;a.avgConfidence=Number((a.confidenceSum/a.runs).toFixed(1));
  results[name].forecast=forecasts[name]||{status:'BLOCKED_UNVERIFIED_DATA',forecastEligible:false,probabilities:null,probabilitiesCalibrated:false,calibrationStatus:'BLOCKED_UNVERIFIED_DATA'};
 });
 s.runs++;s.lastRun=new Date(nowMs).toISOString();
 s.events.unshift({type:'FLEET_LEARNING_RUN',time:s.lastRun,marketSnapshotId:marketSnapshot?.snapshotId||null,marketTicker:marketSnapshot?.instrument?.ticker||null,marketDataStatus:marketSnapshot?.quality?.status||'UNAVAILABLE',marketForecastEligible:verifiedSnapshot(marketSnapshot,nowMs),features:f,results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{score:v.score,confidence:v.confidence,marketDataStatus:v.marketDataStatus,forecast:v.forecast}]))});
 s.events=s.events.slice(0,100);save(s);
 return results;
}
function resolveDueForecasts(snapshot,options={}){
 const s=load(),nowMs=Number.isFinite(Number(options.nowMs))?Number(options.nowMs):Date.now();
 const resolved=settleDueForecasts(s,snapshot,nowMs);
 if(resolved)save(s);
 return {ok:true,resolved,report:forecastTrainingReport()};
}
function learnOutcome(agent,correct,actual,notes){
  const s=load(),names=agent&&agent!=='ALL'?[agent]:AGENTS;
  names.forEach(name=>{
    const a=ensureAgent(s,name);a.outcomes=(a.outcomes||0)+1;if(correct)a.correct++;
    a.accuracy=Number((a.correct/a.outcomes*100).toFixed(1));
    const target=correct?100:0,err=target-(a.avgConfidence||50);
    a.calibration=clamp((a.calibration||0)+err*.06,-15,15);
  });
  s.outcomes.unshift({agent:agent||'ALL',correct:!!correct,actual:String(actual||''),notes:String(notes||''),time:new Date().toISOString()});
  s.outcomes=s.outcomes.slice(0,200);save(s);return snapshot();
}
function snapshot(){
  const s=load(),rows=AGENTS.map(n=>{const a=ensureAgent(s,n);return {agent:n,runs:a.runs,accuracy:a.accuracy,avgConfidence:a.avgConfidence||0,calibration:Number(a.calibration||0)}});save(s);
  const acc=rows.filter(x=>x.accuracy!=null);return {version:VERSION,runs:s.runs,outcomes:s.outcomes.length,agents:rows,averageAccuracy:acc.length?Number((acc.reduce((a,x)=>a+x.accuracy,0)/acc.length).toFixed(1)):null,lastRun:s.lastRun,forecastTraining:forecastTrainingReport()};
}
function learnFromDecision(state,decision){
  const d=decision||{};const risk=Number(d.risk||50),conf=Number(d.confidence||50);
  const signal=conf>=65&&risk<60?'POSITIVE':'DEFENSIVE';
  state.deepLearning=state.deepLearning||{};state.deepLearning.lastSignal=signal;state.deepLearning.lastConfidence=conf;state.deepLearning.lastRun=new Date().toISOString();
  const s=load();s.events.unshift({type:'DECISION_LEARNING_PACKET',time:state.deepLearning.lastRun,signal,confidence:conf,risk,candidate:d.candidate?.ticker||null});s.events=s.events.slice(0,100);save(s);return snapshot();
}
window.FinPilotDeepLearning={version:VERSION,agents:AGENTS,features,resolveCandidate,runFleet,learnOutcome,learnFromDecision,snapshot,resolveDueForecasts,forecastTrainingReport};
})();