import http from 'node:http';
import {URL} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import 'node:process';
import vm from 'node:vm';
import pg from 'pg';
import {searchWeb} from './search-provider.mjs';
const {Pool}=pg;
let MARKET_POOL=null, MARKET_SCHEMA_READY=false;
async function marketStore(){if(MARKET_POOL||!process.env.DATABASE_URL)return MARKET_POOL;MARKET_POOL=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:3,idleTimeoutMillis:30000});return MARKET_POOL;}
async function ensureMarketSchema(){const pool=await marketStore();if(!pool||MARKET_SCHEMA_READY)return !!pool;await pool.query('CREATE TABLE IF NOT EXISTS market_ticks (id BIGSERIAL PRIMARY KEY,ticker TEXT NOT NULL,symbol TEXT,price DOUBLE PRECISION,change_pct DOUBLE PRECISION,volume DOUBLE PRECISION,high DOUBLE PRECISION,low DOUBLE PRECISION,source TEXT,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');await pool.query('CREATE INDEX IF NOT EXISTS market_ticks_ticker_time_idx ON market_ticks(ticker,observed_at DESC)');MARKET_SCHEMA_READY=true;return true;}
async function storeMarketTick(x){try{if(!(await ensureMarketSchema()))return false;await MARKET_POOL.query('INSERT INTO market_ticks(ticker,symbol,price,change_pct,volume,high,low,source,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[x.ticker,x.symbol,Number(x.price),Number(x.changePct),Number(x.volume),Number(x.high),Number(x.low),x.source||'Binance public market data',x.time||new Date().toISOString()]);return true}catch(e){MARKET_SCHEMA_READY=false;return false;}}
async function marketHistory(req,res,u){try{if(!(await ensureMarketSchema()))return send(res,200,{ok:true,cloud:false,rows:[],message:'Cloud archive adapter ready; connect DATABASE_URL on Render.'});const ticker=(u.searchParams.get('ticker')||'BTC').toUpperCase();const limit=Math.min(500,Math.max(10,Number(u.searchParams.get('limit')||100)));const q=await MARKET_POOL.query('SELECT ticker,symbol,price,change_pct AS "changePct",volume,high,low,source,observed_at AS time FROM market_ticks WHERE ticker=$1 ORDER BY observed_at DESC LIMIT $2',[ticker,limit]);return send(res,200,{ok:true,cloud:true,ticker,rows:q.rows});}catch(e){return send(res,200,{ok:true,cloud:false,rows:[],error:e.message});}}


const PORT=Number(process.env.PORT||8787);
const HOST=process.env.HOST||'0.0.0.0';
const ROOT=path.resolve(new URL('../public/', import.meta.url).pathname);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const send=(res,status,body,type='application/json; charset=utf-8',headers={})=>{
 const origin=res.req?.headers?.origin; const allowed=process.env.ALLOWED_ORIGIN||'';
 const cors=origin&&allowed&&origin===allowed?origin:undefined;
 const h={'Content-Type':type,'Cache-Control':'no-store','X-FinPilot-Version':'7.0',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(),microphone=(),geolocation=(),payment=()','Content-Security-Policy':"default-src 'self'; connect-src 'self' https://api.binance.com https://fapi.binance.com https://eapi.binance.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://s3.tradingview.com; frame-src 'self' https://www.tradingview.com https://in.tradingview.com; child-src 'self' https://www.tradingview.com https://in.tradingview.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",...headers};
 if(process.env.NODE_ENV==='production')h['Strict-Transport-Security']='max-age=31536000; includeSubDomains';
 if(cors)h['Access-Control-Allow-Origin']=cors;
 res.writeHead(status,h);res.end(typeof body==='string'?body:JSON.stringify(body));
};
async function body(req){if(req._parsedBody!==undefined)return req._parsedBody;let b=''; for await(const c of req)b+=c; try{req._parsedBody=JSON.parse(b||'{}')}catch{req._parsedBody={}} req._bodyCache=JSON.stringify(req._parsedBody);return req._parsedBody}
const AI_FREE_LIMIT=Number(process.env.FINPILOT_AI_FREE_LIMIT||20);
const AI_FREE_WINDOW_MS=24*60*60*1000;
const AI_USAGE=new Map();
function aiClientId(req){
 const supplied=String(req.headers['x-finpilot-user']||'').trim();
 if(supplied) return supplied.slice(0,96);
 return `${clientKey(req)}|${String(req.headers['user-agent']||'').slice(0,80)}`;
}
function aiUsage(id){
 const now=Date.now(); let x=AI_USAGE.get(id);
 if(!x||now-x.started>=AI_FREE_WINDOW_MS){x={started:now,count:0};AI_USAGE.set(id,x);}
 return x;
}
function aiPlan(req,res){
 const x=aiUsage(aiClientId(req)); const used=x.count, remaining=Math.max(0,AI_FREE_LIMIT-used);
 return send(res,200,{ok:true,tier:'FREE',limit:AI_FREE_LIMIT,used,remaining,windowHours:24,aiConfigured:Boolean(process.env.LLM_API_URL&&process.env.LLM_API_KEY),upgrade:{id:'PRO_AI',name:'FinPilot AI Pro',features:['higher AI allowance','deeper Round Table synthesis','priority AI reasoning','extended research context'],status:'AVAILABLE_LATER',price:'Not set yet'},note:'Free allowance applies to external AI reasoning calls. FinPilot deterministic market/risk engines remain available.'});
}
async function ai(req,res){
 const cfg={url:process.env.LLM_API_URL||'',key:process.env.LLM_API_KEY||'',model:process.env.LLM_MODEL||'gpt-6-luna'};
 const usage=aiUsage(aiClientId(req));
 if(usage.count>=AI_FREE_LIMIT)return send(res,429,{ok:false,error:'FREE_AI_LIMIT_REACHED',tier:'FREE',limit:AI_FREE_LIMIT,used:usage.count,remaining:0,upgrade:{id:'PRO_AI',name:'FinPilot AI Pro',status:'AVAILABLE_LATER'},fallback:'Use FinPilot deterministic analysis, live market scan, Round Table rules and risk engine.'});
 if(!cfg.url||!cfg.key)return send(res,503,{ok:false,error:'AI_GATEWAY_NOT_CONFIGURED',tier:'FREE',limit:AI_FREE_LIMIT,used:usage.count,remaining:AI_FREE_LIMIT-usage.count,message:'Free AI tier is enabled, but no AI provider key is configured. Core FinPilot analysis remains available.'});
 const input=await body(req);
 const payload={model:cfg.model,messages:[{role:'system',content:'You are FinPilot AI, a careful finance decision-support assistant. Think like a disciplined research desk: separate facts from inference, challenge bullish and bearish assumptions, quantify uncertainty, protect capital, and never fabricate live data. Do not execute transactions or guarantee returns. For securities, provide general decision support unless suitability evidence exists. Return concise JSON with keys: summary, decision, confidence, risks, actions, evidence_needed.'},{role:'user',content:JSON.stringify(input)}]};
 try{
  const r=await fetch(cfg.url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${cfg.key}`},body:JSON.stringify(payload)});
  const t=await r.text();
  if(r.ok)usage.count++;
  res.writeHead(r.status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-FinPilot-AI-Tier':'FREE'});
  res.end(t);
 }catch(e){return send(res,502,{ok:false,error:'AI_PROVIDER_UNAVAILABLE',tier:'FREE',used:usage.count,remaining:AI_FREE_LIMIT-usage.count,message:e.message});}
}
async function simulate(req,res){
 const x=await body(req);
 const cash=Number(x.cash)||0,income=Number(x.income)||0,spending=Number(x.spending)||0,investments=Number(x.investments)||0,liabilities=Number(x.liabilities)||0,amount=Math.max(0,Number(x.amount)||0),months=Math.max(1,Number(x.months)||1);
 let scenario={cash,income,spending,investments,liabilities};
 switch(x.type){case 'Job loss':scenario.income=0;scenario.cash=Math.max(0,cash-spending*months);break;case 'Large purchase':scenario.cash=Math.max(0,cash-amount);break;case 'Investment contribution':scenario.cash=Math.max(0,cash-amount*months);scenario.investments+=amount*months;break;case 'Debt payoff':scenario.cash=Math.max(0,cash-amount);scenario.liabilities=Math.max(0,liabilities-amount);break;case 'Income drop':scenario.income=Math.max(0,income-amount);break;case 'Expense increase':scenario.spending=spending+amount;break;case 'Goal acceleration':scenario.cash=Math.max(0,cash-amount*months);break;}
 const freeCash=scenario.income-scenario.spending;
 const runway=scenario.cash/Math.max(1,scenario.spending);
 const baseNW=cash+investments-liabilities,scenarioNW=scenario.cash+scenario.investments-scenario.liabilities;
 const riskScore=Math.min(100,Math.max(0,100-runway*12-Math.max(0,freeCash)/1000+(scenario.liabilities/Math.max(1,scenario.income*12))*35));
 const risk=riskScore>=70?'CRITICAL':riskScore>=45?'ELEVATED':riskScore>=25?'WATCH':'MANAGEABLE';
 return send(res,200,{ok:true,engine:'deterministic-v2400',scenario:{...scenario,freeCash,runway,baseNW,scenarioNW,deltaNW:scenarioNW-baseNW,deltaCash:scenario.cash-cash,riskScore,risk}});
}
async function agentRun(req,res){
 const x=await body(req); const name=String(x.agent||'CFO'); const f=Array.isArray(x.findings)?x.findings:[];
 const surplus=Number(x.income||0)-Number(x.spending||0); const emergency=Number(x.emergency||0); const spending=Number(x.spending||0);
 let analysis=''; let challenge=''; let recommendation=''; let confidence=72; let risk='MEDIUM';
 if(name==='CFO'||name==='Cashflow'){ analysis=`Free cash is ${surplus>=0?'positive':'negative'} at ${Math.round(surplus)} per month.`; challenge=surplus>0?'Surplus can be consumed by irregular expenses.':'Negative cash flow can force asset sales or new debt.'; recommendation=surplus>0?'Protect a portion of monthly surplus before discretionary allocation.':'Reduce discretionary spending and stabilize monthly cash flow.'; confidence=88; risk=surplus>0?'LOW':'HIGH'; }
 else if(name==='Debt'){ analysis=`${f.filter(v=>v.domain==='Debt').length} debt finding(s) are available for review.`; challenge='Paying debt aggressively can weaken liquidity if reserves are thin.'; recommendation='Compare APR, liquidity and goal impact before selecting a payoff order.'; confidence=82; risk='MEDIUM'; }
 else if(name==='Risk'){ const months=emergency/Math.max(1,spending); analysis=`Emergency coverage is ${months.toFixed(1)} months.`; challenge='Historical averages can understate a sudden income or expense shock.'; recommendation=months<3?'Strengthen emergency liquidity before increasing financial risk.':'Maintain a dedicated reserve while pursuing long-term goals.'; confidence=91; risk=months<3?'HIGH':'LOW'; }
 else if(name==='Goals'){ analysis='Goal progress should be evaluated against cash-flow capacity and time horizon.'; challenge='A high savings rate can still miss a goal if the target or deadline changes.'; recommendation='Recalculate required contribution and goal probability before accelerating contributions.'; confidence=79; risk='MEDIUM'; }
 else { analysis=`${name} reviewed ${f.length} structured Financial Brain findings.`; challenge='Specialist conclusions may be incomplete without domain-specific evidence.'; recommendation=`Run ${name} again with fresh evidence before any high-impact decision.`; confidence=70; risk='MEDIUM'; }
 return send(res,200,{ok:true,agent:name,pipeline:{question:`What should ${name} focus on now?`,evidence:f.map(v=>({domain:v.domain,severity:v.severity,title:v.title})),analysis,challenge,confidence,recommendation,risk,action:{type:'PREPARE',approvalRequired:true},time:new Date().toISOString(),engine:'deterministic-agent-v2600'}});
}
async function learn(req,res){
 const x=await body(req); const history=Array.isArray(x.history)?x.history:[]; const runs=Array.isArray(x.agentRuns)?x.agentRuns:[];
 const completed=history.filter(d=>d&&d.outcome&&d.outcome!=='PENDING');
 const wins=completed.filter(d=>['SUCCESS','POSITIVE','IMPROVED'].includes(String(d.outcome).toUpperCase())).length;
 const misses=completed.filter(d=>['FAILED','NEGATIVE','MISSED'].includes(String(d.outcome).toUpperCase())).length;
 const accuracy=completed.length?Math.round(wins/completed.length*100):null;
 const byAgent={}; for(const r of runs){const n=String(r.agent||'Unknown');byAgent[n]??={runs:0,success:0};byAgent[n].runs++;if(r.outcome&&['SUCCESS','POSITIVE','IMPROVED'].includes(String(r.outcome).toUpperCase()))byAgent[n].success++;}
 for(const n of Object.keys(byAgent)){const a=byAgent[n];a.score=a.runs?Math.round(a.success/a.runs*100):0;}
 const repeated={}; for(const d of history){for(const k of (Array.isArray(d.errorTags)?d.errorTags:[]))repeated[k]=(repeated[k]||0)+1;}
 const mistakes=Object.entries(repeated).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>({tag,count}));
 const confidenceAdjustment=completed.length?Math.max(-15,Math.min(10,(accuracy??70)-70)):0;
 return send(res,200,{ok:true,engine:'learning-v2700',metrics:{completed:wins+misses,wins,misses,accuracy,confidenceAdjustment},agentScores:byAgent,repeatedMistakes:mistakes,updatedAt:new Date().toISOString()});
}
async function search(req,res,u){
 const q=(u.searchParams.get('q')||'').trim();
 const count=Math.min(10,Math.max(1,Number(u.searchParams.get('count')||8)));
 if(!q)return send(res,400,{ok:false,error:'Missing query'});
 try{
  const d=await searchWeb(q,{count});
  return send(res,200,{ok:true,query:q,...d});
 }catch(e){
  const google=`https://www.google.com/search?q=${encodeURIComponent(q)}`;
  return send(res,502,{ok:false,error:e.code||'SEARCH_PROVIDER_UNAVAILABLE',query:q,provider:null,results:[],externalUrl:google,message:e.message||'Search provider unavailable.',live:false});
 }
}



// FinPilot 4.1 platform acceleration layer
const RESPONSE_CACHE=new Map();
const CACHE_TTL_MS=Number(process.env.FINPILOT_CACHE_TTL_MS||15000);
const EXECUTION_QUEUE=new Map();
const PERF={started:Date.now(),requests:0,cacheHits:0,errors:0,agentRuns:0};
function requestId(){return `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
function cached(key, value, ttl=CACHE_TTL_MS){RESPONSE_CACHE.set(key,{value,expires:Date.now()+ttl});return value}
function getCached(key){const x=RESPONSE_CACHE.get(key);if(!x)return null;if(x.expires<Date.now()){RESPONSE_CACHE.delete(key);return null}PERF.cacheHits++;return x.value}
function safeExecutionPlan(body){
 const id=requestId(); const now=new Date().toISOString();
 const plan={id,status:'PENDING_APPROVAL',createdAt:now,asset:String(body.asset||''),instrument:String(body.instrument||''),side:String(body.side||''),quantity:Number(body.quantity||0),maxRiskPct:Math.min(2,Math.max(0,Number(body.maxRiskPct||0))),reason:String(body.reason||''),requiresHumanApproval:true,canAutoExecute:false};
 EXECUTION_QUEUE.set(id,plan);return plan;
}
function performance(req,res){return send(res,200,{ok:true,version:'7.0',uptimeMs:Date.now()-PERF.started,requests:PERF.requests,cacheHits:PERF.cacheHits,errors:PERF.errors,agentRuns:PERF.agentRuns,queueSize:EXECUTION_QUEUE.size,cacheEntries:RESPONSE_CACHE.size,features:['parallel-agent-orchestration','short-lived-market-cache','request-tracing','latency-headers','approval-gated-execution-plan','SSE decision stream']})}
async function agentBatch(req,res){
 const started=Date.now(), x=await body(req); const names=Array.isArray(x.agents)&&x.agents.length?x.agents:['Bull','Bear','Risk','CFO','CEO'];
 PERF.agentRuns+=names.length;
 const surplus=Number(x.income||0)-Number(x.spending||0), reserve=Number(x.emergency||0)/Math.max(1,Number(x.spending||0));
 const results=await Promise.all(names.map(async name=>{
   const t=Date.now(); let view='Executive synthesis',stance='REVIEW';
   if(name==='Bull'){view='Upside case';stance=surplus>=0?'CONSTRUCTIVE':'WAIT';}
   else if(name==='Bear'){view='Downside case';stance=reserve<3?'DEFENSIVE':'WATCH';}
   else if(name==='Risk'){view='Risk constraints';stance=reserve<3?'HIGH RISK':'CONTROLLED';}
   else if(name==='CFO'){view='Capital discipline';stance=surplus>0&&reserve>=3?'CAPITAL AVAILABLE':'CAPITAL PROTECTED';}
   else if(name==='CEO'){view='Executive synthesis';stance=reserve<3?'WAIT':'CONDITIONAL';}
   return {agent:name,status:'READY',latencyMs:Math.max(1,Date.now()-t),view,stance};
 }));
 return send(res,200,{ok:true,engine:'parallel-agent-orchestrator-v4100',latencyMs:Date.now()-started,results,sequence:['Bull','Bear','Risk','CFO','CEO'],parallel:true,note:'Parallel specialist preparation; CEO synthesis remains downstream. No financial transaction is executed.'});
}
async function executionPlan(req,res){const x=await body(req);return send(res,200,{ok:true,plan:safeExecutionPlan(x),note:'Execution is deliberately approval-gated. This endpoint prepares a plan only; it cannot place a trade or transfer funds.'})}
async function decisionStream(req,res,u){
 res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
 const sendEvent=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
 const ticker=(u.searchParams.get('ticker')||'BTC').toUpperCase();
 sendEvent('status',{stage:'START',ticker,message:'Decision pipeline started'});
 const stages=[['MARKET','Reading market evidence'],['TECHNICAL','Calculating trend and momentum'],['DERIVATIVES','Checking derivatives evidence'],['RISK','Applying risk guard'],['CFO','Checking capital discipline'],['CEO','Preparing executive decision']];
 for(const [stage,message] of stages){sendEvent('stage',{stage,message,time:new Date().toISOString()});await new Promise(r=>setTimeout(r,35));}
 sendEvent('complete',{stage:'COMPLETE',ticker,decision:'WAIT / VERIFY LIVE EVIDENCE',confidence:0,approvalRequired:true,execution:false,note:'A live provider response is required before a contract-specific decision can be issued.'});res.end();
}

async function fetchJson(url){
 const r=await resilientFetch(url,'binance');
 if(!r.ok) throw new Error(`provider ${r.status}`);
 return r.json();
}
function sma(a,n){return a.length<n?null:a.slice(-n).reduce((x,y)=>x+y,0)/n}
function ema(a,n){if(a.length<n)return null;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(a,n=14){if(a.length<n+1)return null;let g=0,l=0;for(let i=a.length-n;i<a.length;i++){let d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}if(l===0)return 100;let rs=(g/n)/(l/n);return 100-(100/(1+rs))}
function atr(rows,n=14){if(rows.length<n+1)return null;const tr=[];for(let i=1;i<rows.length;i++){const [,,h,l,c]=rows[i];const pc=rows[i-1][4];tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)))}return sma(tr,n)}
const CRYPTO_ASSETS={BTC:'BTCUSDT',BTCUSDT:'BTCUSDT',ETH:'ETHUSDT',ETHUSDT:'ETHUSDT',SOL:'SOLUSDT',SOLUSDT:'SOLUSDT',BNB:'BNBUSDT',BNBUSDT:'BNBUSDT',XRP:'XRPUSDT',XRPUSDT:'XRPUSDT',DOGE:'DOGEUSDT',DOGEUSDT:'DOGEUSDT',ADA:'ADAUSDT',ADAUSDT:'ADAUSDT',AVAX:'AVAXUSDT',AVAXUSDT:'AVAXUSDT',LINK:'LINKUSDT',LINKUSDT:'LINKUSDT'};
const TIMEFRAMES={'15m':'15m','1h':'1h','4h':'4h','1d':'1d'};
async function liveCrypto(t, interval='1h', multi=true){
 const key=t.toUpperCase(), symbol=CRYPTO_ASSETS[key];
 if(!symbol) throw new Error('Crypto symbol not connected. Supported: BTC, ETH, SOL, BNB, XRP.');
 const tf=TIMEFRAMES[interval]||'1h';
 const intervals=multi?['15m','1h','4h'].filter(x=>x!==tf).concat(tf):[tf];
 const unique=[...new Set(intervals)];
 const [ticker,...series]=await Promise.all([
   fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
   ...unique.map(x=>fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${x}&limit=${x==='1d'?220:220}`))
 ]);
 const reports=unique.map((x,i)=>cryptoTimeframe(series[i],ticker,x));
 const main=reports.find(x=>x.interval===tf)||reports[0];
 const bullish=reports.filter(x=>x.direction==='BULLISH').length, bearish=reports.filter(x=>x.direction==='BEARISH').length;
 const consensus=bullish===reports.length?'BULLISH':bearish===reports.length?'BEARISH':'MIXED';
 const risk=Math.min(100,Math.max(10,Math.round(main.riskScore+(consensus==='MIXED'?8:consensus==='BEARISH'?15:-4))));
 const name=key.replace('USDT','');
 return {...main,ticker:name,symbol,name,market:'CRYPTO',provider:'Binance public market data',live:true,asOf:new Date().toISOString(),riskScore:risk,posture:consensus==='BULLISH'?(main.price>=main.resistance*.995?'BREAKOUT WATCH':'BULLISH / CONFIRMATION'):consensus==='BEARISH'?'DEFENSIVE / REVIEW':'MIXED / WAIT FOR CONFIRMATION',multiTimeframe:{consensus,checked:reports.map(r=>({interval:r.interval,direction:r.direction,rsi:r.rsi,priceVsSma50:r.price>r.sma50,priceVsSma200:r.price>r.sma200})),bullish,bearish},sources:[{name:'Binance',use:`Live ${unique.join(', ')} OHLCV + 24h ticker`,freshness:'Fetched at request time',url:'https://www.binance.com/en/markets'}],evidenceQuality:'LIVE — provider response received at request time; multi-timeframe consensus calculated by FinPilot'};
}
function cryptoTimeframe(klines,ticker,interval){
 const closes=klines.map(x=>Number(x[4]));
 const rows=klines.map(x=>[Number(x[0]),Number(x[1]),Number(x[2]),Number(x[3]),Number(x[4]),Number(x[5])]);
 const price=Number(ticker.lastPrice), prev=Number(ticker.prevClosePrice), high=Number(ticker.highPrice), low=Number(ticker.lowPrice);
 const s20=sma(closes,20),s50=sma(closes,50),s200=sma(closes,200),e20=ema(closes,20),rr=rsi(closes),aa=atr(rows);
 const vol20=sma(rows.map(x=>x[5]),20), vm=vol20?Number(ticker.volume)/vol20:null;
 const resistance=Math.max(...rows.slice(-48).map(x=>x[2])), support=Math.min(...rows.slice(-48).map(x=>x[3]));
 const direction=price>s200&&price>s50&&rr>=50?'BULLISH':price<s200&&price<s50&&rr<50?'BEARISH':'MIXED';
 const risk=Math.min(100,Math.max(10,Math.round(35+(rr>70?20:rr<40?8:0)+(price>s200?0:15)+(price>resistance*.995?12:0)+(vm&&vm>1.8?5:0))));
 const candles=rows.slice(-120).map(x=>({time:new Date(x[0]).toISOString(),open:x[1],high:x[2],low:x[3],close:x[4],volume:x[5]}));
 return {interval,price,previous:prev,dayHigh:high,dayLow:low,rsi:rr,atr:aa,sma20:s20,sma50:s50,sma200:s200,ema20:e20,volumeMultiple:vm,resistance,support,riskScore:risk,direction,trend:price>s200?'Long-term bullish':'Below 200-period trend',targets:[{label:'Breakout confirmation',price:resistance,logic:`Recent ${interval} resistance; acceptance above with participation strengthens the breakout case.`},{label:'ATR extension zone',price:resistance+(aa||0)*2,logic:'Two ATRs above resistance; scenario level, not a promised target.'},{label:'Mean-reversion zone',price:e20||s20,logic:'20-period trend/value area; loss increases short-term pullback risk.'}],risks:[{label:'Momentum exhaustion',level:rr>75?'HIGH':rr>65?'MEDIUM':'LOW'},{label:'Volatility risk',level:'HIGH'},{label:'Trend breakdown',level:price>s50?'MEDIUM':'HIGH'},{label:'False breakout',level:price>=resistance*.995?'HIGH':'MEDIUM'}],signals:[{name:'RSI',value:rr,interpretation:rr>70?'Overbought / stretched':rr<40?'Weak momentum':'Neutral-to-positive'},{name:'20-period EMA',value:e20,interpretation:price>e20?'Price above short-term trend':'Price below short-term trend'},{name:'50-period SMA',value:s50,interpretation:price>s50?'Medium trend supportive':'Medium trend weak'},{name:'200-period SMA',value:s200,interpretation:price>s200?'Long trend supportive':'Long trend weak'},{name:'Volume',value:vm,interpretation:vm>1.5?'Participation elevated':'Participation normal'}],candles};
}
function btcFallback(errorMessage='LIVE_PROVIDER_UNAVAILABLE'){
 return {
  ticker:'BTC',assetType:'crypto',name:'Bitcoin',market:'CRYPTO',
  live:false,available:false,provider:null,asOf:null,
  error:'LIVE_MARKET_DATA_UNAVAILABLE',
  message:'Live BTC market data could not be verified right now. FinPilot will not substitute a hardcoded price.',
  providerError:String(errorMessage||'provider unavailable'),
  candles:[],sources:[],evidenceQuality:'UNAVAILABLE — no verified live provider response'
 };
}

function coreClamp(n,a=0,b=100){return Math.max(a,Math.min(b,n))}
function derivativeDecision(report, instrument, riskBudget=1){
 const mt=report?.multiTimeframe?.consensus||'MIXED';
 const rsi=Number(report?.rsi||50), risk=Number(report?.riskScore||70);
 let bull=50;
 if(mt==='BULLISH') bull+=16; else if(mt==='BEARISH') bull-=16;
 if(rsi>=55&&rsi<=72) bull+=8; else if(rsi>80) bull-=8; else if(rsi<35) bull+=3;
 if(Number(report?.price||0)>Number(report?.sma50||0)) bull+=7; else bull-=7;
 if(Number(report?.price||0)>Number(report?.sma200||0)) bull+=5; else bull-=5;
 bull-=Math.max(0,risk-55)*0.22;
 bull=coreClamp(Math.round(bull));
 const bear=coreClamp(Math.round(100-bull-Math.max(0,8-Math.abs(50-bull)*0.05)));
 const neutral=coreClamp(100-bull-bear);
 const side=bull>=62?'CALL / LONG BIAS':bear>=62?'PUT / SHORT BIAS':'WAIT / NO EDGE';
 const ceo=instrument==='OPTION'&&risk>70?'WAIT — preserve optionality until volatility and confirmation improve':
   bull>=68?'CONDITIONAL LONG — confirmation required':bear>=68?'CONDITIONAL SHORT — confirmation required':'WAIT — insufficient edge';
 const cfo=(riskBudget>2||risk>=78)?'REJECT — risk budget / leverage too high':
   side==='WAIT / NO EDGE'?'WAIT — capital not justified without edge':
   `LIMIT RISK — max ${Math.min(2,Math.max(.25,riskBudget)).toFixed(2)}% of capital at risk; approval required`;
 return {probability:{bullish:bull, bearish:bear, neutral},side,ceoDecision:ceo,cfoDecision:cfo,confidence:Math.round((Math.max(bull,bear)-neutral)*0.7+30),modelNote:'Model probability is a scenario score, not a guaranteed probability of profit or price direction.',approvalRequired:true};
}

const INDIA_EQUITIES={
 TCS:'TCS.NS',INFY:'INFY.NS',RELIANCE:'RELIANCE.NS',GAIL:'GAIL.NS',HINDZINC:'HINDZINC.NS',
 ITC:'ITC.NS',TATAPOWER:'TATAPOWER.NS',TATASTEEL:'TATASTEEL.NS',SUNPHARMA:'SUNPHARMA.NS',
 TRENT:'TRENT.NS',TECHM:'TECHM.NS',HCLTECH:'HCLTECH.NS',INDIGO:'INDIGO.NS',JUBLFOOD:'JUBLFOOD.NS',
 PAYTM:'PAYTM.NS',IRFC:'IRFC.NS',SBIN:'SBIN.NS',HDFCBANK:'HDFCBANK.NS',ICICIBANK:'ICICIBANK.NS',
 BHARTIARTL:'BHARTIARTL.NS',LT:'LT.NS',ADANIPORTS:'ADANIPORTS.NS',BAJFINANCE:'BAJFINANCE.NS',
 HINDALCO:'HINDALCO.NS',WIPRO:'WIPRO.NS',MARUTI:'MARUTI.NS',AXISBANK:'AXISBANK.NS',KOTAKBANK:'KOTAKBANK.NS'
};
function yahooSymbol(t){const k=String(t||'').trim().toUpperCase();return INDIA_EQUITIES[k]||(/^[A-Z0-9._-]+$/.test(k)?(k.endsWith('.NS')?k:`${k}.NS`):null);}
async function fetchYahooChart(symbol,range='5d',interval='1h'){
 const hosts=['query1.finance.yahoo.com','query2.finance.yahoo.com'];
 let last='provider unavailable';
 for(const host of hosts){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
  try{
   const url=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
   const r=await fetch(url,{headers:{'User-Agent':'FinPilot/8.1 market-data-adapter','Accept':'application/json'},signal:controller.signal});
   if(!r.ok){last=`HTTP ${r.status}`;if(r.status===429)throw new Error('YAHOO_RATE_LIMIT');continue}
   const payload=await r.json(),result=payload?.chart?.result?.[0];
   if(result?.timestamp?.length)return result;
   last='empty chart result';
  }catch(e){last=e?.name==='AbortError'?'timeout':String(e?.message||e)}
  finally{clearTimeout(timer)}
 }
 throw new Error(last);
}
async function fetchTejEod(symbol){
 const clean=String(symbol||'').toUpperCase().replace(/\\.NS$/,'').replace(/[^A-Z0-9&-]/g,'');
 if(!clean)throw new Error('Invalid NSE symbol for TejHQ fallback.');
 const now=new Date(),to=now.toISOString().slice(0,10),from=new Date(now.getTime()-120*86400000).toISOString().slice(0,10);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
 try{
  const url='https://api.tejhq.dev/v1/ohlcv/nse/'+encodeURIComponent(clean)+'?from='+from+'&to='+to;
  const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.1 TejHQ-EOD-fallback'},signal:controller.signal});
  if(!r.ok)throw new Error('TejHQ HTTP '+r.status);
  const payload=await r.json(),rows=Array.isArray(payload?.data)?payload.data:[];
  const candles=rows.map(x=>({time:String(x.date).length===10?String(x.date)+'T15:30:00+05:30':String(x.date),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  if(candles.length<2)throw new Error('TejHQ returned insufficient EOD candles.');
  const last=rows[rows.length-1]||{},price=Number(last.last??last.close??candles.at(-1).close),prev=Number(last.prev_close??candles.at(-2).close),closes=candles.map(x=>x.close),highs=candles.map(x=>x.high),lows=candles.map(x=>x.low),vols=candles.map(x=>x.volume).filter(Number.isFinite);
  const rr=rsi(closes),s20=sma(closes,20),s50=sma(closes,50),avgVol=vols.length?sma(vols,Math.min(20,vols.length)):null,volume=Number(last.volume??vols.at(-1)),volumeRatio=avgVol&&avgVol>0?volume/avgVol:null;
  const changePct=prev?((price-prev)/prev)*100:0,recentHigh=Math.max(...highs.slice(-20)),recentLow=Math.min(...lows.slice(-20));
  const momentum=Number.isFinite(s20)&&s20?((price/s20)-1)*100:0;
  const score=Math.round(Math.max(0,Math.min(100,50+changePct*4+momentum*3+(rr>55?8:rr<45?-8:0)+(volumeRatio&&volumeRatio>1.25?8:0))));
  return {ticker:clean,symbol:clean+'.NS',market:'INDIA_EQUITY',exchange:'NSE',name:String(last.name||clean),currency:'INR',price,previous:prev,changePct,dayHigh:Number(last.high??candles.at(-1).high),dayLow:Number(last.low??candles.at(-1).low),rsi:rr,sma20:s20,sma50:s50,volume,volumeRatio,recentHigh,recentLow,momentum,score,candles,live:false,provider:'TejHQ NSE EOD · keyless public fallback',providerLatencyMs:0,asOf:String(last.date||to)+'T20:30:00+05:30',dataFreshness:'EOD',dataDisclaimer:'End-of-day NSE OHLCV fallback. TradingView chart is shown separately when intraday data is unavailable; verify the broker/exchange quote before acting.'};
 }catch(e){if(e.name==='AbortError')throw new Error('TejHQ timeout');throw e}
 finally{clearTimeout(timer)}
}
async function liveEquity(ticker){
 const symbol=yahooSymbol(ticker); if(!symbol)throw new Error('Unsupported equity symbol.');
 const started=Date.now();
 let result,sourceRange='5d/1h';
 try{result=await fetchYahooChart(symbol,'5d','1h')}
 catch(e){
  try{result=await fetchYahooChart(symbol,'1mo','1d');sourceRange='1mo/1d'}
  catch(e2){
   try{return await fetchTejEod(ticker)}
   catch(e3){throw new Error(`Equity chart unavailable: Yahoo=${e2.message}; TejHQ=${e3.message}`)}
  }
 }
 const meta=result.meta||{},q=result.indicators?.quote?.[0]||{};
 const closes=(q.close||[]).map(Number).filter(Number.isFinite),highs=(q.high||[]).map(Number).filter(Number.isFinite),lows=(q.low||[]).map(Number).filter(Number.isFinite),vols=(q.volume||[]).map(Number).filter(Number.isFinite);
 const price=Number(meta.regularMarketPrice??closes.at(-1)); if(!Number.isFinite(price))throw new Error('Equity price unavailable.');
 const prev=Number(meta.chartPreviousClose??meta.previousClose??closes.at(-2)??price);
 const changePct=prev?((price-prev)/prev)*100:0, s20=sma(closes,20),s50=sma(closes,50);
 const avgVol=vols.length?sma(vols,Math.min(20,vols.length)):null,volume=vols.at(-1)??null,volumeRatio=avgVol&&avgVol>0?volume/avgVol:null;
 const rr=rsi(closes), recentHigh=Math.max(...highs.slice(-24)),recentLow=Math.min(...lows.slice(-24));
 const momentum=(Number.isFinite(s20)&&s20?((price/s20)-1)*100:0);
 const score=Math.round(Math.max(0,Math.min(100,50+changePct*4+momentum*3+(rr>55?8:rr<45?-8:0)+(volumeRatio&&volumeRatio>1.25?8:0))));
 const candles=(result.timestamp||[]).map((ts,i)=>({time:new Date(Number(ts)*1000).toISOString(),open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),close:Number(q.close?.[i]),volume:Number(q.volume?.[i])})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
 if(candles.length<2)throw new Error('Equity provider returned insufficient candles.');
 return {ticker:String(ticker).toUpperCase().replace('.NS',''),symbol,market:'INDIA_EQUITY',exchange:'NSE',name:String(meta.longName||meta.shortName||ticker),currency:String(meta.currency||'INR'),price,previous:prev,changePct,dayHigh:Number(meta.regularMarketDayHigh??Math.max(...highs.slice(-24))),dayLow:Number(meta.regularMarketDayLow??Math.min(...lows.slice(-24))),rsi:rr,sma20:s20,sma50:s50,volume,volumeRatio,recentHigh,recentLow,momentum,score,candles,live:true,provider:`Yahoo Finance chart adapter · ${sourceRange} (unofficial; recent/delayed data may apply)`,providerLatencyMs:Date.now()-started,asOf:new Date().toISOString(),dataDisclaimer:'Recent market data for analysis only; verify the broker/exchange quote before acting.'};
}
async function marketPicks(req,res,u){
 const limit=Math.min(10,Math.max(3,Number(u.searchParams.get('limit')||5)));
 const requested=(u.searchParams.get('tickers')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
 const universe=requested.length?requested:[...new Set(Object.keys(INDIA_EQUITIES))];
 const rows=await Promise.all(universe.map(async t=>{try{return await liveEquity(t)}catch(e){return null}}));
 const ranked=rows.filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,limit);
 return send(res,200,{ok:true,live:ranked.length>0,market:'INDIA_EQUITY',count:ranked.length,asOf:new Date().toISOString(),candidates:ranked,method:'Live recent/delayed NSE equity scan ranked by price change, momentum, RSI and relative volume.',provider:'Yahoo Finance chart adapter (unofficial)',disclaimer:'Not a guaranteed best stock or personalized recommendation. Verify current exchange/broker data before any decision.'});
}

async function stockReport(req,res,u){
 const t=(u.searchParams.get('ticker')||'').trim().toUpperCase();
 const interval=u.searchParams.get('interval')||'1h';
 const multi=u.searchParams.get('multi')!=='0';
 const cacheKey=`stock:${t}:${interval}:${multi}`;
 try{
   const hit=getCached(cacheKey); if(hit) return send(res,200,{...hit,cached:true});
   if(CRYPTO_ASSETS[t]){
     const payload={ok:true,report:await liveCrypto(t,interval,multi)};
     cached(cacheKey,payload);
     return send(res,200,payload);
   }
   if(yahooSymbol(t)){
     try{
       const payload={ok:true,report:await liveEquity(t)};
       cached(cacheKey,payload);
       return send(res,200,payload);
     }catch(liveErr){
       if(t==='SBC'){
         const payload={ok:true,report:{...SBC_SERVER,live:false,provider:'FinPilot verified snapshot fallback',warning:'Live market provider unavailable; snapshot shown instead of inventing a price.'}};
         return send(res,200,payload);
       }
       throw liveErr;
     }
   }
   return send(res,404,{ok:false,error:'Ticker not connected. Use an NSE symbol such as TCS, INFY or RELIANCE.'});
 }catch(e){ if(t==='BTC'||t==='BTCUSDT') return send(res,200,{ok:true,report:btcFallback(),warning:e.message}); return send(res,502,{ok:false,error:`Live market provider unavailable for ${t}: ${e.message}`}); }
}
const SBC_SERVER={ticker:'SBC',name:'SBC Exports Ltd.',exchange:'NSE',asOf:'2026-10-05',price:62.04,previous:58.54,week52High:63.10,week52Low:21.50,support:45.38,rsi:89.96,adx:43.84,vwap20:52.69,vwap50:46.95,volumeMultiple:2.33,pe:77.2,roce:18.4,roe:37.2,riskScore:86,trend:'Strong uptrend',posture:'WATCH / MOMENTUM',conclusion:'Trend and participation are strong, but the evidence set also shows extreme momentum extension and valuation risk. The engine therefore prioritizes confirmation and risk control over chasing strength.',targets:[{label:'Immediate breakout zone',price:63.10,logic:'52-week high; sustained acceptance above it would indicate price discovery.'},{label:'Extension checkpoint',price:66.00,logic:'Illustrative scenario level above the prior high; requires fresh evidence and volume confirmation.'},{label:'Deeper value / reset zone',price:52.69,logic:'20-day VWAP; loss of this zone would weaken the short-term momentum thesis.'}],risks:[{label:'Momentum exhaustion',level:'HIGH'},{label:'Valuation / expectation risk',level:'HIGH'},{label:'Pullback to VWAP',level:'MEDIUM'},{label:'Trend breakdown',level:'MEDIUM'}],sources:[{name:'NSE',url:'https://www.nseindia.com/get-quotes/equity?symbol=SBC',use:'Price, range, volume and market statistics',freshness:'5 Oct 2026 snapshot'},{name:'Screener',url:'https://www.screener.in/company/SBC/',use:'Valuation and return metrics',freshness:'5 Oct 2026 snapshot'},{name:'Flash Finance',url:'https://flashfinance.in/technical-analysis/SBC/',use:'RSI, ADX, VWAP and momentum context',freshness:'5 Oct 2026 snapshot'}]};



function optionScore(o, spot){
  const mid=(Number(o.bidPrice||0)+Number(o.askPrice||0))/2 || Number(o.markPrice||o.lastPrice||0);
  const spread=mid>0 && o.bidPrice!=null && o.askPrice!=null ? Math.max(0,(Number(o.askPrice)-Number(o.bidPrice))/mid) : null;
  const moneyness=spot>0 ? Math.abs(Number(o.strikePrice||0)-spot)/spot : 1;
  const oi=Number(o.openInterest||0), vol=Number(o.volume||0);
  let score=50;
  score += Math.min(18,Math.log10(oi+1)*4);
  score += Math.min(15,Math.log10(vol+1)*5);
  score -= Math.min(18,moneyness*120);
  if(spread!=null) score-=Math.min(20,spread*100);
  if(Number(o.optionSide)==1 || String(o.side||'').toUpperCase()==='CALL') score+=3;
  return Math.max(0,Math.min(100,Math.round(score)));
}
async function optionChainScan(req,res,u){
 const t=(u.searchParams.get('ticker')||'BTC').toUpperCase(); const side=(u.searchParams.get('side')||'BOTH').toUpperCase(); const limit=Math.min(30,Math.max(6,Number(u.searchParams.get('limit')||18)));
 try{
   const symbol=CRYPTO_ASSETS[t]; if(!symbol) throw new Error('Unsupported crypto option underlying.');
   const spot=Number((await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`)).price);
   const info=await fetchJson('https://eapi.binance.com/eapi/v1/exchangeInfo');
   const rows=Array.isArray(info.optionSymbols)?info.optionSymbols.filter(x=>String(x.underlying||'').startsWith(t+'-') && x.expiryDate>Date.now() && (x.status===1 || String(x.status).toUpperCase()==='TRADING')):[];
   if(!rows.length) throw new Error('No active option contracts returned by provider.');
   const nearestExpiry=Math.min(...rows.map(x=>x.expiryDate));
   const near=rows.filter(x=>x.expiryDate===nearestExpiry && (side==='BOTH'||String(x.side||'').toUpperCase()===side));
   const selected=near.sort((a,b)=>Math.abs(Number(a.strikePrice)-spot)-Math.abs(Number(b.strikePrice)-spot)).slice(0,limit);
   const tickers=await Promise.all(selected.map(async x=>{try{return {...x,...(await fetchJson(`https://eapi.binance.com/eapi/v1/ticker?symbol=${encodeURIComponent(x.symbol)}`))}}catch{return x}}));
   const contracts=tickers.map(x=>({symbol:x.symbol,side:x.side,expiry:x.expiryDate,strike:Number(x.strikePrice),bidPrice:x.bidPrice==null?null:Number(x.bidPrice),askPrice:x.askPrice==null?null:Number(x.askPrice),markPrice:x.markPrice==null?null:Number(x.markPrice),lastPrice:x.lastPrice==null?null:Number(x.lastPrice),volume:x.volume==null?null:Number(x.volume),openInterest:x.openInterest==null?null:Number(x.openInterest),score:optionScore(x,spot)}));
   const calls=contracts.filter(x=>String(x.side).toUpperCase()==='CALL').sort((a,b)=>b.score-a.score); const puts=contracts.filter(x=>String(x.side).toUpperCase()==='PUT').sort((a,b)=>b.score-a.score);
   const top=[...calls.slice(0,3),...puts.slice(0,3)].sort((a,b)=>b.score-a.score);
   const callAvg=calls.length?calls.reduce((a,x)=>a+x.score,0)/calls.length:0, putAvg=puts.length?puts.reduce((a,x)=>a+x.score,0)/puts.length:0;
   const bull=Math.round(Math.max(0,Math.min(100,50+(callAvg-putAvg)*0.55))); const bear=100-bull; const confidence=Math.round(Math.min(94,55+Math.abs(callAvg-putAvg)*0.55));
   const sideDecision=confidence<65?'WAIT / LOW EDGE':bull>=58?'CALL / LONG BIAS':bear>=58?'PUT / SHORT BIAS':'WAIT / BALANCED';
   const ceo=sideDecision.startsWith('WAIT')?'CEO: WAIT — edge is insufficient for a leveraged decision.':`CEO: ${sideDecision} — use the highest-scoring liquid contract only after confirmation.`;
   const cfo=sideDecision.startsWith('WAIT')||confidence<70?'CFO: REJECT — do not allocate leveraged capital without stronger edge and live contract evidence.':`CFO: CONDITIONAL — cap risk, verify liquidity/spread, and require explicit approval.`;
   return send(res,200,{ok:true,live:true,provider:'Binance European Options public market data',ticker:t,spot,expiry:new Date(nearestExpiry).toISOString(),contracts,top,decision:{probability:{bullish:bull,bearish:bear,neutral:Math.max(0,100-Math.max(bull,bear))},side:sideDecision,confidence,ceoDecision:ceo,cfoDecision:cfo,method:'Scenario score from moneyness, bid/ask spread, volume and open-interest evidence; not probability of profit.'},compliance:{execution:false,leverageWarning:true,humanApprovalRequired:true},source:'Binance public derivatives market data'});
 }catch(e){return send(res,200,{ok:true,live:false,ticker:t,contracts:[],decision:{probability:{bullish:null,bearish:null,neutral:100},side:'WAIT / NO LIVE CHAIN',confidence:0,ceoDecision:'CEO: WAIT — live option-chain evidence unavailable.',cfoDecision:'CFO: REJECT — no leveraged capital allocation without live chain evidence.',method:'No contract-specific probabilities are fabricated.'},error:e.message,compliance:{execution:false,leverageWarning:true,humanApprovalRequired:true}})}
}

async function derivativesReport(req,res,u){
 const t=(u.searchParams.get('ticker')||'BTC').toUpperCase();
 const instrument=(u.searchParams.get('instrument')||'FUTURE').toUpperCase();
 const riskBudget=Number(u.searchParams.get('riskBudget')||1);
 try{
   const base=await liveCrypto(t,'1h',true);
   let derivatives={instrument,live:false,provider:'Binance derivatives public API',contract:null,markPrice:null,fundingRate:null,openInterest:null,optionChainAvailable:false};
   if(instrument==='FUTURE'){
     const symbol=CRYPTO_ASSETS[t]||t+'USDT';
     const [mark,oi]=await Promise.all([
       fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
       fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`)
     ]);
     derivatives={...derivatives,live:true,markPrice:Number(mark.markPrice),fundingRate:Number(mark.lastFundingRate),nextFundingTime:mark.nextFundingTime,openInterest:Number(oi.openInterest)};
   } else if(instrument==='OPTION'){
     const info=await fetchJson('https://eapi.binance.com/eapi/v1/exchangeInfo');
     const symbols=Array.isArray(info.optionSymbols)?info.optionSymbols.filter(x=>String(x.underlying||'').startsWith(t+'-')):[];
     const active=symbols.filter(x=>x.expiryDate>Date.now()&&x.status===1);
     const expiry=active.sort((a,b)=>a.expiryDate-b.expiryDate)[0];
     if(!expiry) throw new Error(`No active ${t} option contracts returned by provider.`);
     let quote=null; try{quote=await fetchJson(`https://eapi.binance.com/eapi/v1/ticker?symbol=${encodeURIComponent(expiry.symbol)}`)}catch{}
     derivatives={...derivatives,live:true,optionChainAvailable:true,contract:expiry.symbol,expiry:new Date(expiry.expiryDate).toISOString(),strike:Number(expiry.strikePrice),optionType:expiry.side,markPrice:quote?.markPrice?Number(quote.markPrice):null,lastPrice:quote?.lastPrice?Number(quote.lastPrice):null};
   } else throw new Error('Instrument must be FUTURE or OPTION.');
   const decision=derivativeDecision(base,instrument,riskBudget);
   return send(res,200,{ok:true,ticker:t,underlying:base,derivatives,decision,compliance:{mode:'Financial information & decision support',personalizedAdvice:false,execution:false,leverageWarning:true,suitabilityRequired:true,explicitApprovalRequired:true},evidence:[...base.sources,{name:'Binance derivatives API',use:`${instrument} market structure`,freshness:'Fetched at request time',url:'https://www.binance.com/en/markets'}]});
 }catch(e){
   return send(res,200,{ok:true,ticker:t,derivatives:{instrument,live:false,provider:'Binance derivatives public API',error:e.message},decision:{probability:{bullish:null,bearish:null,neutral:100},side:'WAIT / NO LIVE DATA',ceoDecision:'WAIT — live derivatives evidence unavailable',cfoDecision:'REJECT — do not allocate capital without live contract data',confidence:0,approvalRequired:true,modelNote:'FinPilot refuses to fabricate option/futures prices, funding, open interest or probabilities when the live provider is unavailable.'},compliance:{mode:'Financial information & decision support',personalizedAdvice:false,execution:false,leverageWarning:true,suitabilityRequired:true,explicitApprovalRequired:true}});
 }
}


function normCdf(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const sign=x<0?-1:1;const z=Math.abs(x)/Math.sqrt(2);const t=1/(1+p*z);const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-z*z);return 0.5*(1+sign*y)}
function bsPrice(S,K,T,r,sigma,type='CALL'){if(!(S>0&&K>0&&T>0&&sigma>0))return null;const d1=(Math.log(S/K)+(r+sigma*sigma/2)*T)/(sigma*Math.sqrt(T));const d2=d1-sigma*Math.sqrt(T);return type==='CALL'?S*normCdf(d1)-K*Math.exp(-r*T)*normCdf(d2):K*Math.exp(-r*T)*normCdf(-d2)-S*normCdf(-d1)}
function greeks(S,K,T,r,sigma,type='CALL'){if(!(S>0&&K>0&&T>0&&sigma>0))return {};const d1=(Math.log(S/K)+(r+sigma*sigma/2)*T)/(sigma*Math.sqrt(T));const d2=d1-sigma*Math.sqrt(T);const pdf=Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI);const delta=type==='CALL'?normCdf(d1):normCdf(d1)-1;const gamma=pdf/(S*sigma*Math.sqrt(T));const theta=type==='CALL'?(-(S*pdf*sigma)/(2*Math.sqrt(T))-r*K*Math.exp(-r*T)*normCdf(d2)):(-(S*pdf*sigma)/(2*Math.sqrt(T))+r*K*Math.exp(-r*T)*normCdf(-d2));const vega=S*pdf*Math.sqrt(T);return {delta,gamma,theta,vega}}
async function optionsMath(req,res,u){const S=Number(u.searchParams.get('spot')||0),K=Number(u.searchParams.get('strike')||0),T=Number(u.searchParams.get('days')||30)/365,r=Number(u.searchParams.get('rate')||0.06),iv=Number(u.searchParams.get('iv')||0.6),type=(u.searchParams.get('type')||'CALL').toUpperCase();if(!(S&&K&&T&&iv))return send(res,400,{ok:false,error:'spot, strike, days and iv are required'});const price=bsPrice(S,K,T,r,iv,type),g=greeks(S,K,T,r,iv,type);return send(res,200,{ok:true,engine:'options-math-v3600',inputs:{spot:S,strike:K,days:T*365,rate:r,iv,type},theoreticalPrice:price,greeks:g,warning:'Model output is theoretical, not a probability of profit and not a trading recommendation.'})}
async function chainAnalytics(req,res,u){const ticker=(u.searchParams.get('ticker')||'BTC').toUpperCase();try{const spot=Number((await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${CRYPTO_ASSETS[ticker]||'BTCUSDT'}`)).price);const days=Number(u.searchParams.get('days')||7);const iv=Number(u.searchParams.get('iv')||0.65);const strikes=[-0.08,-0.05,-0.03,0,0.03,0.05,0.08].map(x=>Math.round(spot*(1+x)/100)*100);const rows=strikes.flatMap(K=>['CALL','PUT'].map(type=>{const m=greeks(spot,K,days/365,.06,iv,type);const theo=bsPrice(spot,K,days/365,.06,iv,type);const moneyness=((spot-K)/spot)*100;return {ticker,spot,strike:K,type,days,iv,theoreticalPrice:theo,moneyness,delta:m.delta,gamma:m.gamma,theta:m.theta,vega:m.vega,score:Math.round(Math.max(0,100-Math.abs(moneyness)*3-Math.max(0,Math.abs(m.delta)-.8)*60))}}));return send(res,200,{ok:true,live:true,provider:'Binance spot + FinPilot theoretical options model',ticker,spot,rows,generatedAt:new Date().toISOString(),warning:'Synthetic strikes and theoretical prices are not a live executable option chain. Use a licensed/authorized options-chain feed for contract selection.'})}catch(e){return send(res,200,{ok:true,live:false,provider:'Options math fallback',ticker,error:e.message,rows:[],generatedAt:new Date().toISOString()})}}
function roundTableDecision(req,res,u){const bull=Number(u.searchParams.get('bull')||0),bear=Number(u.searchParams.get('bear')||0),risk=Number(u.searchParams.get('risk')||50),confidence=Number(u.searchParams.get('confidence')||0);const votes={bullAgent:bull>=55?'LONG':'WAIT',bearAgent:bear>=55?'SHORT':'WAIT',riskAgent:risk>=65?'REJECT':'ALLOW',cfo:risk>=55?'CAPITAL PROTECT':'CAPITAL AVAILABLE'};let ceo='WAIT';if(confidence>=70&&bull>=65&&risk<45)ceo='LONG BIAS';else if(confidence>=70&&bear>=65&&risk<45)ceo='SHORT BIAS';return send(res,200,{ok:true,engine:'round-table-v3800',votes,ceoDecision:ceo,reason:ceo==='WAIT'?'Evidence is not strong enough to overcome uncertainty or risk.':'Consensus threshold met with risk controls.',humanApprovalRequired:true})}
function riskGuard(req,res,u){const leverage=Number(u.searchParams.get('leverage')||1),riskPct=Number(u.searchParams.get('riskPct')||1),liquidity=Number(u.searchParams.get('liquidity')||100),confidence=Number(u.searchParams.get('confidence')||0);const flags=[];if(leverage>3)flags.push('HIGH_LEVERAGE');if(riskPct>2)flags.push('RISK_BUDGET_EXCEEDED');if(liquidity<60)flags.push('LOW_LIQUIDITY');if(confidence<65)flags.push('LOW_CONFIDENCE');const blocked=flags.length>0;return send(res,200,{ok:true,engine:'derivatives-risk-v3900',blocked,flags,limits:{maxSuggestedLeverage:3,maxRiskPct:2,minLiquidityScore:60,minConfidence:65},approval:blocked?'CFO REJECT':'CFO REVIEW',note:'Risk guard is a control layer; it does not predict returns.'})}
function commandDecision(req,res,u){const ticker=(u.searchParams.get('ticker')||'BTC').toUpperCase();return send(res,200,{ok:true,engine:'executive-market-command-v4000',ticker,workflow:['Market Data','Technical Engine','Options Math','Bull Agent','Bear Agent','Risk Agent','CFO','CEO'],principles:['Fresh evidence required','Conflicts surfaced','No fabricated live contracts','CFO can veto','CEO cannot bypass compliance','Human approval required before execution'],status:'ANALYSIS_ONLY'})}



// FinPilot 4.2 -> 5.0 Autonomous Intelligence Core
const AGENT_MEMORY=new Map();
const EVIDENCE_LEDGER=[];
const MARKET_EVENTS=[];
const DECISION_CACHE=new Map();
const RESEARCH_QUEUE=[];
const PORTFOLIO_STATE={positions:[],cash:0};
const CORE={version:'7.0',started:Date.now(),eventScans:0,decisions:0,cacheHits:0};
function coreKey(x){return JSON.stringify(x||{});}
function remember(agent,entry){const k=String(agent||'Unknown');const a=AGENT_MEMORY.get(k)||{agent:k,runs:0,decisions:0,lessons:[]};a.runs++;a.decisions+=entry.decision?1:0;if(entry.lesson)a.lessons.unshift(entry.lesson);a.lessons=a.lessons.slice(0,20);AGENT_MEMORY.set(k,a);return a;}
function evidenceFusion(req,res){
 const x=JSON.parse(req._bodyCache||'{}');
 const items=Array.isArray(x.evidence)?x.evidence:[]; const grouped={};
 for(const e of items){const topic=String(e.topic||e.domain||'general');(grouped[topic]??=[]).push(e)}
 const topics=Object.entries(grouped).map(([topic,arr])=>{const fresh=arr.filter(e=>e.fresh!==false).length;const supports=arr.filter(e=>String(e.direction||'').toUpperCase()==='BULL').length;const opposes=arr.filter(e=>String(e.direction||'').toUpperCase()==='BEAR').length;const conflict=supports>0&&opposes>0;return {topic,count:arr.length,freshness:Math.round(fresh/Math.max(1,arr.length)*100),bull:supports,bear:opposes,conflict,confidence:coreClamp(55+Math.min(25,arr.length*4)-(conflict?20:0)-(fresh<arr.length?10:0),0,95)}});
 const conflicts=topics.filter(t=>t.conflict).length; const confidence=topics.length?Math.round(topics.reduce((a,t)=>a+t.confidence,0)/topics.length):0;
 EVIDENCE_LEDGER.push(...items.slice(0,50).map(e=>({...e,receivedAt:new Date().toISOString()}))); while(EVIDENCE_LEDGER.length>500)EVIDENCE_LEDGER.shift();
 return send(res,200,{ok:true,engine:'evidence-fusion-v4400',topics,conflicts,overallConfidence:confidence,staleEvidence:items.filter(e=>e.fresh===false).length,ledgerSize:EVIDENCE_LEDGER.length});
}
function agentMemory(req,res){const data=[...AGENT_MEMORY.values()];return send(res,200,{ok:true,engine:'agent-memory-v4200',agents:data,totalAgents:data.length});}
function recordMemory(req,res){const x=JSON.parse(req._bodyCache||'{}');const m=remember(x.agent,{decision:x.decision,lesson:x.lesson||''});return send(res,200,{ok:true,memory:m});}
function detectEvents(req,res){
 const x=JSON.parse(req._bodyCache||'{}'); const price=Number(x.price||0),prev=Number(x.previous||price),vol=Number(x.volumeRatio||1),rsiV=Number(x.rsi||50),oi=Number(x.openInterestChange||0); CORE.eventScans++;
 const events=[]; const move=prev?((price-prev)/prev*100):0;
 if(Math.abs(move)>=3)events.push({type:'PRICE_SHOCK',severity:Math.abs(move)>=6?'HIGH':'MEDIUM',message:`Price moved ${move.toFixed(2)}%`});
 if(vol>=2)events.push({type:'VOLUME_EXPANSION',severity:'MEDIUM',message:`Volume is ${vol.toFixed(1)}× baseline`});
 if(rsiV>=80)events.push({type:'OVERBOUGHT',severity:'HIGH',message:`RSI ${rsiV.toFixed(1)}`});
 if(rsiV<=20)events.push({type:'OVERSOLD',severity:'HIGH',message:`RSI ${rsiV.toFixed(1)}`});
 if(Math.abs(oi)>=8)events.push({type:'OPEN_INTEREST_SHIFT',severity:'MEDIUM',message:`Open interest changed ${oi.toFixed(1)}%`});
 MARKET_EVENTS.push(...events.map(e=>({...e,ticker:x.ticker||'UNKNOWN',time:new Date().toISOString()})));while(MARKET_EVENTS.length>500)MARKET_EVENTS.shift();
 return send(res,200,{ok:true,engine:'event-detector-v4400',ticker:x.ticker||'UNKNOWN',events,scannedAt:new Date().toISOString()});
}
function portfolioRisk(req,res){const x=JSON.parse(req._bodyCache||'{}');const positions=Array.isArray(x.positions)?x.positions:PORTFOLIO_STATE.positions;const cash=Number(x.cash??PORTFOLIO_STATE.cash)||0;const total=positions.reduce((a,p)=>a+Math.abs(Number(p.notional)||0),0)+cash;const concentration=positions.length?Math.max(...positions.map(p=>Math.abs(Number(p.notional)||0)))/Math.max(1,total)*100:0;const leverage=total?positions.reduce((a,p)=>a+Math.abs(Number(p.notional)||0),0)/Math.max(1,cash):0;const risk=coreClamp(Math.round(concentration*.55+Math.max(0,leverage-1)*20),0,100);return send(res,200,{ok:true,engine:'portfolio-risk-v4500',totalExposure:total,concentrationPct:Math.round(concentration),leverage:Math.round(leverage*100)/100,riskScore:risk,flags:[...(concentration>40?['CONCENTRATION']:[]),...(leverage>3?['LEVERAGE']:[])],cfoStance:risk>=65?'REJECT':risk>=45?'PROTECT':'REVIEW'});}
function researchQueue(req,res){const x=JSON.parse(req._bodyCache||'{}');const item={id:requestId(),priority:coreClamp(Number(x.priority||50),0,100),topic:String(x.topic||'Market evidence'),reason:String(x.reason||''),createdAt:new Date().toISOString(),status:'QUEUED'};RESEARCH_QUEUE.push(item);return send(res,200,{ok:true,engine:'research-queue-v4600',item,queue:RESEARCH_QUEUE.slice(-50)});}
function decisionCache(req,res){const x=JSON.parse(req._bodyCache||'{}');const key=coreKey(x);const hit=DECISION_CACHE.get(key);if(hit&&hit.expires>Date.now()){CORE.cacheHits++;return send(res,200,{ok:true,hit:true,decision:hit.value})}const confidence=coreClamp(Number(x.confidence||0),0,100);const decision=confidence>=75?'CONDITIONAL':confidence>=55?'WATCH':'WAIT';const value={decision,confidence,createdAt:new Date().toISOString()};DECISION_CACHE.set(key,{value,expires:Date.now()+30000});CORE.decisions++;return send(res,200,{ok:true,hit:false,decision:value});}
function executionGuard(req,res){const x=JSON.parse(req._bodyCache||'{}');const risk=Number(x.riskScore||100),conf=Number(x.confidence||0),approved=x.userApproved===true;const blocked=!approved||risk>=65||conf<65;return send(res,200,{ok:true,engine:'execution-guard-v4800',status:blocked?'BLOCKED':'READY_FOR_APPROVAL',reasons:[...(!approved?['USER_APPROVAL_REQUIRED']:[]),...(risk>=65?['CFO_RISK_VETO']:[]),...(conf<65?['LOW_CONFIDENCE']:[])],canAutoExecute:false});}
function coreStatus(req,res){return send(res,200,{ok:true,engine:'autonomous-intelligence-core-v5000',version:'7.0',uptimeMs:Date.now()-CORE.started,memoryAgents:AGENT_MEMORY.size,evidenceLedger:EVIDENCE_LEDGER.length,marketEvents:MARKET_EVENTS.length,researchQueue:RESEARCH_QUEUE.length,decisionCache:DECISION_CACHE.size,cacheHits:CORE.cacheHits,decisions:CORE.decisions,features:['persistent-agent-memory','evidence-fusion','contradiction-detection','real-time-event-detection','portfolio-risk','research-queue','decision-cache','execution-guard','CEO-CFO governance','human approval']});}

function marketUniverse(req,res){return send(res,200,{ok:true,crypto:Object.keys(CRYPTO_ASSETS).filter(x=>!x.endsWith('USDT')),equities:Object.keys(INDIA_EQUITIES),timeframes:Object.keys(TIMEFRAMES),providers:[{name:'Binance public market data',status:'public-adapter',coverage:'Supported crypto pairs'},{name:'Yahoo Finance chart adapter',status:'unofficial-recent',coverage:'NSE equity symbols'}],note:'Equity quotes are recent/delayed and must be verified before acting.'})}
function compliance(req,res){return send(res,200,{ok:true,policyVersion:'2026-10-07',jurisdiction:'India',productMode:'Financial information & decision support',regulatedAdvice:false,controls:{transactionExecution:false,guaranteedReturns:false,riskProfilingRequiredForRegulatedAdvice:true,suitabilityRequiredForRegulatedAdvice:true,evidenceRequiredForMarketSensitiveClaims:true,humanApprovalForHighImpactActions:true},sources:[{name:'SEBI Investment Advisers Regulations',url:'https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1740726382475.pdf',freshness:'verified against official SEBI source'},{name:'SEBI Master Circular for Investment Advisers',url:'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6',freshness:'official SEBI listing'}]})}
function staticFile(req,res,u){
 let p=u.pathname==='/'?'/index.html':u.pathname;
 p=path.normalize(p).replace(/^\.{2}(\/|\\)/,'');
 const file=path.join(ROOT,p);
 if(!file.startsWith(ROOT))return send(res,403,{error:'Forbidden'});
 fs.stat(file,(e,s)=>{if(e||!s.isFile())return send(res,404,'Not found','text/plain'); const ext=path.extname(file);res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(),microphone=(),geolocation=(),payment=()','Content-Security-Policy':"default-src 'self'; connect-src 'self' https://api.binance.com https://fapi.binance.com https://eapi.binance.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});fs.createReadStream(file).pipe(res);});
}

// FinPilot 5.1 Security + Real-Time Automation layer
const SECURITY={started:Date.now(),blocked:0,rateLimited:0,events:[],lastRefresh:null};
const RATE=new Map();
const AUTO={enabled:true,marketRefreshMs:5000,agentRefreshMs:15000,maxConcurrentAgents:5,cacheTtlMs:CACHE_TTL_MS,lastOptimization:null,optimizations:0};
function clientKey(req){return String(req.socket?.remoteAddress||'unknown').replace(/^::ffff:/,'');}
function securityEvent(type,detail){SECURITY.events.unshift({type,detail,time:new Date().toISOString()});SECURITY.events=SECURITY.events.slice(0,100);}
function rateCheck(req){const key=clientKey(req), now=Date.now(), windowMs=60000, limit=Number(process.env.FINPILOT_RATE_LIMIT||240);let x=RATE.get(key);if(!x||now-x.start>windowMs)x={start:now,count:0};x.count++;RATE.set(key,x);if(x.count>limit){SECURITY.rateLimited++;securityEvent('RATE_LIMIT',key);return false}return true;}
function securityStatus(req,res){return send(res,200,{ok:true,version:'7.0',headers:['CSP','X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy'],rateLimitPerMinute:Number(process.env.FINPILOT_RATE_LIMIT||240),rateLimited:SECURITY.rateLimited,blocked:SECURITY.blocked,events:SECURITY.events.slice(0,20),secretExposure:'server-only',execution:'human-approval-gated'});}
function realtimeStatus(req,res){return send(res,200,{ok:true,enabled:AUTO.enabled,marketRefreshMs:AUTO.marketRefreshMs,agentRefreshMs:AUTO.agentRefreshMs,maxConcurrentAgents:AUTO.maxConcurrentAgents,cacheTtlMs:AUTO.cacheTtlMs,lastRefresh:SECURITY.lastRefresh,lastOptimization:AUTO.lastOptimization,optimizations:AUTO.optimizations});}
function autoOptimize(req,res){
 const before={marketRefreshMs:AUTO.marketRefreshMs,agentRefreshMs:AUTO.agentRefreshMs,maxConcurrentAgents:AUTO.maxConcurrentAgents,cacheTtlMs:AUTO.cacheTtlMs};
 // Bounded, reversible tuning only. Agents cannot change compliance, execution gates, credentials or security headers.
 const hitRate=PERF.requests?PERF.cacheHits/PERF.requests:0;
 AUTO.marketRefreshMs=Math.max(3000,Math.min(15000,hitRate>.35?7000:5000));
 AUTO.agentRefreshMs=Math.max(10000,Math.min(30000,PERF.errors>5?20000:15000));
 AUTO.maxConcurrentAgents=Math.max(2,Math.min(8,PERF.agentRuns>20?8:5));
 AUTO.cacheTtlMs=Math.max(5000,Math.min(30000,hitRate>.5?20000:10000));
 AUTO.lastOptimization=new Date().toISOString();AUTO.optimizations++;
 const after={marketRefreshMs:AUTO.marketRefreshMs,agentRefreshMs:AUTO.agentRefreshMs,maxConcurrentAgents:AUTO.maxConcurrentAgents,cacheTtlMs:AUTO.cacheTtlMs};
 securityEvent('AUTO_OPTIMIZE','Bounded performance tuning applied; safety/compliance controls unchanged.');
 return send(res,200,{ok:true,mode:'BOUNDED_AUTONOMY',before,after,changes:['refresh cadence','agent concurrency','cache TTL'],protected:['execution guard','CFO veto','compliance policy','security headers','credentials'],time:AUTO.lastOptimization});
}
function marketStream(req,res,u){
 const ticker=(u.searchParams.get('ticker')||'BTC').toUpperCase(); const symbol=CRYPTO_ASSETS[ticker]||'BTCUSDT';
 res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no','X-FinPilot-Version':'7.0'});
 let closed=false, timer; req.on('close',()=>{closed=true;clearInterval(timer);});
 const push=async()=>{if(closed)return;try{const d=await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`); SECURITY.lastRefresh=new Date().toISOString();const payload={ticker,symbol,price:Number(d.lastPrice),changePct:Number(d.priceChangePercent),volume:Number(d.volume),high:Number(d.highPrice),low:Number(d.lowPrice),source:'Binance spot',live:true,time:SECURITY.lastRefresh};const cloudStored=await storeMarketTick(payload);payload.cloudStored=cloudStored;emitEvent('MARKET_TICK',payload,90);res.write(`event: market\ndata: ${JSON.stringify(payload)}\n\n`)}catch(e){res.write(`event: market\ndata: ${JSON.stringify({ticker,symbol,live:false,error:'LIVE_PROVIDER_UNAVAILABLE',time:new Date().toISOString()})}\n\n`)}}
 push(); timer=setInterval(push,AUTO.marketRefreshMs);
}


// FinPilot 5.2 → 7.0 Autonomous Command OS
const EVENT_BUS={seq:0,events:[],subscriptions:new Map(),coalesced:0,routed:0,wakeups:0,dropped:0};
const AGENT_POOL=new Map();
const SCHEDULER={queue:[],running:0,completed:0,failed:0,coalesced:0,lastTick:null,maxConcurrency:5};
const DATA_HEALTH={sources:{binance:{status:'UNKNOWN',latencyMs:null,lastSuccess:null,lastError:null}},qualityScore:0,freshness:'UNKNOWN',updatedAt:null};
const RESILIENCE={providerFailures:0,retries:0,circuitOpen:false,backoffMs:1000,lastIncident:null};
const AUTONOMY={version:'7.0',mode:'GOVERNED_AUTONOMY',level:7,cycles:0,lastCycle:null,optimizations:0,policyBlocks:0,approvals:0};
const AUDIT=[];
const POLICY={execution:'HUMAN_APPROVAL_REQUIRED',moneyMovement:'BLOCKED',credentialAccess:'BLOCKED',complianceMutation:'BLOCKED',cfoVeto:'ENFORCED',selfModification:'BOUNDED_ONLY'};
const AGENT_CATALOG=[
 {id:'market',name:'Market Sentinel',domains:['market','price','volume','macro'],priority:90},
 {id:'risk',name:'Risk Guardian',domains:['risk','portfolio','leverage','drawdown'],priority:100},
 {id:'cfo',name:'CFO',domains:['capital','cashflow','liquidity','budget'],priority:100},
 {id:'research',name:'Research Analyst',domains:['research','evidence','news'],priority:60},
 {id:'quant',name:'Quant',domains:['quant','technical','options','statistics'],priority:75},
 {id:'compliance',name:'Compliance Sentinel',domains:['compliance','suitability','regulation'],priority:100},
 {id:'security',name:'Security Sentinel',domains:['security','credentials','anomaly'],priority:100},
 {id:'ceo',name:'CEO / Judge',domains:['decision','synthesis','strategy'],priority:110}
];
for(const a of AGENT_CATALOG)AGENT_POOL.set(a.id,{...a,runs:0,wakeups:0,lastRun:null,health:'READY',score:80});
function audit(type,detail){AUDIT.unshift({id:requestId(),type,detail,time:new Date().toISOString()});if(AUDIT.length>300)AUDIT.pop();}
function emitEvent(type,payload={},priority=50){
 const event={id:`evt_${++EVENT_BUS.seq}`,type,payload,priority,time:new Date().toISOString()};
 // 5.2 coalescing: replace near-identical market events inside 2 seconds.
 const last=EVENT_BUS.events[0];
 if(last&&last.type===type&&type==='MARKET_TICK'&&Date.now()-Date.parse(last.time)<2000&&last.payload?.ticker===payload?.ticker){EVENT_BUS.coalesced++;EVENT_BUS.events[0]=event;return event;}
 EVENT_BUS.events.unshift(event);if(EVENT_BUS.events.length>500)EVENT_BUS.events.pop();
 routeEvent(event);return event;
}
function routeEvent(event){
 let matches=AGENT_CATALOG.filter(a=>a.domains.some(d=>event.type.toLowerCase().includes(d)||String(event.payload?.domain||'').toLowerCase()===d));
 if(event.type==='MARKET_TICK')matches=AGENT_CATALOG.filter(a=>['market','risk','quant'].includes(a.id));
 if(event.type==='SECURITY_ALERT')matches=AGENT_CATALOG.filter(a=>['security','compliance','cfo','ceo'].includes(a.id));
 if(event.type==='DATA_QUALITY_ALERT')matches=AGENT_CATALOG.filter(a=>['research','compliance','risk'].includes(a.id));
 if(event.type==='RESEARCH_UPDATE')matches=AGENT_CATALOG.filter(a=>['research','risk','quant','compliance','ceo'].includes(a.id));
 if(event.type==='USER_DECISION')matches=AGENT_CATALOG.filter(a=>['cfo','risk','compliance','ceo'].includes(a.id));
 for(const a of matches){const live=AGENT_POOL.get(a.id);if(live)live.wakeups++;EVENT_BUS.routed++;scheduleAgent(a.id,event);}
}
function scheduleAgent(agentId,trigger,delay=0){
 const a=AGENT_POOL.get(agentId);if(!a)return;
 // 5.3 dedupe queued work for the same agent+event class.
 if(SCHEDULER.queue.some(j=>j.agentId===agentId&&j.trigger.type===trigger.type)){SCHEDULER.coalesced++;return;}
 SCHEDULER.queue.push({id:requestId(),agentId,trigger,priority:(a.priority||50)+Number(trigger.priority||0),readyAt:Date.now()+delay,queuedAt:Date.now()});
 SCHEDULER.queue.sort((x,y)=>y.priority-x.priority||x.queuedAt-y.queuedAt);
 drainScheduler();
}
async function drainScheduler(){
 while(SCHEDULER.running<SCHEDULER.maxConcurrency){const i=SCHEDULER.queue.findIndex(j=>j.readyAt<=Date.now());if(i<0)break;const job=SCHEDULER.queue.splice(i,1)[0];SCHEDULER.running++;
  Promise.resolve().then(()=>runAgentJob(job)).catch(()=>{}).finally(()=>{SCHEDULER.running--;SCHEDULER.completed++;drainScheduler();});
 }
}
async function runAgentJob(job){const a=AGENT_POOL.get(job.agentId);if(!a)return;a.runs++;a.lastRun=new Date().toISOString();a.health='RUNNING';EVENT_BUS.wakeups++;
 const p=job.trigger.payload||{};let result='MONITOR';
 if(job.agentId==='risk'&&(p.changePct<-5||p.openInterestChange>12))result='ESCALATE_RISK';
 if(job.agentId==='cfo'&&(p.freeCash<0||p.cashRunway<3))result='PROTECT_LIQUIDITY';
 if(job.agentId==='compliance'&&p.marketSensitive)result='VERIFY_EVIDENCE';
 if(job.agentId==='security'&&job.trigger.type==='SECURITY_ALERT')result='CONTAIN';
 if(job.agentId==='ceo'&&job.trigger.type==='USER_DECISION')result='SYNTHESIZE';
 a.health='READY';a.score=Math.max(0,Math.min(100,Math.round(a.score+(result==='MONITOR'?1:-1))));
 audit('AGENT_WAKE',{agent:a.name,trigger:job.trigger.type,result});
}
function qualityUpdate(source,ok,latency,error){const x=DATA_HEALTH.sources[source]??={};if(ok){x.status='HEALTHY';x.latencyMs=latency;x.lastSuccess=new Date().toISOString();x.lastError=null}else{x.status='DEGRADED';x.lastError=error;x.latencyMs=latency;RESILIENCE.providerFailures++;RESILIENCE.lastIncident=new Date().toISOString();}const vals=Object.values(DATA_HEALTH.sources);DATA_HEALTH.qualityScore=Math.round(vals.reduce((n,v)=>n+(v.status==='HEALTHY'?100:v.status==='DEGRADED'?45:0),0)/Math.max(1,vals.length));DATA_HEALTH.freshness=DATA_HEALTH.qualityScore>=90?'FRESH':DATA_HEALTH.qualityScore>=50?'DEGRADED':'STALE';DATA_HEALTH.updatedAt=new Date().toISOString();if(!ok)emitEvent('DATA_QUALITY_ALERT',{source,error},95);}
function resilientFetch(url,source='provider',timeoutMs=7000){if(RESILIENCE.circuitOpen)return Promise.reject(new Error('PROVIDER_CIRCUIT_OPEN'));const started=Date.now();return Promise.race([fetch(url),new Promise((_,rej)=>setTimeout(()=>rej(new Error('PROVIDER_TIMEOUT')),timeoutMs))]).then(async r=>{const t=Date.now()-started;if(!r.ok)throw new Error(`HTTP_${r.status}`);qualityUpdate(source,true,t);return r}).catch(async e=>{qualityUpdate(source,false,Date.now()-started,e.message);if(RESILIENCE.providerFailures>=5){RESILIENCE.circuitOpen=true;setTimeout(()=>{RESILIENCE.circuitOpen=false;RESILIENCE.providerFailures=0;},Math.min(30000,RESILIENCE.backoffMs*4));}throw e;});}

// Exa Intelligence Layer: web research is evidence-only and never allowed to fabricate market numbers.
let EXA_LAST_RUN=0, EXA_RUNNING=false, EXA_CACHE=[];
const EXA_REFRESH_MS=Math.max(15*60*1000,Number(process.env.EXA_REFRESH_MS||60*60*1000));
async function exaSearch(query){
 const key=process.env.EXA_API_KEY;
 if(!key)throw new Error('EXA_API_KEY_NOT_CONFIGURED');
 const r=await fetch('https://api.exa.ai/search',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key},body:JSON.stringify({query,type:'auto',numResults:8,contents:{highlights:true}})});
 const d=await r.json(); if(!r.ok)throw new Error(d?.message||'EXA_SEARCH_FAILED');
 return (d.results||[]).map(x=>({title:x.title||'',url:x.url||'',publishedDate:x.publishedDate||null,author:x.author||null,highlights:Array.isArray(x.highlights)?x.highlights.slice(0,4):[]})).filter(x=>x.url);
}
async function runExaIntelligence(topic='global finance AI risks market data'){
 if(EXA_RUNNING)return {ok:true,status:'RUNNING',lastRun:EXA_LAST_RUN,results:EXA_CACHE};
 EXA_RUNNING=true;const started=Date.now();
 try{
  const queries=[
   topic+' latest market news primary sources',
   topic+' finance regulation official filing risk',
   topic+' financial data quality stale data AI agents',
   topic+' adversarial AI finance security prompt injection'
  ];
  const rows=await Promise.all(queries.map(q=>exaSearch(q).catch(e=>[{error:e.message,query:q}])));
  EXA_CACHE=rows.flat().filter(x=>!x.error).slice(0,32);EXA_LAST_RUN=Date.now();
  audit('EXA_RESEARCH_REFRESH',{topic,count:EXA_CACHE.length,latencyMs:Date.now()-started});
  emitEvent('RESEARCH_UPDATE',{source:'Exa',count:EXA_CACHE.length,topic},70);
  return {ok:true,status:'UPDATED',lastRun:EXA_LAST_RUN,count:EXA_CACHE.length,results:EXA_CACHE};
 }catch(e){audit('EXA_RESEARCH_ERROR',{error:e.message});return {ok:false,status:'ERROR',error:e.message,lastRun:EXA_LAST_RUN,results:EXA_CACHE};
 }finally{EXA_RUNNING=false}
}
async function exaIntelligence(req,res,u){
 const topic=String(u.searchParams.get('topic')||'global finance').slice(0,300);
 const force=u.searchParams.get('force')==='1';
 if(force||Date.now()-EXA_LAST_RUN>EXA_REFRESH_MS){const r=await runExaIntelligence(topic);return send(res,r.ok?200:503,r);}
 return send(res,200,{ok:true,status:'FRESH_CACHE',lastRun:EXA_LAST_RUN,ageMs:Date.now()-EXA_LAST_RUN,nextRefreshMs:Math.max(0,EXA_REFRESH_MS-(Date.now()-EXA_LAST_RUN)),count:EXA_CACHE.length,configured:Boolean(process.env.EXA_API_KEY),results:EXA_CACHE});
}
function exaStatus(req,res){return send(res,200,{ok:true,configured:Boolean(process.env.EXA_API_KEY),running:EXA_RUNNING,lastRun:EXA_LAST_RUN,refreshMs:EXA_REFRESH_MS,count:EXA_CACHE.length});}
setInterval(()=>{if(process.env.EXA_API_KEY&&Date.now()-EXA_LAST_RUN>EXA_REFRESH_MS)runExaIntelligence('global finance market data AI risk regulation').catch(()=>{});},60000);

function eventStatus(req,res){return send(res,200,{ok:true,version:'5.2',events:EVENT_BUS.events.slice(0,30),routed:EVENT_BUS.routed,coalesced:EVENT_BUS.coalesced,wakeups:EVENT_BUS.wakeups,dropped:EVENT_BUS.dropped,queue:SCHEDULER.queue.length,running:SCHEDULER.running,completed:SCHEDULER.completed,failed:SCHEDULER.failed});}
function agentFleetStatus(req,res){return send(res,200,{ok:true,version:'6.0',agents:[...AGENT_POOL.values()],scheduler:{queue:SCHEDULER.queue.length,running:SCHEDULER.running,maxConcurrency:SCHEDULER.maxConcurrency,completed:SCHEDULER.completed,failed:SCHEDULER.failed},routing:'event-driven selective wakeups'});}
function dataHealth(req,res){return send(res,200,{ok:true,version:'5.4',...DATA_HEALTH,resilience:RESILIENCE});}
function policyStatus(req,res){return send(res,200,{ok:true,version:'6.1',policy:POLICY,autonomy:{level:AUTONOMY.level,mode:AUTONOMY.mode},protected:['money movement','credential access','compliance mutation','CFO veto','execution guard']});}
function autonomyStatus(req,res){return send(res,200,{ok:true,version:'7.0',autonomy:AUTONOMY,policyBlocks:AUTONOMY.policyBlocks,eventBus:{events:EVENT_BUS.events.length,routed:EVENT_BUS.routed,wakeups:EVENT_BUS.wakeups,coalesced:EVENT_BUS.coalesced},scheduler:{queue:SCHEDULER.queue.length,running:SCHEDULER.running,completed:SCHEDULER.completed},dataHealth:DATA_HEALTH.qualityScore,auditRecords:AUDIT.length});}
function commandCycle(req,res){
 const x=req._parsedBody||{};AUTONOMY.cycles++;AUTONOMY.lastCycle=new Date().toISOString();
 const event=emitEvent(x.type||'USER_DECISION',x,100);audit('COMMAND_CYCLE',{event:event.id,type:event.type});
 const relevant=(event.type==='MARKET_TICK'?['market','risk','quant']:event.type==='SECURITY_ALERT'?['security','compliance','cfo','ceo']:event.type==='DATA_QUALITY_ALERT'?['research','compliance','risk']:event.type==='USER_DECISION'?['cfo','risk','compliance','ceo']:AGENT_CATALOG.filter(a=>a.domains.some(d=>event.type.toLowerCase().includes(d))).map(a=>a.id));
 const gated=Boolean(x.highImpact||x.execute||x.moneyMovement);if(gated){AUTONOMY.policyBlocks++;audit('POLICY_BLOCK',{reason:'High-impact action requires explicit human approval'});}
 return send(res,200,{ok:true,version:'7.0',cycle:AUTONOMY.cycles,event,relevantAgents:relevant,decision:gated?'REVIEW_REQUIRED':'READY_FOR_AGENT_REVIEW',approvalRequired:gated,execution:'BLOCKED_UNTIL_HUMAN_APPROVAL'});
}
function optimizeOS(req,res){
 AUTONOMY.optimizations++;const before={maxConcurrency:SCHEDULER.maxConcurrency,marketRefreshMs:AUTO.marketRefreshMs,cacheTtlMs:AUTO.cacheTtlMs};
 // Self-optimization is bounded to performance only.
 const load=SCHEDULER.running+SCHEDULER.queue.length;SCHEDULER.maxConcurrency=Math.max(2,Math.min(10,load>6?8:5));AUTO.marketRefreshMs=Math.max(3000,Math.min(15000,EVENT_BUS.coalesced>EVENT_BUS.routed*.2?7000:5000));AUTO.cacheTtlMs=Math.max(5000,Math.min(30000,DATA_HEALTH.qualityScore<60?15000:10000));
 const after={maxConcurrency:SCHEDULER.maxConcurrency,marketRefreshMs:AUTO.marketRefreshMs,cacheTtlMs:AUTO.cacheTtlMs};audit('AUTO_OPTIMIZE',{before,after});return send(res,200,{ok:true,version:'6.9',mode:'BOUNDED_SELF_OPTIMIZATION',before,after,protected:POLICY});
}
function auditLog(req,res){return send(res,200,{ok:true,version:'6.8',records:AUDIT.slice(0,100)});}
function frontendSyntax(){try{const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');const m=html.match(/<script>([\s\S]*?)<\/script>/);if(!m)return {ok:false,error:'Main script tag not found'};new vm.Script(m[1],{filename:'public/index.html'});return {ok:true}}catch(e){return {ok:false,error:String(e.message||e),stack:String(e.stack||'').split('\n').slice(0,4)}}}
function health70(req,res){return send(res,200,{ok:true,service:'FinPilot Web Gateway',version:'7.0',status:'OPERATIONAL',autonomy:'governed',eventDriven:true,selfHealing:true,dataQuality:DATA_HEALTH.freshness,aiConfigured:Boolean(process.env.LLM_API_URL&&process.env.LLM_API_KEY),execution:'human-approval-gated',frontendSyntax:frontendSyntax()});}

const server=http.createServer(async(req,res)=>{
 const started=Date.now(); PERF.requests++; const rid=requestId(); res.setHeader('X-FinPilot-Request-Id',rid); res.setHeader('X-FinPilot-Version','7.0');
 try{ if(!rateCheck(req)){SECURITY.blocked++; return send(res,429,{ok:false,error:'RATE_LIMITED',requestId:rid});}

  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});return res.end();}
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);

  if(req.method==='GET'&&u.pathname==='/api/exa-intelligence')return exaIntelligence(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/exa-status')return exaStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/event-bus')return eventStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/agent-fleet-status')return agentFleetStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/data-health')return dataHealth(req,res);
  if(req.method==='GET'&&u.pathname==='/api/policy-status')return policyStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/autonomy-status')return autonomyStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/audit-log')return auditLog(req,res);
  if(req.method==='POST'&&u.pathname==='/api/command-cycle'){await body(req);return commandCycle(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/optimize-os')return optimizeOS(req,res);
  if(req.method==='GET'&&u.pathname==='/api/health')return health70(req,res);
  if(req.method==='GET'&&u.pathname==='/api/core-status')return coreStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/agent-memory')return agentMemory(req,res);
  if(req.method==='POST'&&u.pathname==='/api/evidence-fusion'){await body(req);return evidenceFusion(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/agent-memory'){await body(req);return recordMemory(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/event-detect'){await body(req);return detectEvents(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/portfolio-risk'){await body(req);return portfolioRisk(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/research-queue'){await body(req);return researchQueue(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/decision-cache'){await body(req);return decisionCache(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/execution-guard'){await body(req);return executionGuard(req,res);}
  if(req.method==='GET'&&u.pathname==='/api/security-status')return securityStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/realtime-status')return realtimeStatus(req,res);
  if(req.method==='POST'&&u.pathname==='/api/auto-optimize')return autoOptimize(req,res);
  if(req.method==='GET'&&u.pathname==='/api/market-history')return marketHistory(req,res,u);
  if(req.method==='POST'&&u.pathname==='/api/market-ingest'){await body(req);const x=req._parsedBody||{};const stored=await storeMarketTick(x);emitEvent('MARKET_TICK',x,90);return send(res,200,{ok:true,cloudStored:stored,agentCoreHandoff:true});}
  if(req.method==='GET'&&u.pathname==='/api/market-stream')return marketStream(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/compliance')return compliance(req,res);
  if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,service:'FinPilot Web Gateway',version:'7.0',time:new Date().toISOString(),security:'hardened',realtime:true,aiConfigured:Boolean(process.env.LLM_API_URL&&process.env.LLM_API_KEY)});
  if(req.method==='GET'&&u.pathname==='/api/search')return search(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/derivatives-report')return derivativesReport(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/option-chain-scan')return optionChainScan(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/stock-report')return stockReport(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-universe')return marketUniverse(req,res);
  if(req.method==='GET'&&u.pathname==='/api/market-picks')return marketPicks(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/options-math')return optionsMath(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/chain-analytics')return chainAnalytics(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/round-table-decision')return roundTableDecision(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/risk-guard')return riskGuard(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/command-decision')return commandDecision(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/performance')return performance(req,res);
  if(req.method==='GET'&&u.pathname==='/api/decision-stream')return decisionStream(req,res,u);
  if(req.method==='POST'&&u.pathname==='/api/agent-batch')return agentBatch(req,res);
  if(req.method==='POST'&&u.pathname==='/api/execution-plan')return executionPlan(req,res);
  if(req.method==='POST'&&u.pathname==='/api/learning')return learn(req,res);
  if(req.method==='POST'&&u.pathname==='/api/agent-run')return agentRun(req,res);
  if(req.method==='POST'&&u.pathname==='/api/simulate')return simulate(req,res);
  if(req.method==='GET'&&u.pathname==='/api/ai-plan')return aiPlan(req,res);
  if(req.method==='POST'&&u.pathname==='/api/ai')return ai(req,res);
  return staticFile(req,res,u);
 }catch(e){send(res,500,{ok:false,error:e.message})}
});
server.on('error',(e)=>{console.error(`FinPilot Web server error: ${e.message}`);process.exitCode=1;});
async function runFinPilotSmoke50(){
 const queries=['best stock today','TCS analysis','RELIANCE analysis','INFY stock','HDFCBANK','ICICIBANK','SBIN','LT','ITC','TATAPOWER','TATASTEEL','SUNPHARMA','TRENT','TECHM','HCLTECH','INDIGO','JUBLFOOD','PAYTM','IRFC','BHARTIARTL','ADANIPORTS','BAJFINANCE','HINDALCO','WIPRO','MARUTI','AXISBANK','KOTAKBANK','GAIL','HINDZINC','Nifty 50','best intraday stock','stock for 1000 rupees','low risk stock','momentum stock','breakout stock','IT stocks','bank stocks','FMCG stocks','energy stocks','auto stocks','pharma stocks','defensive stock','swing trade stock','today trading','best stock India','top NSE stock','chart TCS','chart RELIANCE','chart SBIN','best stock for trading today'];
 let pass=0,fail=0,providerCounts={};
 const started=Date.now();
 for(let i=0;i<queries.length;i+=5){
  const batch=queries.slice(i,i+5);
  const rows=await Promise.all(batch.map(async q=>{try{const d=await searchWeb(q,{count:3});return {q,ok:true,provider:d?.provider||'unknown',count:Array.isArray(d?.results)?d.results.length:0}}catch(e){return {q,ok:false,error:e?.code||e?.message||'error'}}}));
  for(const r of rows){if(r.ok){pass++;providerCounts[r.provider]=(providerCounts[r.provider]||0)+1}else fail++;}
 }
 const tickers=['TCS','RELIANCE','INFY','HDFCBANK','ICICIBANK','SBIN','LT','ITC','TATAPOWER','HINDALCO'];
 const charts=[];
 for(const t of tickers){try{const x=await liveEquity(t);charts.push({ticker:t,ok:true,candles:x.candles?.length||0,price:x.price,provider:x.provider,live:x.live!==false})}catch(e){charts.push({ticker:t,ok:false,error:e?.message||'error'})}}
 const routeChecks=[];
 for(const t of tickers.slice(0,5)){
  try{
   let bodyText='',statusCode=0;
   const mockRes={writeHead:(s)=>{statusCode=s},end:(b)=>{bodyText+=String(b||'')}};
   const u=new URL('http://finpilot.local/api/stock-report?ticker='+encodeURIComponent(t)+'&interval=1h&multi=1&selftest='+Date.now());
   await stockReport({},mockRes,u);
   const d=JSON.parse(bodyText||'{}');
   routeChecks.push({ticker:t,http:statusCode,ok:Boolean(statusCode===200&&d?.ok&&d?.report?.candles?.length>1),candles:d?.report?.candles?.length||0,price:d?.report?.price||0,error:d?.error||null});
  }catch(e){routeChecks.push({ticker:t,http:0,ok:false,candles:0,price:0,error:e?.message||'route test failed'})}
 }
 const fallbackChecks=[];
 for(const t of tickers.slice(0,3)){
  try{const x=await fetchTejEod(t);fallbackChecks.push({ticker:t,ok:true,candles:x.candles?.length||0,price:x.price,provider:x.provider})}
  catch(e){fallbackChecks.push({ticker:t,ok:false,error:e?.message||'TejHQ fallback failed'})}
 }
 console.log('[smoke-50]',JSON.stringify({queries:queries.length,pass,fail,providers:providerCounts,charts,routeChecks,fallbackChecks,frontendContract:{tradingViewFallback:fs.readFileSync(path.join(ROOT,'one-click-analysis.js'),'utf8').includes('tradingview.com/external-embedding/embed-widget-advanced-chart.js'),equitySnapshot:fs.readFileSync(path.join(ROOT,'one-click-analysis.js'),'utf8').includes('live-equity-snapshot')},elapsedMs:Date.now()-started}));
}
server.listen(PORT,HOST,()=>{console.log(`FinPilot Web running on http://${HOST}:${PORT}`); console.log('[frontend-syntax]',JSON.stringify(frontendSyntax()));});
if(process.env.RUN_SMOKE_50==='true')setTimeout(()=>runFinPilotSmoke50().catch(e=>console.error('[smoke-50-fatal]',e?.message||e)),1500);
