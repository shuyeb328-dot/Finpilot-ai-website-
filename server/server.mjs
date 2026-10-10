import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {URL} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import 'node:process';
import {cleanText as clean} from './text-sanitizer.mjs';
import vm from 'node:vm';
import pg from 'pg';
import {searchWeb} from './search-provider.mjs';
import {normalizeMarketTick} from './market-tick-contract.mjs';
import {createBoundedRateLimiter} from './bounded-rate-limiter.mjs';
import {isAllowedRequestOrigin,MAX_REQUEST_BODY_BYTES} from './request-security.mjs';
import {planFinancialTask,buildSupplementalDiscovery,filterFinancialSearchResults,getSourceCatalog} from './task-intelligence.mjs';
import {fetchTejHqEod} from './tejhq-eod.mjs';
import {fetchNasdaqEod} from './nasdaq-eod.mjs';
import {getOSControlPlaneSnapshot,runAutonomousCoreCycle,recordOSControlFeedback,setAutonomousCoreMode,getAutonomousCoreMode,evaluateSecurityRequest,evaluateShadowCandidate,getShadowEvaluationStatus} from './autonomous-core.mjs';
import {init as initAutonomousLearning, status as autonomousLearningStatus, queue as autonomousLearningQueue, cycleNow as autonomousLearningCycle, enable as autonomousLearningEnable, runLiveAgentComparison} from './autonomous-learning.mjs';
import {GLOBAL_INDEXES,GLOBAL_STOCK_TEST_SET,normalizeGlobalSymbol,GLOBAL_INDEX_FALLBACKS} from './global-market-registry.mjs';
import {cryptoProviderSymbols} from './crypto-provider-symbols.mjs';
import {buildMarketSnapshot} from './market-snapshot.mjs';
import {selectPrimaryMarketQuote} from './market-data-verification.mjs';
import {createMarketStreamHub} from './market-stream-hub.mjs';
import {createProviderResponseCache} from './provider-response-cache.mjs';
import {createTradingViewAlertInbox} from './tradingview-alert-inbox.mjs';
import {listManagedAgents,createManagedAgent,getManagedAgentRegistrySnapshot} from './ai-os-operating-layer.mjs';
import {initializeAIOSMarketTrainingDirector,runAIOSMarketTrainingCycle,getAIOSMarketTrainingStatus} from './ai-os-market-training.mjs';
import {normalizeMarketPicksMarket,resolveMarketPicksUniverse,buildMarketPicksEnvelope} from './market-picks-contract.mjs';
import {activeProviderCooldowns,providerCooldownStatus,recordProviderFailure,recordProviderSuccess,claimProviderRequest} from './provider-cooldown.mjs';
const {Pool}=pg;
let MARKET_POOL=null, MARKET_SCHEMA_READY=false;
async function marketStore(){if(MARKET_POOL||!process.env.DATABASE_URL)return MARKET_POOL;MARKET_POOL=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:3,idleTimeoutMillis:30000,connectionTimeoutMillis:1800});return MARKET_POOL;}
async function ensureMarketSchema(){const pool=await marketStore();if(!pool||MARKET_SCHEMA_READY)return !!pool;await pool.query('CREATE TABLE IF NOT EXISTS market_ticks (id BIGSERIAL PRIMARY KEY,ticker TEXT NOT NULL,symbol TEXT,price DOUBLE PRECISION,change_pct DOUBLE PRECISION,volume DOUBLE PRECISION,high DOUBLE PRECISION,low DOUBLE PRECISION,source TEXT,source_verified BOOLEAN NOT NULL DEFAULT FALSE,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');await pool.query('ALTER TABLE market_ticks ADD COLUMN IF NOT EXISTS source_verified BOOLEAN NOT NULL DEFAULT FALSE');await pool.query('CREATE INDEX IF NOT EXISTS market_ticks_ticker_time_idx ON market_ticks(ticker,observed_at DESC)');MARKET_SCHEMA_READY=true;return true;}
async function storeMarketTick(x){try{if(!(await ensureMarketSchema()))return false;await MARKET_POOL.query('INSERT INTO market_ticks(ticker,symbol,price,change_pct,volume,high,low,source,source_verified,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[x.ticker,x.symbol,x.price,x.changePct,x.volume,x.high,x.low,x.source,false,x.time]);return true}catch(e){MARKET_SCHEMA_READY=false;return false;}}
async function marketHistory(req,res,u){try{if(!(await ensureMarketSchema()))return send(res,200,{ok:true,cloud:false,rows:[],message:'Cloud archive adapter ready; connect DATABASE_URL on Render.'});const ticker=(u.searchParams.get('ticker')||'BTC').toUpperCase();const limit=Math.min(500,Math.max(10,Number(u.searchParams.get('limit')||100)));const q=await MARKET_POOL.query('SELECT ticker,symbol,price,change_pct AS "changePct",volume,high,low,source,source_verified AS "sourceVerified",observed_at AS time FROM market_ticks WHERE ticker=$1 ORDER BY observed_at DESC LIMIT $2',[ticker,limit]);return send(res,200,{ok:true,cloud:true,ticker,rows:q.rows});}catch(e){return send(res,200,{ok:true,cloud:false,rows:[],error:'MARKET_HISTORY_UNAVAILABLE'});}}


const providerCacheTtl=Number(process.env.FINPILOT_PROVIDER_CACHE_TTL_MS);
const PROVIDER_RESPONSE_CACHE_TTL_MS=Number.isFinite(providerCacheTtl)?Math.max(1000,Math.min(15000,providerCacheTtl)):5000;
const PROVIDER_RESPONSE_CACHE=createProviderResponseCache({ttlMs:PROVIDER_RESPONSE_CACHE_TTL_MS,maxEntries:300});
const PORT=Number(process.env.PORT||8787);
const HOST=process.env.HOST||'0.0.0.0';
const ROOT=path.resolve(new URL('../public/', import.meta.url).pathname);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const send=(res,status,body,type='application/json; charset=utf-8',headers={})=>{
 const origin=res.req?.headers?.origin; const allowed=process.env.ALLOWED_ORIGIN||'';
 const cors=origin&&allowed&&origin===allowed?origin:undefined;
 const h={'Content-Type':type,'Cache-Control':'no-store','X-FinPilot-Version':'8.6',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(),microphone=(),geolocation=(),payment=()','Content-Security-Policy':"default-src 'self'; connect-src 'self' https://api.binance.com https://fapi.binance.com https://eapi.binance.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://s3.tradingview.com; frame-src 'self' https://www.tradingview.com https://in.tradingview.com; child-src 'self' https://www.tradingview.com https://in.tradingview.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",...headers};
 if(process.env.NODE_ENV==='production')h['Strict-Transport-Security']='max-age=31536000; includeSubDomains';
 if(cors)h['Access-Control-Allow-Origin']=cors;
 res.writeHead(status,h);res.end(typeof body==='string'?body:JSON.stringify(body));
};
async function body(req){
 if(req._parsedBody!==undefined)return req._parsedBody;
 let b='',bytes=0,tooLarge=false;
 for await(const c of req){bytes+=c.length;if(bytes>MAX_REQUEST_BODY_BYTES){tooLarge=true;continue}if(!tooLarge)b+=c}
 if(tooLarge){const e=new Error('REQUEST_BODY_TOO_LARGE');e.statusCode=413;throw e}
 try{req._parsedBody=JSON.parse(b||'{}')}catch{req._parsedBody={}}
 req._bodyCache=JSON.stringify(req._parsedBody);return req._parsedBody
}
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
  return send(res,r.status,t,'application/json; charset=utf-8',{'X-FinPilot-AI-Tier':'FREE'});
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
 remember(name,{source:'SERVER_EXECUTED',decision:recommendation,lesson:challenge});
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

const RESEARCH_SCHEMA_READY={ready:false};
const MARKET_PROVENANCE_READY={ready:false};
async function ensureMarketProvenanceSchema(){
 const pool=await marketStore(); if(!pool)return false; if(MARKET_PROVENANCE_READY.ready)return true;
 await pool.query(`CREATE TABLE IF NOT EXISTS market_data_provenance (id BIGSERIAL PRIMARY KEY,symbol TEXT NOT NULL,provider TEXT NOT NULL,price DOUBLE PRECISION,live BOOLEAN NOT NULL DEFAULT FALSE,freshness TEXT,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),metadata JSONB NOT NULL DEFAULT '{}'::jsonb)`);
 await pool.query('CREATE INDEX IF NOT EXISTS market_provenance_symbol_idx ON market_data_provenance(symbol,observed_at DESC)');
 await pool.query('CREATE INDEX IF NOT EXISTS market_provenance_provider_idx ON market_data_provenance(provider,observed_at DESC)');
 MARKET_PROVENANCE_READY.ready=true; return true;
}
async function archiveMarketProvenance(x){
 try{if(!(await ensureMarketProvenanceSchema())||!MARKET_POOL)return false;
 await MARKET_POOL.query('INSERT INTO market_data_provenance(symbol,provider,price,live,freshness,observed_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [x.symbol||x.ticker||'',x.provider||'unknown',Number.isFinite(Number(x.price))?Number(x.price):null,Boolean(x.live),x.dataFreshness||x.freshness||'unknown',x.asOf||new Date().toISOString(),JSON.stringify({market:x.market||null,exchange:x.exchange||null,proxy:Boolean(x.proxy)})]);return true}catch{return false}
}
async function ensureResearchSchema(){
 const pool=await marketStore();
 if(!pool)return false;
 if(RESEARCH_SCHEMA_READY.ready)return true;
 await pool.query(`CREATE TABLE IF NOT EXISTS research_queries (
   id BIGSERIAL PRIMARY KEY,
   query TEXT NOT NULL,
   provider TEXT,
   result_count INTEGER NOT NULL DEFAULT 0,
   confidence INTEGER,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS research_sources (
   id BIGSERIAL PRIMARY KEY,
   query_id BIGINT REFERENCES research_queries(id) ON DELETE CASCADE,
   title TEXT,
   url TEXT NOT NULL,
   source TEXT,
   domain TEXT,
   snippet TEXT,
   published_at TIMESTAMPTZ,
   source_tier TEXT,
   freshness_score INTEGER,
   relevance_score INTEGER,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   UNIQUE(query_id,url)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS research_analyses (
   id BIGSERIAL PRIMARY KEY,
   query_id BIGINT REFERENCES research_queries(id) ON DELETE CASCADE,
   summary TEXT,
   bullish_count INTEGER NOT NULL DEFAULT 0,
   bearish_count INTEGER NOT NULL DEFAULT 0,
   risk_count INTEGER NOT NULL DEFAULT 0,
   primary_source_count INTEGER NOT NULL DEFAULT 0,
   source_diversity INTEGER NOT NULL DEFAULT 0,
   freshness_score INTEGER NOT NULL DEFAULT 0,
   confidence INTEGER NOT NULL DEFAULT 0,
   analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS research_sources_domain_idx ON research_sources(domain)');
 await pool.query('CREATE INDEX IF NOT EXISTS research_sources_created_idx ON research_sources(created_at DESC)');
 await pool.query('CREATE INDEX IF NOT EXISTS research_queries_created_idx ON research_queries(created_at DESC)');
 RESEARCH_SCHEMA_READY.ready=true;
 return true;
}
function researchDomain(url){
 try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}
}
function analyzeResearchResults(q,rows){
 const now=Date.now(), domains=new Set(), seen=new Set();
 let bull=0,bear=0,risk=0,primary=0,fresh=0;
 const sources=rows.map((r)=>{
   const domain=researchDomain(r.url); domains.add(domain);
   const text=String([r.title,r.snippet].join(' ')).toLowerCase();
   const age=r.publishedAt?Math.max(0,now-Date.parse(r.publishedAt)):null;
   const freshFlag=age===null||age<7*86400000;
   if(freshFlag)fresh++;
   if(/sec\.gov|sebi\.gov|rbi\.org|nseindia|bseindia|\.gov\./i.test(domain))primary++;
   if(/bull|buy|upgrade|growth|profit|surge|rally|outperform|positive|breakout/.test(text))bull++;
   if(/bear|sell|downgrade|loss|decline|fall|crash|negative|weak|warning|lawsuit|fraud/.test(text))bear++;
   if(/risk|regulation|rate|inflation|geopolit|sanction|volatil|debt|default|liquidity/.test(text))risk++;
   const key=domain+'|'+String(r.title||'').toLowerCase();
   const relevance=/stock|market|finance|economy|earnings|shares|nifty|sensex|crypto|bond|forex|option|futures|company|business|regulation|rbi|sebi|sec/.test(text)?90:60;
   return {title:r.title||'',url:r.url,source:r.source||'web',domain,snippet:String(r.snippet||'').slice(0,1800),publishedAt:r.publishedAt||null,
     sourceTier:/sec\.gov|sebi\.gov|rbi\.org|nseindia|bseindia|\.gov\./i.test(domain)?'PRIMARY':'SECONDARY',
     freshnessScore:freshFlag?100:40,relevanceScore:relevance,key,duplicate:seen.has(key)};
 });
 const n=Math.max(1,sources.length), sourceDiversity=Math.round(Math.min(100,domains.size/Math.min(8,n)*100));
 const freshnessScore=Math.round(fresh/n*100);
 const confidence=Math.max(0,Math.min(100,Math.round(.35*freshnessScore+.25*sourceDiversity+.2*Math.min(100,primary*20)+.2*Math.min(100,Math.max(bull,bear,risk)*12))));
 const direction=bull>bear*1.2?'BULLISH_BIAS':bear>bull*1.2?'BEARISH_BIAS':'MIXED';
 const summary=`${q}: ${rows.length} sources archived; evidence is ${direction.replace('_',' ')} with ${risk} risk signals. This is evidence synthesis, not a guaranteed market forecast.`;
 return {summary,bull,bear,risk,primary,fresh,sourceDiversity,freshnessScore,confidence,direction,sources};
}
async function archiveResearch(q,d){
 try{
  if(!(await ensureResearchSchema()))return {cloudStored:false};
  const pool=MARKET_POOL;
  const x=analyzeResearchResults(q,d.results||[]);
  const qr=await pool.query('INSERT INTO research_queries(query,provider,result_count,confidence) VALUES($1,$2,$3,$4) RETURNING id',[q,d.provider||'unknown',x.sources.length,x.confidence]);
  const queryId=qr.rows[0].id;
  for(const s of x.sources){
   await pool.query('INSERT INTO research_sources(query_id,title,url,source,domain,snippet,published_at,source_tier,freshness_score,relevance_score) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(query_id,url) DO UPDATE SET snippet=EXCLUDED.snippet,source=EXCLUDED.source,published_at=EXCLUDED.published_at,freshness_score=EXCLUDED.freshness_score,relevance_score=EXCLUDED.relevance_score',
    [queryId,s.title,s.url,s.source,s.domain,s.snippet,s.publishedAt||null,s.sourceTier,s.freshnessScore,s.relevanceScore]);
  }
  await pool.query('INSERT INTO research_analyses(query_id,summary,bullish_count,bearish_count,risk_count,primary_source_count,source_diversity,freshness_score,confidence,analysis) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [queryId,x.summary,x.bull,x.bear,x.risk,x.primary,x.sourceDiversity,x.freshnessScore,x.confidence,JSON.stringify({direction:x.direction})]);
  return {cloudStored:true,queryId,analysis:{summary:x.summary,direction:x.direction,bullish:x.bull,bearish:x.bear,risk:x.risk,primarySourceCount:x.primary,sourceDiversity:x.sourceDiversity,freshnessScore:x.freshnessScore,confidence:x.confidence}};
 }catch(e){return {cloudStored:false,cloudError:e.message}}
}
async function cloudKnowledge(req,res,u){
 try{
  if(!(await ensureResearchSchema()))return send(res,200,{ok:true,cloud:false,items:[],message:'Cloud knowledge archive unavailable; DATABASE_URL required.'});
  const q=(u.searchParams.get('q')||'').trim();
  const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||25)));
  if(q){
   const like='%'+q.replace(/[%_]/g,'\\$&')+'%';
   const r=await MARKET_POOL.query(`SELECT rq.id,rq.query,rq.provider,rq.result_count AS "resultCount",rq.confidence,rq.created_at AS "createdAt",
      ra.summary,ra.bullish_count AS bullish,ra.bearish_count AS bearish,ra.risk_count AS risk,
      ra.primary_source_count AS "primarySourceCount",ra.source_diversity AS "sourceDiversity",ra.freshness_score AS "freshnessScore"
      FROM research_queries rq LEFT JOIN research_analyses ra ON ra.query_id=rq.id
      WHERE rq.query ILIKE $1 ORDER BY rq.created_at DESC LIMIT $2`,[like,limit]);
   return send(res,200,{ok:true,cloud:true,items:r.rows});
  }
  const r=await MARKET_POOL.query(`SELECT rq.id,rq.query,rq.provider,rq.result_count AS "resultCount",rq.confidence,rq.created_at AS "createdAt",
      ra.summary,ra.bullish_count AS bullish,ra.bearish_count AS bearish,ra.risk_count AS risk,
      ra.primary_source_count AS "primarySourceCount",ra.source_diversity AS "sourceDiversity",ra.freshness_score AS "freshnessScore"
      FROM research_queries rq LEFT JOIN research_analyses ra ON ra.query_id=rq.id
      ORDER BY rq.created_at DESC LIMIT $1`,[limit]);
  const count=await MARKET_POOL.query('SELECT COUNT(*)::int AS n FROM research_sources');
  return send(res,200,{ok:true,cloud:true,totalSources:count.rows[0]?.n||0,items:r.rows});
 }catch(e){return send(res,200,{ok:true,cloud:false,items:[],error:e.message})}
}

const RESEARCH_FETCH_CACHE=new Map();
const RESEARCH_FETCH_CACHE_TTL_MS=10*60*1000;
const RESEARCH_FETCH_RATE_LIMIT=60;
const RESEARCH_FETCH_RATE_WINDOW_MS=60*1000;
let researchFetchRateStart=Date.now(),researchFetchRateCount=0;
function researchFetchRateAllowed(){const now=Date.now();if(now-researchFetchRateStart>=RESEARCH_FETCH_RATE_WINDOW_MS){researchFetchRateStart=now;researchFetchRateCount=0;}if(researchFetchRateCount>=RESEARCH_FETCH_RATE_LIMIT)return false;researchFetchRateCount++;return true;}
const RESEARCH_FETCH_MAX_BYTES=450*1024;
const RESEARCH_FETCH_MAX_TEXT=15000;
function isPublicResearchIp(ip){
 const family=net.isIP(ip);
 if(family===4){
  const p=ip.split('.').map(Number),a=p[0],b=p[1],d=p[2];
  if(a===0||a===10||a===127||a>=224)return false;
  if(a===169&&b===254)return false;
  if(a===172&&b>=16&&b<=31)return false;
  if(a===192&&b===168)return false;
  if(a===100&&b>=64&&b<=127)return false;
  if(a===192&&b===0&&(d===0||d===2))return false;
  if(a===192&&b===88&&d===99)return false;
  if(a===198&&(b===18||b===19||b===51))return false;
  if(a===203&&b===0&&d===113)return false;
  return true;
 }
 if(family===6){
  const x=ip.toLowerCase();
  if(x==='::'||x==='::1'||x.startsWith('::ffff:'))return false;
  const first=parseInt(x.split(':')[0]||'0',16);
  return first>=0x2000&&first<=0x3fff&&!x.startsWith('2001:db8:')&&!x.startsWith('2001:10:');
 }
 return false;
}
function safeResearchUrl(raw){
 let u;
 try{u=new URL(String(raw||''))}catch{throw new Error('Invalid source URL')}
 if(u.protocol!=='https:')throw new Error('Only public HTTPS article links are supported');
 if(u.port&&u.port!=='443')throw new Error('Only HTTPS on standard port 443 is supported');
 if(u.username||u.password)throw new Error('URLs with embedded credentials are not allowed');
 if(!u.hostname||net.isIP(u.hostname)||/(^|\.)(localhost|local|internal|test|invalid)$/i.test(u.hostname))throw new Error('Private or non-public hostnames are not allowed');
 if(u.hostname.length>253||u.href.length>2048)throw new Error('Source URL is too long');
 u.hash='';
 return u;
}
function researchHtmlAttr(tag,name){
 const re=new RegExp("(?:^|\\s)"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i");
 const m=String(tag||'').match(re);return m?(m[1]??m[2]??m[3]??'').trim():'';
}
function decodeResearchHtml(s){
 return String(s||'')
 .replace(/&#x([0-9a-f]+);?/gi,(_,v)=>{const n=parseInt(v,16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' '})
 .replace(/&#([0-9]+);?/g,(_,v)=>{const n=Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' '})
 .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&#39;/g,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
 .replace(/&(?:copy|reg|trade|mdash|ndash|hellip);/gi,m=>({'&copy;':'©','&reg;':'®','&trade;':'™','&mdash;':'—','&ndash;':'–','&hellip;':'…'}[m.toLowerCase()]||' '));
}
function extractResearchPage(html,baseUrl,contentType){
 const all=String(html||'');
 const meta=[...all.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]);
 const metaValue=(names)=>{
  for(const tag of meta){
   const key=(researchHtmlAttr(tag,'property')||researchHtmlAttr(tag,'name')||researchHtmlAttr(tag,'itemprop')).toLowerCase();
   if(names.includes(key)){const val=researchHtmlAttr(tag,'content');if(val)return decodeResearchHtml(val).trim()}
  }return '';
 };
 const tags=[...all.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
 const title=metaValue(['og:title','twitter:title'])||decodeResearchHtml(tags[0]?.[1]||'').replace(/\s+/g,' ').trim();
 const description=metaValue(['description','og:description','twitter:description']).slice(0,1200);
 const publishedAt=metaValue(['article:published_time','datepublished','datepublished','pubdate','parsely-pub-date','date']);
 const canonicalTag=all.match(/<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i);
 let canonicalUrl=baseUrl;
 if(canonicalTag){const href=researchHtmlAttr(canonicalTag[0],'href');if(href){try{const candidate=new URL(href,baseUrl);if(candidate.protocol==='https:'&&!candidate.username&&!candidate.password)canonicalUrl=candidate.href}catch{}}}
 const articleBlocks=[...all.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m=>m[1]);
 const mainBlocks=[...all.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)].map(m=>m[1]);
 const chosen=(articleBlocks.sort((a,b)=>b.length-a.length)[0]||mainBlocks.sort((a,b)=>b.length-a.length)[0]||((all.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)||[])[1])||all);
 const text=decodeResearchHtml(chosen
  .replace(/<(script|style|noscript|svg|canvas|iframe|form|nav|footer|header|aside|button|select|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/<!--[\s\S]*?-->/g,' ')
  .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/main)\b[^>]*>/gi,'\n')
  .replace(/<[^>]+>/g,' ')
 ).replace(/[ \t\f\v]+/g,' ').replace(/\n\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,RESEARCH_FETCH_MAX_TEXT);
 return {title:title.slice(0,300),description,canonicalUrl,publishedAt,text,contentType};
}
async function fetchResearchHttps(rawUrl){
 let current=safeResearchUrl(rawUrl),lastContentType='';
 for(let hop=0;hop<=4;hop++){
  current=safeResearchUrl(current.href);
  let addresses;
  try{addresses=await dns.lookup(current.hostname,{all:true,verbatim:true})}catch{throw new Error('Source hostname could not be resolved')}
  if(!addresses.length||addresses.some(a=>!isPublicResearchIp(a.address)))throw new Error('Source resolved to a private or non-public network address');
  const chosen=addresses[0];
  const result=await new Promise((resolve,reject)=>{
   let done=false,total=0;const chunks=[];
   const finish=(err,val)=>{if(done)return;done=true;clearTimeout(kill);err?reject(err):resolve(val)};
   const options={
    protocol:'https:',hostname:current.hostname,port:current.port||443,
    path:current.pathname+current.search,method:'GET',agent:false,rejectUnauthorized:true,
    servername:current.hostname,maxHeaderSize:16*1024,
    lookup:(host,opts,cb)=>{if(opts&&opts.all)cb(null,[{address:chosen.address,family:chosen.family}]);else cb(null,chosen.address,chosen.family)},
    headers:{'User-Agent':'FinPilotResearchFetcher/1.0 (+https://finpilot-ai-8wn6.onrender.com)','Accept':'text/html,application/xhtml+xml,text/plain;q=0.8','Accept-Encoding':'identity'}
   };
   const request=https.request(options,response=>{
    const status=Number(response.statusCode||0);
    if(status>=300&&status<400&&response.headers.location){response.resume();return finish(null,{redirect:response.headers.location,status})}
    lastContentType=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
    if(status<200||status>=300){response.resume();return finish(new Error('Publisher returned HTTP '+status))}
    if(!['text/html','application/xhtml+xml','text/plain'].includes(lastContentType)){response.resume();return finish(new Error('Source is not a readable HTML or text page'))}
    response.on('data',chunk=>{
     total+=chunk.length;
     if(total>RESEARCH_FETCH_MAX_BYTES){request.destroy();return finish(new Error('Source page exceeds the retrieval size limit'))}
     chunks.push(chunk);
    });
    response.on('error',err=>finish(err));
    response.on('end',()=>finish(null,{status,html:Buffer.concat(chunks).toString('utf8'),contentType:lastContentType}));
   });
   const kill=setTimeout(()=>request.destroy(new Error('Source retrieval timed out')),7000);
   request.on('error',err=>finish(err));
   request.end();
  });
  if(result.redirect){
   if(hop===4)throw new Error('Source redirected too many times');
   current=new URL(result.redirect,current);continue;
  }
  return {finalUrl:current.href,html:result.html,contentType:result.contentType||lastContentType};
 }
 throw new Error('Could not retrieve source page');
}
async function researchFetch(req,res,u){
 const raw=(u.searchParams.get('url')||'').trim();
 if(!raw)return send(res,400,{ok:false,error:'MISSING_SOURCE_URL'});
 if(raw.length>2048)return send(res,400,{ok:false,error:'SOURCE_URL_TOO_LONG'});
 let normalized;
 try{normalized=safeResearchUrl(raw)}catch(e){return send(res,400,{ok:false,error:'SOURCE_URL_REJECTED',message:e.message})}
 if(!researchFetchRateAllowed())return send(res,429,{ok:false,error:'RETRIEVAL_RATE_LIMITED',message:'Article retrieval is temporarily rate-limited. Please retry after one minute.'},'application/json; charset=utf-8',{'Retry-After':'60'});
 const key=normalized.href,cachedPage=RESEARCH_FETCH_CACHE.get(key),now=Date.now();
 if(cachedPage&&cachedPage.expiresAt>now)return send(res,200,{ok:true,...cachedPage.data,cached:true,cacheAgeMs:now-cachedPage.cachedAt});
 if(cachedPage)RESEARCH_FETCH_CACHE.delete(key);
 try{
  const fetched=await fetchResearchHttps(key);
  const page=extractResearchPage(fetched.html,fetched.finalUrl,fetched.contentType);
  if(!page.title&&!page.text)return send(res,422,{ok:false,error:'NO_READABLE_CONTENT',message:'The publisher returned a page but no readable article text could be extracted.',finalUrl:fetched.finalUrl});
  const data={provider:'safe-public-page-fetcher',requestedUrl:key,finalUrl:fetched.finalUrl,canonicalUrl:page.canonicalUrl,title:page.title,description:page.description,publishedAt:page.publishedAt||null,text:page.text,contentType:fetched.contentType,extractedAt:new Date().toISOString(),retrievalStatus:page.text.length>=80?'RETRIEVED':'PARTIAL',textLength:page.text.length,warning:page.text.length<80?'Only a short excerpt was available; verify directly on the publisher page.':null};
  RESEARCH_FETCH_CACHE.set(key,{data,cachedAt:Date.now(),expiresAt:Date.now()+RESEARCH_FETCH_CACHE_TTL_MS});
  while(RESEARCH_FETCH_CACHE.size>150)RESEARCH_FETCH_CACHE.delete(RESEARCH_FETCH_CACHE.keys().next().value);
  return send(res,200,{ok:true,...data,cached:false,cacheAgeMs:0});
 }catch(e){
  const message=String(e?.message||'Source could not be retrieved').slice(0,220);
  const code=/private|non-public|credential|HTTPS|hostname|invalid|URL|too long/i.test(message)?'SOURCE_URL_REJECTED':/HTTP \d+|not a readable|size limit|too many times/i.test(message)?'SOURCE_BLOCKED_OR_UNSUPPORTED':/timed out/i.test(message)?'SOURCE_TIMEOUT':'SOURCE_UNAVAILABLE';
  return send(res,200,{ok:false,error:code,requestedUrl:key,message:'FinPilot could not safely retrieve this page. Open the source directly; the search snippet remains available.',retrievalStatus:'UNAVAILABLE'});
 }
}

async function taskResearch(req,res){
 const input=await body(req);
 const plan=planFinancialTask(input||{});
 const discovery=buildSupplementalDiscovery(plan);
 try{
  // Enforce the free-only RSS path even if another search provider is configured.
  const data=await searchWeb(discovery.query,{count:4,freeOnly:true});
  const rawResults=Array.isArray(data.results)?data.results:[];
  const resultsForTask=plan.instrument?.explicitSymbol?filterFinancialSearchResults(rawResults,plan):rawResults;
  const filteredCount=Math.max(0,rawResults.length-resultsForTask.length);
  const retrievedAt=new Date().toISOString();
  const results=resultsForTask.map(x=>({
   ...x,
   discoveryQuery:discovery.query,
   sourceRole:discovery.sourceRole,
   evidenceType:discovery.evidenceType,
   assetClass:discovery.assetClass,
   quoteEligible:false,
   executionEligible:false,
   retrievedAt
  }));
  return send(res,200,{
   ok:true,plan,
   discovery:{
    ...discovery,
    provider:data.provider||'google-news-rss',
    live:data.live===true,
    cached:data.cached===true,
    fetchedAt:data.fetchedAt||null,
    retrievedAt,
    resultCount:results.length,
    filteredOutCount:filteredCount,
    relevanceFilter:plan.instrument?.explicitSymbol?'SYMBOL_AND_FINANCIAL_TOPIC':'NOT_REQUIRED',
    message:results.length?'Only ticker-matched financial sources are shown.':(plan.instrument?.explicitSymbol?'No ticker-matched financial sources passed the relevance filter; unrelated acronym matches were withheld.':'No supplemental sources returned.'),
    results,
    error:results.length?null:(plan.instrument?.explicitSymbol?'NO_RELEVANT_FINANCIAL_RESULTS':null)
   }
  });
 }catch(e){
  return send(res,200,{
   ok:true,plan,
   discovery:{
    ...discovery,
    provider:'google-news-rss',
    live:false,cached:false,fetchedAt:null,retrievedAt:new Date().toISOString(),
    resultCount:0,results:[],
    error:'SUPPLEMENTAL_SEARCH_UNAVAILABLE',
    message:String(e?.message||'Free supplemental search unavailable').slice(0,240),
    externalUrl:'https://www.google.com/search?q='+encodeURIComponent(discovery.query)
   }
  });
 }
}

async function search(req,res,u){
 const q=(u.searchParams.get('q')||'').trim();
 const count=Math.min(10,Math.max(1,Number(u.searchParams.get('count')||8)));
 const forceRefresh=u.searchParams.get('refresh')==='1'||u.searchParams.get('fresh')==='1';
 if(!q)return send(res,400,{ok:false,error:'Missing query'});
 try{
  const bareTicker=/^[A-Z][A-Z0-9]{1,9}(?:\.(?:NS|BO|L|TO|AX|DE|PA|HK|T|SW))?$/i.test(q)
    && !/^(?:NSE|BSE|NYSE|NASDAQ|USD|INR|USDT|BTCUSDT|LIVE|PRICE|STOCK|SHARES|NEWS|TODAY|FORECAST|BUY|SELL|TRADE|TRADING|OPTIONS|FUTURES|INDEX|ETF)$/i.test(q);
  const symbolPlan=bareTicker?planFinancialTask(q):null;
  const useSymbolContext=Boolean(symbolPlan?.instrument?.explicitSymbol&&['INDIAN_EQUITY','GLOBAL_EQUITY','CRYPTO'].includes(symbolPlan.assetClass));
  const baseSymbol=String(symbolPlan?.instrument?.queryToken||q).toUpperCase().split(/[/.]/)[0];
  const contextHints={INDIAN_EQUITY:'NSE BSE stock share price financial results filings',GLOBAL_EQUITY:'stock share price financial results investor relations filings',CRYPTO:'crypto price market exchange trading'};
  const searchContextQuery=useSymbolContext?(baseSymbol+' '+(contextHints[symbolPlan.assetClass]||'stock financial results')).slice(0,240):q;
  const fetched=await searchWeb(searchContextQuery,{count,forceRefresh});
  const filtered=useSymbolContext?filterFinancialSearchResults(fetched.results,symbolPlan):fetched.results;
  const d={...fetched,query:q,searchContextQuery,symbolSearch:useSymbolContext,results:useSymbolContext?(Array.isArray(filtered)?filtered:[]):fetched.results};
  if(useSymbolContext){
    d.message=d.results.length
      ?'Ticker search returned '+d.results.length+' finance-relevant result(s) for '+baseSymbol+'. Non-financial acronym matches were filtered out. Headlines are discovery evidence, not verified prices.'
      :'No finance-relevant results matched ticker '+baseSymbol+'. Unrelated acronym matches were withheld; try the company name or an exchange-qualified ticker.';
    d.externalUrl='https://www.google.com/search?q='+encodeURIComponent(searchContextQuery);
  }
  const archive=await archiveResearch(q,d);
  emitEvent('RESEARCH_UPDATE',{source:d.provider||'web',query:q,count:Array.isArray(d.results)?d.results.length:0,archive},65);
  return send(res,200,{ok:true,query:q,refreshRequested:forceRefresh,...d,...archive});
 }catch(e){
  const google=`https://www.google.com/search?q=${encodeURIComponent(q)}`;
  return send(res,200,{ok:true,query:q,provider:'google-search-bridge',results:[],externalUrl:google,fallback:'GOOGLE_SEARCH_BRIDGE',refreshRequested:forceRefresh,warning:e.code||'SEARCH_PROVIDER_UNAVAILABLE',message:'Free news search could not return results for this request. Open Google Search to continue; results opened there are not automatically imported into FinPilot.',live:false,cached:false,freshness:'FALLBACK'});
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
 const started=Date.now(), x=await body(req);
 const supplied=Array.isArray(x.agents)&&x.agents.length?x.agents:['Bull','Bear','Risk','CFO','CEO'];
 const names=supplied.slice(0,12).map(name=>clean(name,64)||'Unknown');
 PERF.agentRuns+=names.length;
 const surplus=Number(x.income||0)-Number(x.spending||0), reserve=Number(x.emergency||0)/Math.max(1,Number(x.spending||0));
 const results=await Promise.all(names.map(async name=>{
   const t=Date.now(); let view='Executive synthesis',stance='REVIEW';
   if(name==='Bull'){view='Upside case';stance=surplus>=0?'CONSTRUCTIVE':'WAIT';}
   else if(name==='Bear'){view='Downside case';stance=reserve<3?'DEFENSIVE':'WATCH';}
   else if(name==='Risk'){view='Risk constraints';stance=reserve<3?'HIGH RISK':'CONTROLLED';}
   else if(name==='CFO'){view='Capital discipline';stance=surplus>0&&reserve>=3?'CAPITAL AVAILABLE':'CAPITAL PROTECTED';}
   else if(name==='CEO'){view='Executive synthesis';stance=reserve<3?'WAIT':'CONDITIONAL';}
   remember(name,{source:'SERVER_EXECUTED',decision:stance,lesson:view});
   return {agent:name,status:'READY',latencyMs:Math.max(1,Date.now()-t),view,stance};
 }));
 return send(res,200,{ok:true,engine:'parallel-agent-orchestrator-v4200',latencyMs:Date.now()-started,results,sequence:['Bull','Bear','Risk','CFO','CEO'],parallel:true,note:'Actual deterministic specialist runs are recorded in process-memory telemetry; this is not durable training or persistent memory. No financial transaction is executed.'});
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
 return PROVIDER_RESPONSE_CACHE.get(url,async()=>{
  const r=await resilientFetch(url,'binance');
  if(!r.ok)throw new Error(`provider ${r.status}`);
  return r.json();
 });
}
function sma(a,n){return a.length<n?null:a.slice(-n).reduce((x,y)=>x+y,0)/n}
function ema(a,n){if(a.length<n)return null;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(a,n=14){if(a.length<n+1)return null;let g=0,l=0;for(let i=a.length-n;i<a.length;i++){let d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}if(l===0)return 100;let rs=(g/n)/(l/n);return 100-(100/(1+rs))}
function atr(rows,n=14){if(rows.length<n+1)return null;const tr=[];for(let i=1;i<rows.length;i++){const [,,h,l,c]=rows[i];const pc=rows[i-1][4];tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)))}return sma(tr,n)}
const CRYPTO_ASSETS={BTC:'BTCUSDT',BTCUSDT:'BTCUSDT',ETH:'ETHUSDT',ETHUSDT:'ETHUSDT',SOL:'SOLUSDT',SOLUSDT:'SOLUSDT',BNB:'BNBUSDT',BNBUSDT:'BNBUSDT',XRP:'XRPUSDT',XRPUSDT:'XRPUSDT',DOGE:'DOGEUSDT',DOGEUSDT:'DOGEUSDT',ADA:'ADAUSDT',ADAUSDT:'ADAUSDT',AVAX:'AVAXUSDT',AVAXUSDT:'AVAXUSDT',LINK:'LINKUSDT',LINKUSDT:'LINKUSDT'};
const TIMEFRAMES={'15m':'15m','1h':'1h','4h':'4h','1d':'1d'};
async function directProviderJson(url,source='provider',timeoutMs=8000){
 return PROVIDER_RESPONSE_CACHE.get(url,async()=>{
  const cooldownError=providerCooldownError(source);if(cooldownError)throw cooldownError;
  const started=Date.now();
  try{
   const r=await Promise.race([fetch(url,{headers:{'User-Agent':'FinPilot/8.5 market-data adapter'}}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('PROVIDER_TIMEOUT')),timeoutMs))]);
   if(!r.ok)throw new Error(`HTTP_${r.status}`);
   qualityUpdate(source,true,Date.now()-started);recordProviderSuccess(source);
   return await r.json();
  }catch(e){qualityUpdate(source,false,Date.now()-started,e.message);recordProviderFailure(source,e.message);throw e;}
 });
}
async function liveCrypto(t, interval='1h', multi=true){
 const key=t.toUpperCase(), symbol=CRYPTO_ASSETS[key];
 if(!symbol) throw new Error('Crypto symbol not connected. Supported: BTC, ETH, SOL, BNB, XRP.');
 // Normalize quote-suffix aliases once so all providers use the same underlying asset.
 const providerSymbols=cryptoProviderSymbols(key,symbol);
 if(!providerSymbols)throw new Error('CRYPTO_PAIR_UNSUPPORTED: quote currency cannot be resolved safely');
 const baseAsset=providerSymbols.base;
 const tf=TIMEFRAMES[interval]||'1h';
 const intervals=multi?['15m','1h','4h'].filter(x=>x!==tf).concat(tf):[tf];
 const unique=[...new Set(intervals)];
 let ticker,series,provider='Binance public market data';
 try{
  [ticker,...series]=await Promise.all([
   fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
   ...unique.map(x=>fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${x}&limit=220`))
  ]);
 }catch(binanceError){
  const krakenPair=providerSymbols.krakenPair;
  const map={'15m':15,'1h':60,'4h':240,'1d':1440};
  try{
   const kTicker=await directProviderJson('https://api.kraken.com/0/public/Ticker?pair='+encodeURIComponent(krakenPair),'kraken');
   const rawTicker=Object.values(kTicker?.result||{})[0];
   if(!rawTicker?.c?.[0])throw new Error('Kraken ticker unavailable');
   ticker={lastPrice:Number(rawTicker.c[0]),prevClosePrice:Number(rawTicker.o||rawTicker.c[0]),highPrice:Number(rawTicker.h?.[1]||rawTicker.c[0]),lowPrice:Number(rawTicker.l?.[1]||rawTicker.c[0]),volume:Number(rawTicker.v?.[1]||0),_sourceObservedAt:kTicker?._finpilotCache?.observedAt||null};
   series=await Promise.all(unique.map(async x=>{
    const d=await directProviderJson('https://api.kraken.com/0/public/OHLC?pair='+encodeURIComponent(krakenPair)+'&interval='+map[x],'kraken');
    const rows=Object.values(d?.result||{}).find(v=>Array.isArray(v))||[];
    return rows.slice(-220).map(v=>[Number(v[0])*1000,Number(v[1]),Number(v[2]),Number(v[3]),Number(v[4]),Number(v[6]||0)]);
   }));
   provider='Kraken public market data fallback';
  }catch(krakenError){
   const coinPair=providerSymbols.coinbaseProduct;
   const cmap={'15m':900,'1h':3600,'4h':21600,'1d':86400};
   try{
    const coinBaseUrl='https://api.exchange.coinbase.com/products/'+encodeURIComponent(coinPair);
    const [stats,latestTrades,cc]=await Promise.all([
     directProviderJson(coinBaseUrl+'/stats','coinbase'),
     directProviderJson(coinBaseUrl+'/trades?limit=1','coinbase'),
     Promise.all(unique.map(x=>directProviderJson(coinBaseUrl+'/candles?granularity='+cmap[x],'coinbase')))
    ]);
    const latestTrade=Array.isArray(latestTrades)?latestTrades[0]:null;
    const tradeTime=String(latestTrade?.time||'');
    const tradePrice=Number(latestTrade?.price);
    const providerTradeValid=Number.isFinite(tradePrice)&&tradePrice>0&&Number.isFinite(Date.parse(tradeTime))&&Date.parse(tradeTime)<=Date.now()+5000;
    const currentPrice=providerTradeValid?tradePrice:Number(stats?.last);
    ticker={lastPrice:currentPrice,prevClosePrice:Number(stats?.open||currentPrice),highPrice:Number(stats?.high||currentPrice),lowPrice:Number(stats?.low||currentPrice),volume:Number(stats?.volume||0),_sourceAsOf:providerTradeValid?tradeTime:null,_sourceObservedAt:stats?._finpilotCache?.observedAt||null};
    series=cc.map(rows=>rows.filter(Array.isArray).map(v=>[Number(v[0])*1000,Number(v[3]),Number(v[2]),Number(v[1]),Number(v[4]),Number(v[5])]).sort((a,b)=>a[0]-b[0]).slice(-220));
    if(!Number.isFinite(ticker.lastPrice)||series.some(x=>x.length<2))throw new Error('Coinbase market data incomplete');
    provider='Coinbase Exchange public market data fallback';
   }catch(coinbaseError){
    throw new Error('CRYPTO_MARKET_UNAVAILABLE: Binance='+binanceError.message+'; Kraken='+krakenError.message+'; Coinbase='+coinbaseError.message);
   }
  }
 }
 const reports=unique.map((x,i)=>cryptoTimeframe(series[i],ticker,x));
 const main=reports.find(x=>x.interval===tf)||reports[0];
 const bullish=reports.filter(x=>x.direction==='BULLISH').length, bearish=reports.filter(x=>x.direction==='BEARISH').length;
 const consensus=bullish===reports.length?'BULLISH':bearish===reports.length?'BEARISH':'MIXED';
 const risk=Math.min(100,Math.max(10,Math.round(main.riskScore+(consensus==='MIXED'?8:consensus==='BEARISH'?15:-4))));
 const name=baseAsset;
 const providerMs=ticker?._finpilotCache||{};
 let sourceAsOf=null,sourceTimestampType='UNAVAILABLE';
 const closeTime=Number(ticker?.closeTime);
 if(Number.isFinite(closeTime)&&closeTime>0){sourceAsOf=new Date(closeTime).toISOString();sourceTimestampType='PROVIDER_TIMESTAMP';}
 else if(ticker?._sourceAsOf&&Number.isFinite(Date.parse(ticker._sourceAsOf))){sourceAsOf=new Date(ticker._sourceAsOf).toISOString();sourceTimestampType='PROVIDER_TIMESTAMP';}
 else {
  const observed=ticker?._sourceObservedAt||providerMs.observedAt;
  if(observed&&Number.isFinite(Date.parse(observed))){sourceAsOf=new Date(observed).toISOString();sourceTimestampType='OBSERVATION_TIMESTAMP';}
 }
 const sourceAgeMs=sourceAsOf?Math.max(0,Date.now()-Date.parse(sourceAsOf)):null;
 const sourceFresh=sourceAgeMs!==null&&sourceAgeMs<=EXECUTION_FRESHNESS_MS;
 const providerTimestampVerified=sourceTimestampType==='PROVIDER_TIMESTAMP';
 const executionEligible=Boolean(sourceFresh&&providerTimestampVerified);
 const dataFreshness=sourceFresh?(providerTimestampVerified?'FRESH_PROVIDER_TIMESTAMP':'FRESH_OBSERVATION_ONLY'):sourceAsOf?'STALE_SOURCE':'UNKNOWN';
 return {...main,ticker:name,symbol,name,market:'CRYPTO',provider,live:sourceFresh,executionEligible,asOf:sourceAsOf,sourceAgeMs,sourceTimestampType,dataFreshness,riskScore:risk,posture:consensus==='BULLISH'?(main.price>=main.resistance*.995?'BREAKOUT WATCH':'BULLISH / CONFIRMATION'):consensus==='BEARISH'?'DEFENSIVE / REVIEW':'MIXED / WAIT FOR CONFIRMATION',multiTimeframe:{consensus,checked:reports.map(r=>({interval:r.interval,direction:r.direction,rsi:r.rsi,priceVsSma50:r.price>r.sma50,priceVsSma200:r.price>r.sma200})),bullish,bearish},sources:[{name:provider,use:`Live ${unique.join(', ')} OHLCV + ticker`,freshness:sourceTimestampType==='PROVIDER_TIMESTAMP'?'Timestamped by provider':'Observed by FinPilot at '+(sourceAsOf||'unknown time'),url:'https://www.binance.com/en/markets'}],evidenceQuality:executionEligible?'VERIFIED LIVE — provider quote timestamp tracked; multi-timeframe consensus calculated by FinPilot':sourceFresh?'FRESH OBSERVATION ONLY — provider quote timestamp is absent; forecasts and paper execution are blocked':'NON-LIVE — quote timestamp is stale or unavailable; analysis only'};
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

const INDIA_INDICES={NIFTY:'^NSEI',BANKNIFTY:'^NSEBANK',FINNIFTY:'^CNXFIN',SENSEX:'^BSESN'};
const INDIA_EQUITIES={
 TCS:'TCS.NS',INFY:'INFY.NS',RELIANCE:'RELIANCE.NS',GAIL:'GAIL.NS',HINDZINC:'HINDZINC.NS',
 ITC:'ITC.NS',TATAPOWER:'TATAPOWER.NS',TATASTEEL:'TATASTEEL.NS',SUNPHARMA:'SUNPHARMA.NS',
 TRENT:'TRENT.NS',TECHM:'TECHM.NS',HCLTECH:'HCLTECH.NS',INDIGO:'INDIGO.NS',JUBLFOOD:'JUBLFOOD.NS',SBC:'SBC.NS',
 PAYTM:'PAYTM.NS',IRFC:'IRFC.NS',SBIN:'SBIN.NS',HDFCBANK:'HDFCBANK.NS',ICICIBANK:'ICICIBANK.NS',
 BHARTIARTL:'BHARTIARTL.NS',LT:'LT.NS',ADANIPORTS:'ADANIPORTS.NS',BAJFINANCE:'BAJFINANCE.NS',
 HINDALCO:'HINDALCO.NS',WIPRO:'WIPRO.NS',MARUTI:'MARUTI.NS',AXISBANK:'AXISBANK.NS',KOTAKBANK:'KOTAKBANK.NS'
};
const YAHOO_RESOLVE_CACHE=new Map();
const YAHOO_INSTRUMENT_SEARCH_CACHE=new Map();
const COMMON_US_EQUITY_SYMBOLS = new Set([
 'AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','GOOG','META','AMD','INTC','ORCL','CRM','NFLX',
 'AVGO','ADBE','JPM','V','MA','KO','PEP','COST','WMT','DIS','UBER','SHOP','PLTR','LLY','XOM',
 'BAC','GS','MCD','TMO','QCOM','CSCO','PFE','BA','NKE','IBM','BRK.B'
]);
function normalizeInstrumentDirectoryText(value){
 return String(value||'').toUpperCase()
  .replace(/\b(?:INCORPORATED|CORPORATION|CORP|INC|LIMITED|LTD|PLC|COMPANY|CO|STOCK|SHARES?|SHARE PRICE)\b/g,' ')
  .replace(/[^A-Z0-9.]+/g,' ').replace(/\s+/g,' ').trim();
}
const INSTRUMENT_NAME_ALIASES=new Map([
 ['APPLE','AAPL'],['APPLE COMPUTER','AAPL'],['MICROSOFT','MSFT'],['TESLA','TSLA'],
 ['NVIDIA','NVDA'],['AMAZON','AMZN'],['AMAZON.COM','AMZN'],['GOOGLE','GOOGL'],
 ['ALPHABET','GOOGL'],['FACEBOOK','META'],['META PLATFORMS','META'],['ADOBE','ADBE'],
 ['BERKSHIRE HATHAWAY','BRK-B'],['BRK.B','BRK-B'],['RELIANCE INDUSTRIES','RELIANCE'],
 ['INDIAN RAILWAY FINANCE CORPORATION','IRFC'],['TATA CONSULTANCY SERVICES','TCS'],
 ['INFOSYS','INFY'],['SBC EXPORTS','SBC']
]);
const INSTRUMENT_DISPLAY_NAMES={
 AAPL:'Apple Inc.',MSFT:'Microsoft Corporation',TSLA:'Tesla, Inc.',NVDA:'NVIDIA Corporation',
 AMZN:'Amazon.com, Inc.',GOOGL:'Alphabet Inc.',GOOG:'Alphabet Inc.',META:'Meta Platforms, Inc.',
 ADBE:'Adobe Inc.','BRK-B':'Berkshire Hathaway Inc.',AMD:'Advanced Micro Devices, Inc.',
 INTC:'Intel Corporation',ORCL:'Oracle Corporation',CRM:'Salesforce, Inc.',NFLX:'Netflix, Inc.',
 AVGO:'Broadcom Inc.',JPM:'JPMorgan Chase & Co.',V:'Visa Inc.',MA:'Mastercard Incorporated',
 KO:'The Coca-Cola Company',PEP:'PepsiCo, Inc.',COST:'Costco Wholesale Corporation',
 WMT:'Walmart Inc.',DIS:'The Walt Disney Company',UBER:'Uber Technologies, Inc.',
 SHOP:'Shopify Inc.',PLTR:'Palantir Technologies Inc.',LLY:'Eli Lilly and Company',
 XOM:'Exxon Mobil Corporation',BAC:'Bank of America Corporation',GS:'Goldman Sachs Group, Inc.',
 MCD:'McDonald’s Corporation',QCOM:'Qualcomm Incorporated',CSCO:'Cisco Systems, Inc.',
 PFE:'Pfizer Inc.',BA:'The Boeing Company',NKE:'NIKE, Inc.',IBM:'International Business Machines Corporation',
 SBC:'SBC Exports Ltd.',IRFC:'Indian Railway Finance Corporation Ltd.',RELIANCE:'Reliance Industries Ltd.',
 TCS:'Tata Consultancy Services Ltd.',INFY:'Infosys Ltd.',GAIL:'GAIL (India) Ltd.',
 HINDZINC:'Hindustan Zinc Ltd.',ITC:'ITC Ltd.',TATAPOWER:'Tata Power Company Ltd.',
 TATASTEEL:'Tata Steel Ltd.',SUNPHARMA:'Sun Pharmaceutical Industries Ltd.',
 TRENT:'Trent Ltd.',TECHM:'Tech Mahindra Ltd.',HCLTECH:'HCL Technologies Ltd.',
 INDIGO:'InterGlobe Aviation Ltd.',JUBLFOOD:'Jubilant FoodWorks Ltd.',PAYTM:'One 97 Communications Ltd.',
 SBIN:'State Bank of India',HDFCBANK:'HDFC Bank Ltd.',ICICIBANK:'ICICI Bank Ltd.',
 BHARTIARTL:'Bharti Airtel Ltd.',LT:'Larsen & Toubro Ltd.',ADANIPORTS:'Adani Ports and SEZ Ltd.',
 BAJFINANCE:'Bajaj Finance Ltd.',HINDALCO:'Hindalco Industries Ltd.',WIPRO:'Wipro Ltd.',
 MARUTI:'Maruti Suzuki India Ltd.',AXISBANK:'Axis Bank Ltd.',KOTAKBANK:'Kotak Mahindra Bank Ltd.'
};
function localInstrumentDirectory(query,count=10){
 const raw=normalizeInstrumentDirectoryText(query);
 if(!raw)return [];
 const alias=INSTRUMENT_NAME_ALIASES.get(raw)||null;
 const rows=new Map();
 const venueFromSymbol=symbol=>{
  const x=String(symbol||'').toUpperCase();
  if(/\.NS$/.test(x))return ['NSE','NSE India'];
  if(/\.BO$/.test(x))return ['BSE','BSE India'];
  if(/\.L$/.test(x))return ['LSE','London Stock Exchange'];
  if(/\.TO$/.test(x))return ['TSX','Toronto Stock Exchange'];
  if(/\.AX$/.test(x))return ['ASX','Australian Securities Exchange'];
  if(/\.DE$/.test(x))return ['XETRA','Xetra'];
  if(/\.PA$|\.AS$/.test(x))return ['EURONEXT','Euronext'];
  if(/\.HK$/.test(x))return ['HKG','Hong Kong Stock Exchange'];
  if(/\.T$/.test(x))return ['TSE','Tokyo Stock Exchange'];
  if(/\.SW$/.test(x))return ['SIX','SIX Swiss Exchange'];
  if(/\.SI$/.test(x))return ['SGX','Singapore Exchange'];
  if(/\.SA$/.test(x))return ['B3','B3 Brazil'];
  if(/\.JK$/.test(x))return ['IDX','Indonesia Stock Exchange'];
  if(/\.KL$/.test(x))return ['BURSA','Bursa Malaysia'];
  if(/\.BK$/.test(x))return ['SET','Stock Exchange of Thailand'];
  if(/\.NZ$/.test(x))return ['NZX','New Zealand Exchange'];
  if(/\.SR$/.test(x))return ['TADAWUL','Saudi Exchange'];
  if(/\.TA$/.test(x))return ['TASE','Tel Aviv Stock Exchange'];
  if(/\.KS$|\.KQ$/.test(x))return ['KRX','Korea Exchange'];
  if(/\.TW$/.test(x))return ['TWSE','Taiwan Stock Exchange'];
  if(/\.SS$/.test(x))return ['SSE','Shanghai Stock Exchange'];
  if(/\.SZ$/.test(x))return ['SZSE','Shenzhen Stock Exchange'];
  return ['','Venue not confirmed'];
 };
 const add=(symbol,name,exchange='',exchangeDisplay='Venue not confirmed',quoteType='EQUITY')=>{
  const key=String(symbol||'').toUpperCase();
  if(!key||rows.has(key))return;
  const base=key.replace(/\.(?:NS|BO)$/,'');
  rows.set(key,{symbol:key,shortName:name||key,longName:name||key,exchange,exchangeDisplay,quoteType,typeDisplay:quoteType==='INDEX'?'Index':quoteType==='ETF'?'ETF':'Equity',score:0,_base:base});
 };
 for(const [base,symbol] of Object.entries(INDIA_EQUITIES)){
  const [exchange,display]=venueFromSymbol(symbol);
  add(base,INSTRUMENT_DISPLAY_NAMES[base]||base,exchange,display);
 }
 for(const [country,symbol] of GLOBAL_STOCK_TEST_SET){
  const [exchange,display]=venueFromSymbol(symbol);
  const bare=String(symbol).replace(/\.[A-Z]+$/,'');
  add(symbol,INSTRUMENT_DISPLAY_NAMES[bare]||INSTRUMENT_DISPLAY_NAMES[symbol]||bare,exchange,display||country);
 }
 for(const symbol of COMMON_US_EQUITY_SYMBOLS){
  const [exchange,display]=venueFromSymbol(symbol);
  add(symbol,INSTRUMENT_DISPLAY_NAMES[symbol]||symbol,exchange,display||'US listing · exact venue not verified');
 }
 for(const index of GLOBAL_INDEXES){
  add(index.symbol,index.name,index.exchange||'',index.exchange||'Index provider not verified','INDEX');
 }
 const scored=[];
 for(const item of rows.values()){
  const symbol=item.symbol.toUpperCase(),base=item._base;
  const name=normalizeInstrumentDirectoryText(item.longName);
  let score=-1;
  if(alias&&(symbol===alias||base===alias||symbol===alias.replace(/-$/,'.B')))score=100000;
  else if(raw===symbol)score=90000;
  else if(raw===base)score=85000;
  else if(raw===name)score=70000;
  else if(raw.length>=3&&name.includes(raw))score=30000+raw.length;
  else if(raw.length>=3&&raw.includes(name)&&name.length>=4)score=10000+name.length;
  if(score>=0)scored.push({...item,score});
 }
 return scored.sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(10,Number(count)||10))).map(({_base,...rest})=>rest);
}

async function instrumentSearch(req,res,u){
 const query=String(u.searchParams.get('q')||'').trim().replace(/\s+/g,' ');
 const count=Math.max(1,Math.min(10,Number(u.searchParams.get('count')||10)));
 if(!query)return send(res,400,{ok:false,error:'QUERY_REQUIRED'});
 if(query.length>80)return send(res,400,{ok:false,error:'QUERY_TOO_LONG'});
 const key=query.toLowerCase();
 const cached=YAHOO_INSTRUMENT_SEARCH_CACHE.get(key);
 if(cached&&Date.now()-cached.at<10*60*1000)return send(res,200,{ok:true,query,provider:'Yahoo Finance instrument directory',cached:true,results:cached.results.slice(0,count)});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
 try{
  const url='https://query1.finance.yahoo.com/v1/finance/search?q='+encodeURIComponent(query)+'&quotesCount='+Math.min(10,count)+'&newsCount=0';
  const response=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.6 instrument-directory'},signal:controller.signal});
  if(!response.ok)throw new Error('Instrument directory HTTP '+response.status);
  const payload=await response.json();
  const accepted=new Set(['EQUITY','ETF','INDEX','CRYPTOCURRENCY','MUTUALFUND']);
  const seen=new Set();
  const results=(Array.isArray(payload?.quotes)?payload.quotes:[]).filter(x=>{
    const symbol=String(x?.symbol||'').trim().toUpperCase();
    const type=String(x?.quoteType||'').toUpperCase();
    if(!symbol||!accepted.has(type)||seen.has(symbol))return false;
    seen.add(symbol);return true;
  }).slice(0,count).map(x=>({
    symbol:String(x.symbol).toUpperCase(),
    shortName:String(x.shortname||x.shortName||x.symbol),
    longName:String(x.longname||x.longName||x.shortname||x.symbol),
    exchange:String(x.exchange||''),
    exchangeDisplay:String(x.exchDisp||x.exchange||''),
    quoteType:String(x.quoteType||'').toUpperCase(),
    typeDisplay:String(x.typeDisp||x.quoteType||''),
    score:Number.isFinite(Number(x.score))?Number(x.score):0
  }));
  if(results.length){
    YAHOO_INSTRUMENT_SEARCH_CACHE.set(key,{at:Date.now(),results});
    while(YAHOO_INSTRUMENT_SEARCH_CACHE.size>200)YAHOO_INSTRUMENT_SEARCH_CACHE.delete(YAHOO_INSTRUMENT_SEARCH_CACHE.keys().next().value);
    return send(res,200,{ok:true,query,provider:'Yahoo Finance instrument directory',cached:false,results});
  }
  const localResults=localInstrumentDirectory(query,count);
  if(localResults.length)return send(res,200,{ok:true,query,provider:'FinPilot local instrument directory',cached:false,fallback:true,warning:'Directory fallback only; source venue may be unverified and no price is implied.',results:localResults});
  return send(res,200,{ok:true,query,provider:'Yahoo Finance instrument directory',cached:false,results:[]});
 }catch(e){
  const localResults=localInstrumentDirectory(query,count);
  if(localResults.length)return send(res,200,{ok:true,query,provider:'FinPilot local instrument directory',cached:false,fallback:true,upstreamError:e?.name==='AbortError'?'INSTRUMENT_DIRECTORY_TIMEOUT':String(e?.message||'INSTRUMENT_DIRECTORY_UNAVAILABLE'),warning:'Directory fallback only; source venue may be unverified and no price is implied.',results:localResults});
  const reason=e?.name==='AbortError'?'INSTRUMENT_DIRECTORY_TIMEOUT':String(e?.message||'INSTRUMENT_DIRECTORY_UNAVAILABLE');
  return send(res,200,{ok:false,query,provider:'Yahoo Finance instrument directory',cached:false,results:[],error:reason});
 }finally{clearTimeout(timer);}
}

async function resolveYahooSymbol(input){
 const raw=String(input||'').trim().toUpperCase();
 const directIndia=INDIA_INDICES[raw]||INDIA_EQUITIES[raw];
 if(directIndia)return directIndia;
 const alias=INSTRUMENT_NAME_ALIASES.get(normalizeInstrumentDirectoryText(raw));
 if(alias){
  const aliasIndia=INDIA_INDICES[alias]||INDIA_EQUITIES[alias];
  if(aliasIndia)return aliasIndia;
  return alias;
 }
 const explicitIndex=/^\^[A-Z0-9_.-]+$/.test(raw);
 const suffixMatch=raw.match(/\.([A-Z0-9]{1,5})$/);
 const knownSuffix=new Set(['NS','BO','L','TO','AX','DE','PA','HK','T','SW','AS','MI','SA','JK','KL','BK','SI','NZ','JO','SR','TA','KS','KQ','TW','SS','SZ','MX']);
 if(explicitIndex||(suffixMatch&&knownSuffix.has(suffixMatch[1])))return normalizeGlobalSymbol(raw);
 const compact=raw.replace(/[^A-Z0-9]/g,'');
 const index=GLOBAL_INDEXES.find(x=>{
  const symbol=String(x.symbol||'').toUpperCase(),name=String(x.name||'').toUpperCase();
  return symbol===raw||name===raw||name.replace(/[^A-Z0-9]/g,'')===compact;
 });
 if(index)return index.symbol;
 // Common US symbols may be resolved directly; unfamiliar bare symbols go through the directory.
 if(COMMON_US_EQUITY_SYMBOLS.has(raw))return raw;
 if(!/^[A-Z0-9 .&'_-]{1,80}$/.test(raw))return null;
 const cached=YAHOO_RESOLVE_CACHE.get(raw);
 if(cached&&Date.now()-cached.at<6*60*60*1000)return cached.symbol||null;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const u='https://query1.finance.yahoo.com/v1/finance/search?q='+encodeURIComponent(raw)+'&quotesCount=10&newsCount=0';
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.6 instrument-resolver'},signal:controller.signal});
  if(!r.ok)throw new Error('Instrument directory HTTP '+r.status);
  const d=await r.json();
  const quotes=Array.isArray(d?.quotes)?d.quotes:[];
  const accepted=quotes.filter(x=>['EQUITY','ETF','INDEX'].includes(String(x.quoteType||'').toUpperCase())&&x.symbol);
  const exact=accepted.find(x=>String(x.symbol).trim().toUpperCase()===raw);
  const chosen=exact||accepted[0]||null;
  const symbol=chosen?.symbol?String(chosen.symbol).trim().toUpperCase():null;
  YAHOO_RESOLVE_CACHE.set(raw,{at:Date.now(),symbol});
  return symbol;
 }catch{YAHOO_RESOLVE_CACHE.set(raw,{at:Date.now(),symbol:null});return null}
 finally{clearTimeout(timer)}
}
function yahooSymbol(t){
 const k=String(t||'').trim().toUpperCase();
 return INDIA_INDICES[k]||INDIA_EQUITIES[k]||normalizeGlobalSymbol(k)||(/^[A-Z0-9._-]{1,30}$/.test(k)?k:null);
}
const EQUITY_MARKET_CACHE=new Map();
const YAHOO_LAST_GOOD=new Map();
const YAHOO_COOLDOWN=new Map();
const YAHOO_INFLIGHT=new Map();
const MARKET_CACHE_MS=Math.max(5000,Number(process.env.FINPILOT_MARKET_CACHE_MS||15000));
const YAHOO_COOLDOWN_MS=Math.max(15000,Number(process.env.FINPILOT_YAHOO_COOLDOWN_MS||60000));
const EXECUTION_FRESHNESS_MS=Math.max(15000,Number(process.env.FINPILOT_EXECUTION_FRESHNESS_MS||90000));

async function fetchNseIndex(indexKey){
 const names={NIFTY:'NIFTY 50',BANKNIFTY:'NIFTY BANK',FINNIFTY:'NIFTY FINANCIAL SERVICES',SENSEX:'SENSEX'};
 const name=names[indexKey];
 if(!name)throw new Error('Unsupported index.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const url='https://www.nseindia.com/api/equity-stockIndices?index='+encodeURIComponent(name);
  const r=await fetch(url,{headers:{
   'Accept':'application/json,text/plain,*/*',
   'Accept-Language':'en-IN,en;q=0.9',
   'Referer':'https://www.nseindia.com/',
   'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
  },signal:controller.signal});
  if(!r.ok)throw new Error('NSE HTTP '+r.status);
  const d=await r.json(),rows=Array.isArray(d?.data)?d.data:[];
  const row=rows[0];
  const price=Number(row?.lastPrice),prev=Number(row?.previousClose),high=Number(row?.dayHigh),low=Number(row?.dayLow);
  if(!Number.isFinite(price))throw new Error('NSE index price unavailable');
  const changePct=Number(row?.pChange??(prev?((price-prev)/prev)*100:0));
  return {ticker:indexKey,symbol:INDIA_INDICES[indexKey],market:'INDIA_INDEX',exchange:'NSE',name, currency:'INR',
   price,previous:prev,changePct,dayHigh:high,dayLow:low,live:true,provider:'NSE India market-data page',asOf:new Date().toISOString(),
   dataFreshness:'LIVE/streaming exchange page',dataDisclaimer:'NSE market data may be subject to exchange/display delays; verify broker quote before acting.'};
 }catch(e){throw new Error(e?.name==='AbortError'?'NSE index timeout':String(e?.message||e))}
 finally{clearTimeout(timer)}
}

async function fetchGlobalProviderQuote(symbol){
 const providers=[];
 const addProvider=(id,run)=>providers.push({id,run});
 const td=process.env.TWELVEDATA_API_KEY;
 if(td)addProvider('twelvedata',async()=>{
  const u='https://api.twelvedata.com/time_series?symbol='+encodeURIComponent(symbol)+'&interval=1day&outputsize=30&apikey='+encodeURIComponent(td);
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.4'},signal:AbortSignal.timeout(8000)});const d=await r.json();
  if(!r.ok||d.status==='error'||!Array.isArray(d.values)||!d.values.length)throw new Error('TwelveData unavailable');
  const rows=d.values.slice().reverse().map(x=>({time:new Date(x.datetime).toISOString(),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume||0)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  if(rows.length<2)throw new Error('TwelveData insufficient candles');
  return {rows,provider:'Twelve Data · licensed API key',live:false};
 });
 const fh=process.env.FINNHUB_API_KEY;
 if(fh)addProvider('finnhub',async()=>{
  const to=Math.floor(Date.now()/1000),from=to-120*86400;
  const u='https://finnhub.io/api/v1/stock/candle?symbol='+encodeURIComponent(symbol)+'&resolution=D&from='+from+'&to='+to+'&token='+encodeURIComponent(fh);
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.4'},signal:AbortSignal.timeout(8000)});const d=await r.json();
  if(!r.ok||d.s!=='ok'||!Array.isArray(d.c)||d.c.length<2)throw new Error('Finnhub unavailable');
  const rows=d.c.map((close,i)=>({time:new Date(Number(d.t?.[i]||0)*1000).toISOString(),open:Number(d.o?.[i]),high:Number(d.h?.[i]),low:Number(d.l?.[i]),close:Number(close),volume:Number(d.v?.[i]||0)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  if(rows.length<2)throw new Error('Finnhub insufficient candles');
  return {rows,provider:'Finnhub · licensed API key',live:false};
 });
 const av=process.env.ALPHAVANTAGE_API_KEY;
 if(av)addProvider('alphavantage',async()=>{
  const u='https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol='+encodeURIComponent(symbol)+'&outputsize=compact&apikey='+encodeURIComponent(av);
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.4'},signal:AbortSignal.timeout(9000)});const d=await r.json();
  const series=d['Time Series (Daily)'];if(!r.ok||!series)throw new Error(String(d.Note||d.Information||'AlphaVantage unavailable'));
  const rows=Object.entries(series).map(([date,x])=>({time:new Date(date+'T00:00:00Z').toISOString(),open:Number(x['1. open']),high:Number(x['2. high']),low:Number(x['3. low']),close:Number(x['4. close']),volume:Number(x['5. volume']||0)})).sort((a,b)=>a.time.localeCompare(b.time));
  if(rows.length<2)throw new Error('AlphaVantage insufficient candles');
  return {rows,provider:'Alpha Vantage · API key',live:false};
 });
 const ms=process.env.MARKETSTACK_API_KEY;
 if(ms)addProvider('marketstack',async()=>{
  const u='https://api.marketstack.com/v1/eod?access_key='+encodeURIComponent(ms)+'&symbols='+encodeURIComponent(symbol)+'&limit=30';
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.5'},signal:AbortSignal.timeout(9000)});
  const d=await r.json();
  if(!r.ok||d.error||!Array.isArray(d.data)||d.data.length<2)throw new Error(d?.error?.message||'Marketstack unavailable');
  const rows=d.data.slice().reverse().map(x=>({time:new Date(x.date).toISOString(),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume||0)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  if(rows.length<2)throw new Error('Marketstack insufficient candles');
  return {rows,provider:'Marketstack · free-tier/API key',live:false};
 });
 const fmp=process.env.FMP_API_KEY||process.env.FINANCIAL_MODELING_PREP_API_KEY;
 if(fmp)addProvider('fmp',async()=>{
  const u='https://financialmodelingprep.com/api/v3/historical-price-full/'+encodeURIComponent(symbol)+'?timeseries=30&apikey='+encodeURIComponent(fmp);
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'FinPilot/8.5'},signal:AbortSignal.timeout(9000)});
  const d=await r.json();
  if(!r.ok||!Array.isArray(d.historical)||d.historical.length<2)throw new Error(d?.Error||'FMP unavailable');
  const rows=d.historical.slice().reverse().map(x=>({time:new Date(x.date+'T00:00:00Z').toISOString(),open:Number(x.open),high:Number(x.dayHigh),low:Number(x.dayLow),close:Number(x.close),volume:Number(x.volume||0)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  if(rows.length<2)throw new Error('FMP insufficient candles');
  return {rows,provider:'Financial Modeling Prep · free-tier/API key',live:false};
 });
 // Keyless Nasdaq daily history is a US-equity fallback only; always analysis-only.
 if(/^[A-Z0-9-]{1,10}$/.test(String(symbol).trim().toUpperCase()))addProvider('nasdaq-public',async()=>fetchNasdaqEod(symbol));
 const sq=process.env.STOOQ_API_KEY;
 if(sq)addProvider('stooq',async()=>{
  const stooqSymbol=String(symbol).toLowerCase();
  const u='https://stooq.com/q/d/l/?s='+encodeURIComponent(stooqSymbol)+'&i=d&apikey='+encodeURIComponent(sq);
  const r=await fetch(u,{headers:{'Accept':'text/csv','User-Agent':'FinPilot/8.4'},signal:AbortSignal.timeout(9000)});const txt=await r.text();
  if(!r.ok||/^N\/D|Exceeded|<html/i.test(txt))throw new Error('Stooq unavailable');
  const lines=txt.trim().split(/\r?\n/);if(lines.length<3)throw new Error('Stooq insufficient candles');
  const head=lines.shift().split(',').map(x=>x.trim().toLowerCase()),rows=lines.map(line=>{const v=line.split(',');const o=Object.fromEntries(head.map((k,i)=>[k,v[i]]));return {time:new Date(o.date+'T00:00:00Z').toISOString(),open:Number(o.open),high:Number(o.high),low:Number(o.low),close:Number(o.close),volume:Number(o.volume||0)}}).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  if(rows.length<2)throw new Error('Stooq insufficient candles');
  return {rows,provider:'Stooq · API key',live:false};
 });
 let last='No configured global market provider';
 for(const p of providers){try{return await trackedProvider(p.id,p.run)}catch(e){last=e?.message||last}}
 throw new Error(last);
}
const MARKET_PROVIDER_HEALTH=new Map();
function providerHealth(id,patch={}){
 const prev=MARKET_PROVIDER_HEALTH.get(id)||{id,requests:0,success:0,failures:0,lastSuccess:null,lastFailure:null,lastError:null,cooldownUntil:0};
 const next={...prev,...patch};
 MARKET_PROVIDER_HEALTH.set(id,next); return next;
}
function recordProviderResult(id,ok,error=null){
 const p=MARKET_PROVIDER_HEALTH.get(id)||{id,requests:0,success:0,failures:0,lastSuccess:null,lastFailure:null,lastError:null,cooldownUntil:0};
 const now=Date.now();
 if(ok){p.requests++;p.success++;p.lastSuccess=new Date(now).toISOString();p.lastError=null;p.cooldownUntil=0;}
 else{p.requests++;p.failures++;p.lastFailure=new Date(now).toISOString();p.lastError=String(error||'PROVIDER_FAILED').slice(0,300);
   if(/429|rate.?limit|too many/i.test(p.lastError))p.cooldownUntil=now+60000;else if(/timeout|abort|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(p.lastError))p.cooldownUntil=now+30000;
 }
 MARKET_PROVIDER_HEALTH.set(id,p);
 return p;
}
function canonicalProviderHealthId(value){
 const id=String(value||'provider').trim().toLowerCase().replace(/[-_]os$/,'');
 return id;
}
function aggregateDataHealthSources(now=Date.now()){
 const staleAfter=Number(DATA_HEALTH_STALE_AFTER_MS)||120000;
 // A fresh successful adapter must outrank a stale sibling adapter in the same provider family.
 // DEGRADED remains highest priority so active provider failures/cooldowns stay visible.
 const rank={UNKNOWN:1,STALE:2,HEALTHY:3,DEGRADED:4};
 const grouped=new Map();
 for(const [name,raw] of Object.entries(DATA_HEALTH.sources||{})){
  const id=canonicalProviderHealthId(name);
  const parsed=raw.lastSuccess?Date.parse(raw.lastSuccess):NaN;
  const lastSuccessAgeMs=Number.isFinite(parsed)?Math.max(0,now-parsed):null;
  let status=String(raw.status||'UNKNOWN').toUpperCase();
  if(status==='HEALTHY'&&lastSuccessAgeMs!==null&&lastSuccessAgeMs>staleAfter)status='STALE';
  if(!['HEALTHY','DEGRADED','STALE','UNKNOWN'].includes(status))status='UNKNOWN';
  const existing=grouped.get(id)||{id,status,adapterNames:[],lastSuccess:null,lastSuccessAgeMs:null,lastError:null,latencyMs:null,requests:0,success:0,failures:0};
  existing.adapterNames.push(name);
  if((rank[status]??1)>(rank[existing.status]??1))existing.status=status;
  if(Number.isFinite(parsed)&&(!existing.lastSuccess||parsed>Date.parse(existing.lastSuccess))){
   existing.lastSuccess=raw.lastSuccess;
   existing.lastSuccessAgeMs=lastSuccessAgeMs;
  }
  if(status==='DEGRADED'&&raw.lastError)existing.lastError=String(raw.lastError).slice(0,180);
  if(raw.latencyMs!==null&&raw.latencyMs!==undefined&&Number.isFinite(Number(raw.latencyMs)))existing.latencyMs=Number(raw.latencyMs);
  grouped.set(id,existing);
 }
 return [...grouped.values()].map(x=>({...x,cooldown:providerCooldownStatus(x.id,now)}));
}
function providerHealthSnapshot(){
 const now=Date.now();
 const groups=new Map(aggregateDataHealthSources(now).map(p=>[p.id,{...p}]));
 for(const p of MARKET_PROVIDER_HEALTH.values()){
  const id=canonicalProviderHealthId(p.id);
  const existing=groups.get(id)||{id,status:p.lastError?'DEGRADED':p.lastSuccess?'HEALTHY':'UNKNOWN',adapterNames:[],lastSuccess:null,lastSuccessAgeMs:null,lastError:null,latencyMs:null,requests:0,success:0,failures:0,cooldown:null};
  if(!existing.adapterNames.includes(p.id))existing.adapterNames.push(p.id);
  existing.requests+=Number(p.requests)||0;
  existing.success+=Number(p.success)||0;
  existing.failures+=Number(p.failures)||0;
  if(p.lastSuccess&&(!existing.lastSuccess||Date.parse(p.lastSuccess)>Date.parse(existing.lastSuccess))){
   existing.lastSuccess=p.lastSuccess;
   existing.lastSuccessAgeMs=Math.max(0,now-Date.parse(p.lastSuccess));
  }
  if(p.lastError&&existing.status!=='HEALTHY')existing.lastError=String(p.lastError).slice(0,180);
  existing.providerCooldownUntil=Math.max(Number(existing.providerCooldownUntil)||0,Number(p.cooldownUntil)||0);
  existing.successRate=existing.requests?Math.round(existing.success/existing.requests*100):null;
  groups.set(id,existing);
 }
 return [...groups.values()].map(p=>{
  const moduleCooldown=providerCooldownStatus(p.id,now);
  const moduleCooldownMs=Math.max(0,Number(moduleCooldown?.retryAfterMs)||0);
  const registryCooldownMs=Math.max(0,Number(p.providerCooldownUntil||0)-now);
  const cooldownMs=Math.max(moduleCooldownMs,registryCooldownMs);
  return {
   ...p,
   adapterNames:[...new Set(p.adapterNames)].sort(),
   cooldownActive:cooldownMs>0,
   cooldownMs,
   cooldown:moduleCooldown,
   successRate:p.successRate??(p.requests?Math.round(p.success/p.requests*100):null)
  };
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
async function marketProvenanceRoute(req,res,u){
 try{if(!(await ensureMarketProvenanceSchema()))return send(res,200,{ok:true,cloud:false,items:[]});
 const symbol=String(u.searchParams.get('symbol')||'').trim(),limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||25)));
 const r=symbol?await MARKET_POOL.query('SELECT symbol,provider,price,live,freshness,observed_at AS "observedAt",metadata FROM market_data_provenance WHERE symbol=$1 ORDER BY observed_at DESC LIMIT $2',[symbol,limit]):await MARKET_POOL.query('SELECT symbol,provider,price,live,freshness,observed_at AS "observedAt",metadata FROM market_data_provenance ORDER BY observed_at DESC LIMIT $1',[limit]);
 return send(res,200,{ok:true,cloud:true,items:r.rows});}catch(e){return send(res,200,{ok:false,error:e.message,items:[]})}
}
function marketProvenance(symbol,provider,live,freshness='unknown'){
 return {symbol,provider,live:Boolean(live),freshness,observedAt:new Date().toISOString(),provenance:'FinPilot market-data mesh'};
}
async function trackedProvider(id,fn){
 const p=MARKET_PROVIDER_HEALTH.get(id);
 if(p?.cooldownUntil>Date.now())throw new Error(id.toUpperCase()+'_COOLDOWN');
 try{const out=await fn();recordProviderResult(id,true);return out;}
 catch(e){recordProviderResult(id,false,e?.message);throw e;}
}

function globalProviderStatus(){
 return {providers:[
  {id:'yahoo',configured:true,role:'primary/fallback',coverage:'Yahoo-listed global symbols and world indices',mode:'unofficial'},
  {id:'nse',configured:true,role:'exchange fallback',coverage:'NIFTY/BANKNIFTY/FINNIFTY/SENSEX',mode:'exchange page'},
  {id:'twelvedata',configured:Boolean(process.env.TWELVEDATA_API_KEY),role:'global daily OHLCV fallback',coverage:'International equities/ETFs',mode:'licensed API key'},
  {id:'finnhub',configured:Boolean(process.env.FINNHUB_API_KEY),role:'global daily OHLCV fallback',coverage:'International equities',mode:'licensed API key'},
  {id:'alphavantage',configured:Boolean(process.env.ALPHAVANTAGE_API_KEY),role:'global daily OHLCV fallback',coverage:'International equities',mode:'API key'},
  {id:'nasdaq-public',configured:true,role:'no-key US equity EOD fallback',coverage:'US-listed equities available through Nasdaq historical endpoint',mode:'public EOD · analysis only'},
  {id:'stooq',configured:Boolean(process.env.STOOQ_API_KEY),role:'EOD fallback',coverage:'Global securities subject to provider coverage',mode:'API key'},
  {id:'marketstack',configured:Boolean(process.env.MARKETSTACK_API_KEY),role:'global EOD fallback',coverage:'Worldwide exchange/ticker metadata and EOD data',mode:'free tier/API key'},
  {id:'fmp',configured:Boolean(process.env.FMP_API_KEY||process.env.FINANCIAL_MODELING_PREP_API_KEY),role:'US/global fallback',coverage:'Market data plus fundamentals where plan permits',mode:'free tier/API key'}
 ],policy:'Only configured providers are queried. Missing providers are reported, never simulated.'};
}

async function fetchYahooChart(symbol,range='5d',interval='1h'){
 const key=`${symbol}|${range}|${interval}`;
 const cached=EQUITY_MARKET_CACHE.get(key);
 if(cached?.result&&Date.now()-cached.at<MARKET_CACHE_MS)return cached.result;
 const blockedUntil=Math.max(YAHOO_COOLDOWN.get(symbol)||0,0);
 if(Date.now()<blockedUntil)throw new Error('YAHOO_RATE_LIMIT_COOLDOWN');
 const inflight=YAHOO_INFLIGHT.get(key);
 if(inflight)return inflight;
 const job=(async()=>{
  const hosts=['query1.finance.yahoo.com','query2.finance.yahoo.com'];
  let last='provider unavailable';
  for(const host of hosts){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
   try{
    const url=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const r=await fetch(url,{headers:{'User-Agent':'FinPilot/8.5 market-data-adapter','Accept':'application/json'},signal:controller.signal});
    if(!r.ok){
     last=`HTTP ${r.status}`;
     if(r.status===429){
      YAHOO_COOLDOWN.set(symbol,Date.now()+YAHOO_COOLDOWN_MS);
      break;
     }
     continue;
    }
    const payload=await r.json(),result=payload?.chart?.result?.[0];
    if(result?.timestamp?.length){
      EQUITY_MARKET_CACHE.set(key,{at:Date.now(),result});
      return result;
    }
    last='empty chart result';
   }catch(e){last=e?.name==='AbortError'?'timeout':String(e?.message||e)}
   finally{clearTimeout(timer)}
  }
  throw new Error(last);
 })();
 YAHOO_INFLIGHT.set(key,job);
 try{return await job}finally{YAHOO_INFLIGHT.delete(key)}
}
async function fetchYahooWorldIndexPage(){
 const cached=EQUITY_MARKET_CACHE.get('WORLD_INDEX_PAGE');
 if(cached?.result&&Date.now()-cached.at<MARKET_CACHE_MS)return cached.result;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const r=await fetch('https://finance.yahoo.com/markets/world-indices/',{headers:{'Accept':'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'},signal:controller.signal});
  if(!r.ok)throw new Error('Yahoo world indices HTTP '+r.status);
  const html=await r.text(),out=new Map();
  const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
  for(const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi)||[]){
   const cells=[...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>clean(m[1]));
   if(cells.length>=3&&/^\^?[A-Z0-9][A-Z0-9_.=-]*$/.test(cells[0])){const priceCell=cells.slice(2).find(v=>/^-?\d[\d,]*(?:\.\d+)?/.test(v));const m=priceCell?.match(/^-?[\d,]+(?:\.\d+)?/);const price=m?Number(m[0].replace(/,/g,'')):NaN;if(Number.isFinite(price)&&price>0)out.set(cells[0],{symbol:cells[0],name:cells[1],price,changePct:0,live:false,provider:'Yahoo Finance World Indices page · delayed/unofficial',asOf:new Date().toISOString(),dataFreshness:'world-indices page / may be delayed'});}
  }
  if(!out.size)throw new Error('Yahoo world indices table unavailable');
  EQUITY_MARKET_CACHE.set('WORLD_INDEX_PAGE',{at:Date.now(),result:out});return out;
 }finally{clearTimeout(timer)}
}
async function fetchYahooPageQuote(symbol){
 const cached=EQUITY_MARKET_CACHE.get('PAGE:'+symbol);
 if(cached?.result&&Date.now()-cached.at<MARKET_CACHE_MS)return cached.result;
 if(Date.now()<(YAHOO_COOLDOWN.get(symbol)||0))throw new Error('YAHOO_RATE_LIMIT_COOLDOWN');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
 try{
  const url='https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/?p='+encodeURIComponent(symbol);
  const r=await fetch(url,{headers:{'Accept':'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'},signal:controller.signal});
  if(!r.ok)throw new Error('Yahoo page HTTP '+r.status);
  const html=await r.text();
  const esc=String(symbol).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const field=(name)=>{
   const p1=new RegExp('<fin-streamer[^>]*data-symbol=[\\\"\\\']'+esc+'[\\\"\\\'][^>]*data-field=[\\\"\\\']'+name+'[\\\"\\\'][^>]*data-value=[\\\"\\\'](-?[0-9.]+)','i');
   const p2=new RegExp('<fin-streamer[^>]*data-field=[\\\"\\\']'+name+'[\\\"\\\'][^>]*data-symbol=[\\\"\\\']'+esc+'[\\\"\\\'][^>]*data-value=[\\\"\\\'](-?[0-9.]+)','i');
   const m=(html.match(p1)||html.match(p2));return m?Number(m[1]):null;
  };
  const price=field('regularMarketPrice');
  if(!Number.isFinite(price))throw new Error('Yahoo page symbol-specific price unavailable');
  const previous=field('regularMarketPreviousClose'),changePct=field('regularMarketChangePercent'),dayHigh=field('regularMarketDayHigh'),dayLow=field('regularMarketDayLow');
  const result={ticker:symbol,symbol,market:'GLOBAL_MARKET',exchange:'Yahoo Finance',name:symbol,price,previous:Number.isFinite(previous)?previous:price,changePct:Number.isFinite(changePct)?changePct:0,dayHigh:Number.isFinite(dayHigh)?dayHigh:price,dayLow:Number.isFinite(dayLow)?dayLow:price,live:false,provider:'Yahoo Finance web quote fallback · delayed/unofficial',asOf:new Date().toISOString(),dataFreshness:'web quote / may be delayed',dataDisclaimer:'Fallback web quote; verify exchange or broker quote before acting.'};
  EQUITY_MARKET_CACHE.set('PAGE:'+symbol,{at:Date.now(),result});return result;
 }finally{clearTimeout(timer)}
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
function rememberYahooLastGood(symbol,result){
 if(!result||!Number.isFinite(Number(result.price)))return;
 YAHOO_LAST_GOOD.set(symbol,{at:Date.now(),result:Object.freeze({...result})});
}
function staleYahooLastGood(symbol){
 const x=YAHOO_LAST_GOOD.get(symbol);
 if(!x||Date.now()-x.at>120000)return null;
 return {...x.result,live:false,executionEligible:false,stale:true,fromStaleCache:true,cacheAgeMs:Date.now()-x.at,dataFreshness:'STALE_CACHE',dataDisclaimer:'Stale cache used only for continuity; paper execution is blocked until a fresh provider quote returns.'};
}
async function liveEquity(ticker){
 const clean=String(ticker||'').trim().toUpperCase().replace(/\\.NS$/,'');
 const symbol=await resolveYahooSymbol(clean); if(!symbol)throw new Error('Unsupported or unresolved global equity/index symbol.');
 const started=Date.now();
 if(INDIA_INDICES[clean]){
  const cached=EQUITY_MARKET_CACHE.get('NSEINDEX:'+clean);
  if(cached?.result&&Date.now()-cached.at<MARKET_CACHE_MS)return {...cached.result,fromCache:true};
  try{
   const index=await fetchNseIndex(clean);
   EQUITY_MARKET_CACHE.set('NSEINDEX:'+clean,{at:Date.now(),result:index});
   return index;
  }catch(indexErr){
   try{
    const world=await fetchYahooWorldIndexPage(),row=world.get(symbol);
    if(row){
     const result={ticker:clean,symbol,market:'INDIA_INDEX',exchange:'Yahoo Finance',name:row.name,currency:'INR',price:row.price,previous:row.price,changePct:row.changePct,dayHigh:row.price,dayLow:row.price,live:false,provider:row.provider,asOf:row.asOf,dataFreshness:row.dataFreshness,dataDisclaimer:'World index page fallback may be delayed; verify the exchange or broker quote before acting.'};
     EQUITY_MARKET_CACHE.set('NSEINDEX:'+clean,{at:Date.now(),result});return result;
    }
   }catch{}
   try{
    const result=await fetchYahooChart(symbol,'1d','5m');
    const meta=result.meta||{},q=result.indicators?.quote?.[0]||{},closes=(q.close||[]).map(Number).filter(Number.isFinite);
    const price=Number(meta.regularMarketPrice??closes.at(-1)); if(!Number.isFinite(price))throw new Error('Index price unavailable');
    const prev=Number(meta.chartPreviousClose??meta.previousClose??closes.at(-2)??price);
    const row={ticker:clean,symbol,market:'INDIA_INDEX',exchange:'NSE',name:clean==='NIFTY'?'Nifty 50':clean==='BANKNIFTY'?'Nifty Bank':clean==='FINNIFTY'?'Nifty Financial Services':'BSE Sensex',currency:'INR',price,previous:prev,changePct:prev?((price-prev)/prev)*100:0,live:true,provider:'Yahoo Finance chart adapter · index fallback',asOf:new Date().toISOString(),dataDisclaimer:'Recent/delayed index data; verify broker/exchange quote before acting.'};
    EQUITY_MARKET_CACHE.set('NSEINDEX:'+clean,{at:Date.now(),result:row}); return row;
   }catch(yErr){throw new Error(`Index data unavailable: NSE=${indexErr.message}; Yahoo=${yErr.message}`)}
  }
 }
 if(!INDIA_INDICES[clean]&&GLOBAL_INDEXES.some(x=>x.symbol===symbol)){
  const candidates=[symbol,...(GLOBAL_INDEX_FALLBACKS[symbol]||[])];
  for(const candidate of candidates){
   try{
    const world=await fetchYahooWorldIndexPage(),row=world.get(candidate);
    if(row){
     const result={ticker:clean,symbol: candidate,market:'GLOBAL_INDEX',exchange:'Yahoo Finance',name:row.name,currency:'',price:row.price,previous:row.price,changePct:row.changePct,dayHigh:row.price,dayLow:row.price,live:false,provider:row.provider,asOf:row.asOf,dataFreshness:row.dataFreshness,dataDisclaimer:'World index page data may be delayed; verify the exchange or licensed market-data feed before acting.'};
     EQUITY_MARKET_CACHE.set(symbol,{at:Date.now(),result});return result;
    }
   }catch{}
   try{
    const page=await fetchYahooPageQuote(candidate);
    const isProxy=candidate==='1306.T'&&symbol==='^TOPX';
    const result={...page,ticker:clean,symbol:candidate,market:'GLOBAL_INDEX',live:false,proxy:isProxy,provider:isProxy?'Yahoo Finance TOPIX ETF proxy · delayed/unofficial':page.provider,dataDisclaimer:isProxy?'TOPIX index proxy using NEXT FUNDS TOPIX ETF (1306.T); not the index itself. Verify the official JPX index before acting.':'Yahoo Finance index quote fallback; verify the exchange or licensed market-data feed before acting.'};
    EQUITY_MARKET_CACHE.set(symbol,{at:Date.now(),result});return result;
   }catch{}
  }
 }
 let result,sourceRange='5d/1h';
 try{result=await fetchYahooChart(symbol,'5d','1h')}
 catch(e){
  try{result=await fetchYahooChart(symbol,'1mo','1d');sourceRange='1mo/1d'}
  catch(e2){
   try{return await fetchYahooPageQuote(symbol)}
   catch(pageErr){
    try{
     const gp=await fetchGlobalProviderQuote(symbol);
     const rows=gp.rows,closes=rows.map(x=>x.close),highs=rows.map(x=>x.high),lows=rows.map(x=>x.low),vols=rows.map(x=>x.volume);
     const price=closes.at(-1),prev=closes.at(-2)??price,s20=sma(closes,20),s50=sma(closes,50),rr=rsi(closes),recentHigh=Math.max(...highs.slice(-20)),recentLow=Math.min(...lows.slice(-20)),changePct=prev?((price-prev)/prev)*100:0,momentum=s20?((price/s20)-1)*100:0,avgVol=vols.length?sma(vols,Math.min(20,vols.length)):null,volume=vols.at(-1)??null,volumeRatio=avgVol&&avgVol>0?volume/avgVol:null,score=Math.round(Math.max(0,Math.min(100,50+changePct*4+momentum*3+(rr>55?8:rr<45?-8:0)+(volumeRatio&&volumeRatio>1.25?8:0))));
     const direction=price>s20&&price>s50&&rr>=50?'BULLISH':price<s20&&price<s50&&rr<50?'BEARISH':'MIXED',riskScore=Math.min(100,Math.max(10,Math.round(45+(rr>70?18:rr<40?8:0)+(price<s50?15:0)+(volumeRatio&&volumeRatio>1.8?5:0)+(Math.abs(momentum)>6?5:0))));
     return {ticker:String(ticker).toUpperCase(),symbol,market:'GLOBAL_EQUITY',exchange:'GLOBAL',name:symbol,currency:'',price,previous:prev,changePct,dayHigh:highs.at(-1),dayLow:lows.at(-1),rsi:rr,sma20:s20,sma50:s50,volume,volumeRatio,recentHigh,recentLow,momentum,score,atr:atr(rows.map(x=>[new Date(x.time).getTime(),x.open,x.high,x.low,x.close,x.volume]))||Math.max(price*.01,Math.abs(recentHigh-recentLow)/4),support:recentLow,resistance:recentHigh,direction,riskScore,candles:rows,live:false,executionEligible:false,executionEligibilityReason:gp.executionEligibilityReason||'HISTORICAL_DATA_ANALYSIS_ONLY',sourceTimestampType:gp.sourceTimestampType||'HISTORICAL_EOD',provider:gp.provider,asOf:gp.asOf||rows.at(-1)?.time||null,dataFreshness:gp.dataFreshness||'END_OF_DAY',dataDisclaimer:gp.dataDisclaimer||'Historical global equity data only; verify a live exchange or broker quote before acting.'};
    }catch(globalErr){
     const stale=staleYahooLastGood(symbol);
     if(stale)return stale;
     try{return await fetchTejEod(clean)}
     catch(e3){throw new Error(`Equity chart unavailable: Yahoo=${e2.message}; YahooPage=${pageErr.message}; GlobalProviders=${globalErr.message}; TejHQ=${e3.message}`)}
    }
   }
  }
 }
 const meta=result.meta||{},q=result.indicators?.quote?.[0]||{};
 const candles=(result.timestamp||[]).map((ts,i)=>{
  const time=Number.isFinite(Number(ts))?new Date(Number(ts)*1000).toISOString():null;
  return {time,open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),close:Number(q.close?.[i]),volume:Number.isFinite(Number(q.volume?.[i]))?Number(q.volume[i]):0};
 }).filter(x=>x.time&&[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)&&x.high>=Math.max(x.open,x.close,x.low)&&x.low<=Math.min(x.open,x.close,x.high))
  .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 if(candles.length<2)throw new Error('Equity provider returned insufficient valid OHLC candles.');
 const closes=candles.map(x=>x.close),highs=candles.map(x=>x.high),lows=candles.map(x=>x.low),vols=candles.map(x=>x.volume);
 const positiveValue=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
 const price=positiveValue(meta.regularMarketPrice,closes.at(-1)); if(!(price>0))throw new Error('Equity price unavailable.');
 const prev=positiveValue(meta.chartPreviousClose,positiveValue(meta.previousClose,closes.at(-2)??price));
 const changePct=prev?((price-prev)/prev)*100:0, s20=sma(closes,20),s50=sma(closes,50);
 const avgVol=vols.length?sma(vols,Math.min(20,vols.length)):null,volume=vols.at(-1)??null,volumeRatio=avgVol&&avgVol>0?volume/avgVol:null;
 const rr=rsi(closes), recentHigh=Math.max(...highs.slice(-24)),recentLow=Math.min(...lows.slice(-24));
 const momentum=(Number.isFinite(s20)&&s20?((price/s20)-1)*100:0);
 const score=Math.round(Math.max(0,Math.min(100,50+changePct*4+momentum*3+(rr>55?8:rr<45?-8:0)+(volumeRatio&&volumeRatio>1.25?8:0))));
 const atrV=atr(candles.map(x=>[new Date(x.time).getTime(),x.open,x.high,x.low,x.close,x.volume]))||Math.max(price*0.01,Math.abs(recentHigh-recentLow)/4);
 const direction=price>s20&&price>s50&&rr>=50?'BULLISH':price<s20&&price<s50&&rr<50?'BEARISH':'MIXED';
 const riskScore=Math.min(100,Math.max(10,Math.round(45+(rr>70?18:rr<40?8:0)+(price<s50?15:0)+(volumeRatio&&volumeRatio>1.8?5:0)+(Math.abs(momentum)>6?5:0))));
 const support=recentLow,resistance=recentHigh;
 const isIndiaSymbol=/\.(NS|BO)$/i.test(String(symbol||'')); const market=isIndiaSymbol?'INDIA_EQUITY':'GLOBAL_EQUITY'; const listingExchange=String(meta.exchangeName||meta.fullExchangeName||'GLOBAL'); const exchange=isIndiaSymbol?'NSE/BSE':listingExchange; const currency=isIndiaSymbol?'INR':String(meta.currency||'USD').toUpperCase();
 const hasProviderTimestamp=Number(meta.regularMarketTime)>0;
 const sourceEpoch=hasProviderTimestamp?Number(meta.regularMarketTime)*1000:(candles.at(-1)?.time?Date.parse(candles.at(-1).time):Date.now());
 const sourceAgeMs=Math.max(0,Date.now()-sourceEpoch);
 const sourceTimestampType=hasProviderTimestamp?'PROVIDER_TIMESTAMP':'CANDLE_TIMESTAMP';
 const liveFresh=hasProviderTimestamp&&sourceAgeMs<=EXECUTION_FRESHNESS_MS&&sourceRange==='5d/1h';
 const report={ticker:String(ticker).toUpperCase().replace(/\\.(NS|BO)$/i,''),symbol,market,exchange,name:String(meta.longName||meta.shortName||ticker),currency,price,previous:prev,changePct,dayHigh:positiveValue(meta.regularMarketDayHigh,Math.max(...highs.slice(-24))),dayLow:positiveValue(meta.regularMarketDayLow,Math.min(...lows.slice(-24))),rsi:rr,sma20:s20,sma50:s50,volume,volumeRatio,recentHigh,recentLow,momentum,score,atr:atrV,support,resistance,direction,riskScore,candles,live:liveFresh,executionEligible:false,executionEligibilityReason:'UNOFFICIAL_YAHOO_SOURCE_ANALYSIS_ONLY',sourceAgeMs,sourceTimestampType,provider:`Yahoo Finance chart adapter · ${sourceRange} (unofficial; recent/delayed data may apply)`,providerLatencyMs:Date.now()-started,listingExchange,asOf:new Date(sourceEpoch).toISOString(),dataFreshness:liveFresh?'FRESH_SOURCE':'STALE_SOURCE',dataDisclaimer:'Recent/unofficial market data for analysis only; verify the broker/exchange quote before acting.'};
 rememberYahooLastGood(symbol,report);
 return report;
}
async function marketPicks(req,res,u){
 const limit=Math.min(10,Math.max(3,Number(u.searchParams.get('limit')||5)));
 const rawTickers=(u.searchParams.get('tickers')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
 const normalizedMarket=normalizeMarketPicksMarket(u.searchParams.get('market')||'',rawTickers.length>0);
 if(!normalizedMarket.ok)return send(res,400,{ok:false,error:normalizedMarket.error,supported:normalizedMarket.supported});
 const requested=[...new Set(rawTickers)];
 const universe=resolveMarketPicksUniverse({
  market:normalizedMarket.market,
  requestedTickers:requested,
  indiaTickers:Object.keys(INDIA_EQUITIES),
  globalStockTestSet:GLOBAL_STOCK_TEST_SET
 });
 if(!universe.length)return send(res,400,{ok:false,error:'NO_MARKET_PICK_UNIVERSE',market:normalizedMarket.market});
 const rows=await Promise.all(universe.map(async t=>{try{return await liveEquity(t)}catch(e){return null}}));
 const usTickers=GLOBAL_STOCK_TEST_SET.filter(row=>String(row?.[0]||'').toUpperCase()==='UNITED STATES').map(row=>String(row?.[1]||'').toUpperCase());
 const result=buildMarketPicksEnvelope(rows,{market:normalizedMarket.market,limit,nowMs:Date.now(),maxAgeMs:EXECUTION_FRESHNESS_MS,usTickers});
 return send(res,200,{...result,
  method:'Recent/delayed equity scan ranked by price change, momentum, RSI and relative volume; stale or unofficial data remains ineligible for paper execution.',
  provider:result.provider,
  dataQualityWarnings:result.staleOrUnverifiedCount?['One or more candidates lack a fresh provider-timestamped quote. Verify source time before acting.']:[]
 });
}

async function marketDataOS(req,res,u){
 const raw=(u.searchParams.get('ticker')||'BTC').trim().toUpperCase();
 const interval=u.searchParams.get('interval')||'1h';
 const started=Date.now();
 const attempts=[];
 const quotes=[];
 const addAttempt=async(name,fn)=>{
  const t=Date.now();
  try{
   const x=await fn();
   const price=Number(x?.price);
   const ok=Number.isFinite(price)&&price>0;
   const observedAt=x?.observedAt||x?._finpilotCache?.observedAt||new Date().toISOString();
   const sourceTimestamp=x?.asOf||null;
   const timestampType=x?.timestampType||(sourceTimestamp?'PROVIDER_TIMESTAMP':'OBSERVATION_TIMESTAMP');
   const timestampMs=sourceTimestamp?Date.parse(sourceTimestamp):NaN;
   const sourceAgeMs=Number.isFinite(timestampMs)&&timestampMs<=Date.now()+5000?Math.max(0,Date.now()-timestampMs):null;
   const staleProviderTimestamp=ok&&timestampType==='PROVIDER_TIMESTAMP'&&(sourceAgeMs===null||sourceAgeMs>EXECUTION_FRESHNESS_MS);
   const includedInVerification=ok&&!staleProviderTimestamp;
   attempts.push({provider:name,ok,latencyMs:Date.now()-t,error:ok?null:'INVALID_PRICE',live:x?.live!==false,asOf:sourceTimestamp,timestampType,sourceAgeMs,includedInVerification,excludedReason:staleProviderTimestamp?'STALE_PROVIDER_TIMESTAMP':null});
   if(includedInVerification)quotes.push({...x,provider:name,observedAt,asOf:sourceTimestamp,timestampType,latencyMs:Date.now()-t});
   return includedInVerification;
  }catch(e){attempts.push({provider:name,ok:false,latencyMs:Date.now()-t,error:String(e?.message||e)});return false;}
 };
 if(CRYPTO_ASSETS[raw]){
  const symbol=CRYPTO_ASSETS[raw];
  const providerSymbols=cryptoProviderSymbols(raw,symbol);
  if(!providerSymbols)return send(res,400,{ok:false,error:'CRYPTO_PAIR_UNSUPPORTED',ticker:raw});
  await addAttempt('Binance public',async()=>{const x=await directProviderJson('https://api.binance.com/api/v3/ticker/24hr?symbol='+symbol,'binance-os');const asOf=Number(x.closeTime)>0?new Date(Number(x.closeTime)).toISOString():x?._finpilotCache?.observedAt||null;return {price:Number(x.lastPrice),changePct:Number(x.priceChangePercent),volume:Number(x.volume),high:Number(x.highPrice),low:Number(x.lowPrice),asOf,timestampType:Number(x.closeTime)>0?'PROVIDER_TIMESTAMP':'OBSERVATION_TIMESTAMP',live:true};});
  await addAttempt('Kraken public',async()=>{const pair=providerSymbols.krakenPair;const x=await directProviderJson('https://api.kraken.com/0/public/Ticker?pair='+encodeURIComponent(pair),'kraken-os');const v=Object.values(x?.result||{})[0];return {price:Number(v?.c?.[0]),changePct:Number(v?.p?.[1])&&Number(v?.p?.[1])?((Number(v.c[0])-Number(v.o||v.c[0]))/Number(v.o||v.c[0]))*100:0,volume:Number(v?.v?.[1]||0),high:Number(v?.h?.[1]||v?.c?.[0]),low:Number(v?.l?.[1]||v?.c?.[0]),asOf:x?._finpilotCache?.observedAt||null,timestampType:'OBSERVATION_TIMESTAMP',live:true};});
  await addAttempt('Gate.io public',async()=>{
  const pair=providerSymbols.base+'_'+providerSymbols.quote;
  const endpoint='https://api.gateio.ws/api/v4/spot/trades?currency_pair='+encodeURIComponent(pair)+'&limit=1';
  const rows=await directProviderJson(endpoint,'gateio-os');
  const trade=Array.isArray(rows)?rows[0]:null;
  const tradePair=String(trade?.currency_pair||'').toUpperCase();
  const tradePrice=Number(trade?.price);
  const tradeTimeMs=Number(trade?.create_time_ms);
  const tradeTimeSec=Number(trade?.create_time);
  const tradeTime=tradeTimeMs>0?new Date(tradeTimeMs).toISOString():tradeTimeSec>0?new Date(tradeTimeSec*1000).toISOString():null;
  const valid=tradePair===pair&&Number.isFinite(tradePrice)&&tradePrice>0&&tradeTime&&Number.isFinite(Date.parse(tradeTime))&&Date.parse(tradeTime)<=Date.now()+5000;
  if(!valid)throw new Error('GATE_TRADE_INVALID_OR_PAIR_MISMATCH');
  return {price:tradePrice,changePct:0,volume:null,high:null,low:null,asOf:tradeTime,timestampType:'PROVIDER_TIMESTAMP',live:true};
 });
  await addAttempt('Coinbase public',async()=>{
  const url='https://api.exchange.coinbase.com/products/'+providerSymbols.coinbaseProduct;
  const [stats,trades]=await Promise.all([
   directProviderJson(url+'/stats','coinbase-os'),
   directProviderJson(url+'/trades?limit=1','coinbase-os')
  ]);
  const trade=Array.isArray(trades)?trades[0]:null;
  const tradeTime=String(trade?.time||'');
  const tradePrice=Number(trade?.price);
  const providerTradeValid=Number.isFinite(tradePrice)&&tradePrice>0&&Number.isFinite(Date.parse(tradeTime))&&Date.parse(tradeTime)<=Date.now()+5000;
  const price=providerTradeValid?tradePrice:Number(stats?.last);
  return {price,changePct:Number(stats?.open)>0&&Number.isFinite(price)?((price-Number(stats.open))/Number(stats.open))*100:0,volume:Number(stats?.volume||0),high:Number(stats?.high||price),low:Number(stats?.low||price),asOf:providerTradeValid?tradeTime:stats?._finpilotCache?.observedAt||null,timestampType:providerTradeValid?'PROVIDER_TIMESTAMP':'OBSERVATION_TIMESTAMP',live:true};
 });
 }else{
  const quoteCountBeforePrimary=quotes.length;
  const liveQuoteOk=await addAttempt('FinPilot equity provider',async()=>{const r=await liveEquity(raw);return {price:Number(r.price),changePct:Number(r.changePct||0),volume:Number(r.volume||0),high:Number(r.dayHigh||0),low:Number(r.dayLow||0),asOf:r.asOf,timestampType:r.sourceTimestampType||'UNKNOWN_TIMESTAMP',live:Boolean(r.live),executionEligible:r.executionEligible!==false,executionEligibilityReason:r.executionEligibilityReason||null,exchange:r.exchange};});
  const primary=quotes[quoteCountBeforePrimary]||null;
  const primaryTs=primary?.asOf?Date.parse(primary.asOf):NaN;
  const primaryAgeMs=Number.isFinite(primaryTs)&&primaryTs<=Date.now()+5000?Math.max(0,Date.now()-primaryTs):null;
  const primaryStale=!liveQuoteOk||!primary||primary.live===false
   ||['HISTORICAL_EOD','HISTORICAL_DATE_ONLY','HISTORICAL_SNAPSHOT'].includes(primary.timestampType)
   ||primaryAgeMs===null||primaryAgeMs>EXECUTION_FRESHNESS_MS;
  if(primaryStale){
   // Keep the failed/stale attempt in diagnostics, but use the EOD quote only as non-live analysis context.
   if(primary)quotes.splice(quoteCountBeforePrimary);
   await addAttempt('TejHQ public EOD',async()=>{
    const r=await fetchTejHqEod(raw,{allowedSymbols:Object.keys(INDIA_EQUITIES)});
    return {price:r.price,changePct:r.changePct,volume:r.volume,high:r.dayHigh,low:r.dayLow,asOf:r.asOf,timestampType:r.sourceTimestampType,live:false,exchange:r.exchange,dataFreshness:r.dataFreshness};
   });
  }
 }
 if(!quotes.length){
  return send(res,200,{ok:true,available:false,verified:false,ticker:raw,marketDataOS:{status:'UNAVAILABLE',decision:'DO_NOT_TRADE',reason:'No provider returned a verified price.',attempts},elapsedMs:Date.now()-started});
 }
 const prices=quotes.map(x=>x.price);
 const min=Math.min(...prices),max=Math.max(...prices),median=[...prices].sort((a,b)=>a-b)[Math.floor(prices.length/2)];
 const spreadPct=median?((max-min)/median)*100:100;
 const enoughProviders=quotes.length>=2;
 const priceAgreement=enoughProviders&&spreadPct<=0.75;
 const now=Date.now();
 const timestampState=quotes.map(x=>{
  const sourceValue=x.asOf||x.observedAt||null;
  const ts=sourceValue?Date.parse(sourceValue):NaN;
  const valid=Number.isFinite(ts)&&ts<=now+5000;
  const ageMs=valid?Math.max(0,now-ts):null;
  return {provider:x.provider,timestampType:x.timestampType||'UNKNOWN_TIMESTAMP',valid,ageMs,fresh:valid&&ageMs<=EXECUTION_FRESHNESS_MS};
 });
 // Prefer the configured primary that has a fresh provider-sourced timestamp.
 // Observation-only fallbacks remain available for analysis, but cannot outrank a timestamped quote.
 const winner=selectPrimaryMarketQuote(quotes,timestampState)||quotes.slice().sort((a,b)=>a.latencyMs-b.latencyMs)[0];
 const winnerIndex=quotes.indexOf(winner);
 const primaryTimestampValid=winner.timestampType==='PROVIDER_TIMESTAMP'&&timestampState[winnerIndex]?.valid;
 const timestampsFresh=timestampState.every(x=>x.fresh);
 const sourceReady=Boolean(winner.live!==false&&winner.executionEligible!==false&&primaryTimestampValid&&timestampState[winnerIndex]?.fresh&&timestampsFresh&&quotes.every(x=>x.live!==false&&x.executionEligible!==false));
 const verified=Boolean(priceAgreement&&sourceReady);
 const status=verified?'VERIFIED':!enoughProviders?'INSUFFICIENT_SOURCES':!priceAgreement?'CONFLICTING':winner.executionEligible===false?'UNTRUSTED_SOURCE':!primaryTimestampValid?'UNVERIFIED_TIMESTAMP':!timestampsFresh?'STALE_SOURCE':winner.live===false?'NON_LIVE_SOURCE':'UNVERIFIED_SOURCE';
 const selectedAsOf=winner.asOf||(winner.timestampType==='OBSERVATION_TIMESTAMP'?winner.observedAt:null);
 const selectedTimestampType=winner.timestampType||'UNKNOWN_TIMESTAMP';
 const sourceAgeMs=selectedAsOf&&Number.isFinite(Date.parse(selectedAsOf))?Math.max(0,Date.now()-Date.parse(selectedAsOf)):null;
 const executionReady=Boolean(verified&&winner.live!==false&&sourceAgeMs!==null&&sourceAgeMs<=EXECUTION_FRESHNESS_MS&&selectedTimestampType==='PROVIDER_TIMESTAMP');
 const verificationReasons=[];
 if(!enoughProviders)verificationReasons.push('INSUFFICIENT_PROVIDER_CROSS_CHECK');
 if(enoughProviders&&!priceAgreement)verificationReasons.push('PROVIDER_PRICE_SPREAD_EXCEEDS_0_75_PERCENT');
 if(!primaryTimestampValid)verificationReasons.push('SELECTED_PRIMARY_SOURCE_LACKS_PROVIDER_TIMESTAMP');
 if(!timestampsFresh)verificationReasons.push('ONE_OR_MORE_PROVIDER_OBSERVATIONS_ARE_STALE_OR_INVALID');
 if(quotes.some(x=>x.live===false))verificationReasons.push('ONE_OR_MORE_PROVIDERS_MARKED_NON_LIVE');
 if(quotes.some(x=>x.executionEligible===false))verificationReasons.push('UNOFFICIAL_PROVIDER_ANALYSIS_ONLY');
 if(executionReady)verificationReasons.push('PRIMARY_PROVIDER_TIMESTAMP_AND_PRICE_CROSS_CHECK_PASSED');
 const result={ok:true,available:true,verified:executionReady,executionEligible:executionReady,executionDecision:executionReady?'ALLOW_PAPER_ONLY':'HOLD_FOR_VERIFICATION',ticker:raw,price:winner.price,changePct:winner.changePct,volume:winner.volume,high:winner.high,low:winner.low,provider:winner.provider,asOf:selectedAsOf,sourceTimestampType:selectedTimestampType,sourceAgeMs,dataFreshness:sourceAgeMs===null?'UNKNOWN':sourceAgeMs>EXECUTION_FRESHNESS_MS?'STALE_SOURCE':selectedTimestampType==='PROVIDER_TIMESTAMP'?'FRESH_PROVIDER_TIMESTAMP':'FRESH_OBSERVATION_ONLY',marketDataOS:{status:executionReady?'VERIFIED':status,decision:executionReady?'ALLOW_ANALYSIS_AND_PAPER':'HOLD_FOR_VERIFICATION',reason:executionReady?'All required data checks passed.':'Selected provider or cross-checks did not pass the execution data gate.',verificationReasons,primaryProvider:winner.provider,primaryProviderTimestampValid:Boolean(primaryTimestampValid&&timestampState[winnerIndex]?.fresh),priceAgreement,providerCount:quotes.length,priceSpreadPct:Number(spreadPct.toFixed(4)),sourceAgeMs,sourceTimestampType:selectedTimestampType,executionFreshnessMs:EXECUTION_FRESHNESS_MS,providers:quotes.map((x,i)=>({provider:x.provider,price:x.price,latencyMs:x.latencyMs,live:x.live!==false,asOf:x.asOf||null,observedAt:x.observedAt||null,sourceAgeMs:timestampState[i].ageMs,timestampType:x.timestampType||'UNKNOWN_TIMESTAMP',fresh:timestampState[i].fresh})),attempts,elapsedMs:Date.now()-started,rule:'Paper execution requires the selected primary source to have a fresh provider-sourced timestamp and price corroboration. Local observation time is not exchange time.'}};
 try{await archiveMarketProvenance({symbol:raw,provider:winner.provider,price:median,live:executionReady,dataFreshness:result.dataFreshness,asOf:result.asOf});}catch{}
 return send(res,200,result);
}

async function loadMarketStreamSnapshot(channelKey){
 const [raw,interval='1h']=String(channelKey).split('\u001f');
 const base='http://127.0.0.1:'+PORT+'/api/market-data-os?ticker='+encodeURIComponent(raw)+'&interval='+encodeURIComponent(interval);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch(base,{headers:{'Accept':'application/json'},signal:controller.signal});
  if(!r.ok)throw new Error('MARKET_DATA_HTTP_'+r.status);
  const d=await r.json();
  const now=Date.now();
  const verified=Boolean(d?.ok&&d?.available&&d?.verified&&Number.isFinite(Number(d?.price))&&Number(d.price)>0);
  const ageMs=d?.asOf?Math.max(0,now-Date.parse(d.asOf)):0;
  const stale=ageMs>30000;
  const payload={ticker:raw,interval,status:verified&&!stale?'LIVE':verified?'STALE':(d?.marketDataOS?.status||'UNAVAILABLE'),verified,executionEligible:Boolean(verified&&!stale&&ageMs<=EXECUTION_FRESHNESS_MS&&d?.marketDataOS?.decision==='ALLOW_ANALYSIS_AND_PAPER'),stale,price:verified?Number(d.price):null,changePct:verified?Number(d.changePct||0):null,volume:verified?Number(d.volume||0):null,high:verified?Number(d.high||0):null,low:verified?Number(d.low||0):null,provider:d?.provider||null,providerCount:Number(d?.marketDataOS?.providerCount||0),sourceTimestampType:d?.sourceTimestampType||'UNKNOWN_TIMESTAMP',asOf:d?.asOf||null,receivedAt:new Date(now).toISOString(),ageMs,sourceAgeMs:Number(d?.marketDataOS?.sourceAgeMs||ageMs),executionFreshnessMs:EXECUTION_FRESHNESS_MS};
  if(verified){
   const mid=Number(d.price),spread=Math.max(mid*0.0004,0.00000001);
   payload.orderBook={type:'SIMULATED_FROM_VERIFIED_QUOTES',bid:Number((mid-spread/2).toFixed(8)),ask:Number((mid+spread/2).toFixed(8)),spread:Number(spread.toFixed(8)),levels:4};
   payload.tick={price:mid,receivedAt:payload.receivedAt};
  }
  // Archive and route one market tick per shared poll, not once per connected browser tab.
  if(verified&&payload.status==='LIVE'){
   const tick={ticker:raw,symbol:raw,price:payload.price,changePct:payload.changePct,volume:payload.volume,high:payload.high,low:payload.low,source:payload.provider||'FinPilot market-data stream',time:payload.asOf||payload.receivedAt};
   try{payload.cloudStored=await storeMarketTick(tick)}catch{payload.cloudStored=false}
   try{emitEvent('MARKET_TICK',tick,90)}catch{}
  }else payload.cloudStored=false;
  return payload;
 }finally{clearTimeout(timeout);}
}
const MARKET_STREAM_POLL_MS=Math.max(3000,Math.min(15000,Number(process.env.FINPILOT_MARKET_STREAM_POLL_MS||5000)));
const MARKET_STREAM_HUB=createMarketStreamHub({
 loadSnapshot:loadMarketStreamSnapshot,
 pollMs:MARKET_STREAM_POLL_MS,
 heartbeatMs:15000,
 signature:value=>JSON.stringify([value.status,value.price,value.asOf,value.providerCount])
});
async function marketDataStream(req,res,u){
 const raw=(u.searchParams.get('ticker')||'BTC').trim().toUpperCase();
 const interval=u.searchParams.get('interval')||'1h';
 res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
 res.write(': finpilot-market-stream\n\n');
 let closed=false;
 const writeEvent=(event,data)=>{if(closed||res.destroyed)return;res.write('event: '+event+'\n');res.write('data: '+JSON.stringify(data)+'\n\n');};
 const listener={
  onData:data=>writeEvent('market',data),
  onError:error=>writeEvent('status',{ticker:raw,status:'UNAVAILABLE',verified:false,stale:true,error:String(error?.message||error),receivedAt:new Date().toISOString()}),
  onHeartbeat:at=>{if(!closed&&!res.destroyed)res.write(': heartbeat '+at+'\n\n');}
 };
 const unsubscribe=MARKET_STREAM_HUB.subscribe(raw+'\u001f'+interval,listener);
 const close=()=>{if(closed)return;closed=true;unsubscribe();};
 req.on('close',close);
 res.on('close',close);
}

function gateMarketReport(report,ticker,interval,capturedAt=new Date().toISOString()){
 const snapshot=buildMarketSnapshot(report||null,{requestedTicker:ticker,interval,capturedAt,maxAgeMs:EXECUTION_FRESHNESS_MS});
 const upstreamAllowed=report&&report.executionEligible!==false;
 const eligible=Boolean(upstreamAllowed&&snapshot.quality.forecastEligible);
 const reasons=[...snapshot.quality.reasons];
 const blockReason=report?.executionEligibilityReason||'UPSTREAM_EXECUTION_GATE_BLOCKED';
 if(report?.executionEligible===false)reasons.unshift(blockReason);
 const status=eligible?snapshot.quality.status:report?.executionEligibilityReason==='UNOFFICIAL_YAHOO_SOURCE_ANALYSIS_ONLY'?'UNTRUSTED_SOURCE':report?.executionEligibilityReason==='HISTORICAL_DATA_ANALYSIS_ONLY'?'END_OF_DAY_ANALYSIS_ONLY':snapshot.quality.status==='VERIFIED_LIVE'?'UPSTREAM_BLOCKED':snapshot.quality.status;
 return {...(report||{}),executionEligible:eligible,executionGate:{
  eligible,status,reasons,
  sourceTimestampType:report?.sourceTimestampType||'UNKNOWN_TIMESTAMP',
  sourceAgeMs:snapshot.timing.ageMs,maxAgeMs:snapshot.timing.maxAgeMs,checkedAt:capturedAt
 }};
}
async function marketSnapshotRoute(req,res,u){
 const ticker=String(u.searchParams.get('ticker')||'').trim().toUpperCase();
 const interval=String(u.searchParams.get('interval')||'1h');
 if(!ticker)return send(res,400,{ok:false,error:'TICKER_REQUIRED'});
 const innerUrl=new URL('http://finpilot.local/api/stock-report');
 innerUrl.searchParams.set('ticker',ticker);
 innerUrl.searchParams.set('interval',interval);
 innerUrl.searchParams.set('multi',u.searchParams.get('multi')==='0'?'0':'1');
 let statusCode=500,bodyText='';
 const capture={req,writeHead(code){statusCode=code;},end(value){bodyText=String(value||'');}};
 await stockReport(req,capture,innerUrl);
 let payload={};
 try{payload=JSON.parse(bodyText||'{}');}catch{}
 const capturedAt=new Date().toISOString();
 const gatedReport=payload?.report?gateMarketReport(payload.report,ticker,interval,capturedAt):null;
 const snapshot=buildMarketSnapshot(gatedReport||null,{requestedTicker:ticker,interval,capturedAt,maxAgeMs:EXECUTION_FRESHNESS_MS});
 const upstreamBlocked=gatedReport?.executionEligible===false;
 const gateBlockReason=gatedReport?.executionEligibilityReason||'UPSTREAM_EXECUTION_GATE_BLOCKED';
 if(upstreamBlocked){
  snapshot.quality.forecastEligible=false;
  if(gatedReport.executionEligibilityReason==='UNOFFICIAL_YAHOO_SOURCE_ANALYSIS_ONLY')snapshot.quality.status='UNTRUSTED_SOURCE';
  else if(snapshot.quality.status==='VERIFIED_LIVE')snapshot.quality.status='UPSTREAM_BLOCKED';
  snapshot.quality.reasons=[gateBlockReason,...snapshot.quality.reasons.filter(x=>x!==gateBlockReason)];
 }
 const eligible=Boolean(gatedReport?.executionEligible&&snapshot.quality.forecastEligible);
 const reasons=[...snapshot.quality.reasons];
 const report=gatedReport?{...gatedReport,executionEligible:eligible,executionGate:{...gatedReport.executionGate,eligible,status:snapshot.quality.status,reasons}}:null;
 return send(res,200,{
  ok:Boolean(payload?.ok&&report),
  report,snapshot,executionEligible:eligible,
  executionDecision:eligible?'ALLOW_PAPER_ONLY':'HOLD_FOR_VERIFICATION',
  eligibilityReasons:reasons,
  error:payload?.error||null,warning:payload?.warning||null,providerHttpStatus:statusCode
 });
}
async function stockReport(req,res,u){
 const t=(u.searchParams.get('ticker')||'').trim().toUpperCase();
 const interval=u.searchParams.get('interval')||'1h';
 const multi=u.searchParams.get('multi')!=='0';
 const cacheKey='stock:'+t+':'+interval+':'+multi;
 try{
  const hit=getCached(cacheKey);
  if(hit){
   const report=hit.report?gateMarketReport(hit.report,t,interval):null;
   return send(res,200,{...hit,report,executionEligible:Boolean(report?.executionEligible),executionGate:report?.executionGate||{eligible:false,status:'UNAVAILABLE',reasons:['NO_MARKET_REPORT']},cached:true});
  }
  if(CRYPTO_ASSETS[t]){
   const sourceReport=await liveCrypto(t,interval,multi);
   const report=gateMarketReport(sourceReport,t,interval);
   const payload={ok:true,report,executionEligible:report.executionEligible,executionGate:report.executionGate};
   if(Array.isArray(report?.candles)&&report.candles.length>1)cached(cacheKey,payload);
   return send(res,200,payload);
  }
  let liveErr=null;
  try{
   const sourceReport=await liveEquity(t);
   const report=gateMarketReport(sourceReport,t,interval);
   const quoteAge=Number(report?.executionGate?.sourceAgeMs);
   const maxAge=Number(report?.executionGate?.maxAgeMs)||EXECUTION_FRESHNESS_MS;
   const quoteStale=report?.live===false||report?.sourceTimestampType==='HISTORICAL_EOD'
     ||report?.sourceTimestampType==='HISTORICAL_DATE_ONLY'
     ||(Number.isFinite(quoteAge)&&quoteAge>maxAge);
   if(!quoteStale){
    const payload={ok:true,report,executionEligible:report.executionEligible,executionGate:report.executionGate};
    if(Array.isArray(report?.candles)&&report.candles.length>1)cached(cacheKey,payload);
    return send(res,200,payload);
   }
   if(report?.live===false&&Array.isArray(report.candles)&&report.candles.length>=2&&report.sourceTimestampType&&report.sourceTimestampType!=='UNKNOWN_TIMESTAMP'&&report.executionEligibilityReason!=='UNOFFICIAL_YAHOO_SOURCE_ANALYSIS_ONLY'&&report.executionEligibilityReason!=='NO_VERIFIED_MARKET_DATA'){
    // Keep correctly matched delayed/EOD candles visible; stale quotes remain execution-ineligible.
    const payload={ok:true,report,executionEligible:false,executionGate:report.executionGate,warning:'LIVE_EQUITY_QUOTE_UNAVAILABLE_HISTORICAL_CHART_USED',dataDisclaimer:report.dataDisclaimer};
    cached(cacheKey,payload);
    return send(res,200,payload);
   }
   liveErr=new Error('PRIMARY_EQUITY_QUOTE_STALE_OR_NON_LIVE');
  }catch(error){liveErr=error;}
  {
   try{
    const historicalReport=await fetchTejHqEod(t,{allowedSymbols:Object.keys(INDIA_EQUITIES)});
    const sourceReport={
     ...historicalReport,

     executionEligibilityReason:historicalReport.executionEligibilityReason||'HISTORICAL_DATA_ANALYSIS_ONLY'
    };
    const report=gateMarketReport(sourceReport,t,interval);
    const payload={ok:true,report,executionEligible:false,executionGate:report.executionGate,
      warning:'LIVE_EQUITY_QUOTE_UNAVAILABLE_HISTORICAL_CHART_USED',
      dataDisclaimer:sourceReport.dataDisclaimer||'Historical end-of-day candles are for context only. No live quote, forecast, or paper execution is enabled.'};
    if(Array.isArray(report?.candles)&&report.candles.length>1)cached(cacheKey,payload);
    return send(res,200,payload);
   }catch(eodErr){
    const indianListing=Boolean(INDIA_EQUITIES[t]||/\.(?:NS|BO)$/.test(t));
    const knownSymbol=INDIA_EQUITIES[t]||t;
    const dataDisclaimer='No verified live quote or historical candle series was available for '+t+'. FinPilot withholds any unverified price; forecasts and paper execution remain blocked.';
    const sourceReport={ticker:t,symbol:knownSymbol,name:t,market:indianListing?'INDIA_EQUITY':'GLOBAL_EQUITY',exchange:/\.BO$/.test(t)?'BSE':indianListing?'NSE':'UNKNOWN',currency:indianListing?'INR':'UNKNOWN',price:null,asOf:null,sourceTimestampType:'UNKNOWN_TIMESTAMP',live:false,executionEligible:false,executionEligibilityReason:'NO_VERIFIED_MARKET_DATA',dataFreshness:'UNAVAILABLE',candles:[],dataDisclaimer};
    const report=gateMarketReport(sourceReport,t,interval);
    return send(res,200,{ok:true,report,executionEligible:false,executionGate:report.executionGate,warning:'NO_VERIFIED_MARKET_DATA',dataDisclaimer});
   }
  }
 }catch(e){
  if(t==='BTC'||t==='BTCUSDT'){
   const report=gateMarketReport(btcFallback(e.message),t,interval);
   return send(res,200,{ok:true,report,executionEligible:false,executionGate:report.executionGate,warning:e.message});
  }
  return send(res,502,{ok:false,error:'Live market provider unavailable for '+t+': '+e.message,executionEligible:false});
 }
}
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
async function investmentPlan(req,res,u){
 const ticker=(u.searchParams.get('ticker')||'').trim().toUpperCase();
 const requestedCurrency=String(u.searchParams.get('currency')||'').toUpperCase();
 const isIndiaAsset=!CRYPTO_ASSETS[ticker]&&(String(ticker).includes('.NS')||String(ticker).includes('.BO')||['NIFTY','BANKNIFTY','FINNIFTY','SENSEX'].includes(ticker));
 const marketCurrency=isIndiaAsset?'INR':'USD';
 const currency=requestedCurrency==='INR'||requestedCurrency==='USD'?requestedCurrency:marketCurrency;
 const capital=Math.max(0,Number(u.searchParams.get('capital')||1000));
 const riskPct=Math.min(2,Math.max(.1,Number(u.searchParams.get('riskPct')||1)));
 if(!ticker||capital<=0)return send(res,400,{ok:false,error:'ticker and positive capital are required'});
 try{
  const report=CRYPTO_ASSETS[ticker]?await liveCrypto(ticker,'1h',true):await liveEquity(ticker);
  let research=EXA_ANALYSIS;
  if(process.env.EXA_API_KEY&&(!EXA_LAST_RUN||Date.now()-EXA_LAST_RUN>EXA_REFRESH_MS)){
    const rr=await runExaIntelligence(`${ticker} stock latest earnings news regulation risk market outlook`);
    if(rr.ok)research=EXA_ANALYSIS;
  }
  const entry=Number(u.searchParams.get('entry')||report.price);
  const atrV=Number(report.atr||Math.max(entry*.01,Math.abs((report.recentHigh||entry)-(report.recentLow||entry))/4));
  const support=Number(report.support||report.recentLow||entry-atrV),resistance=Number(report.resistance||report.recentHigh||entry+atrV*2);
  const dir=String(report.multiTimeframe?.consensus||report.direction||'MIXED').toUpperCase();
  if(dir==='MIXED'&&!u.searchParams.get('entry')&&!u.searchParams.get('stop')&&!u.searchParams.get('target')){
   return send(res,200,{ok:true,engine:'live-governed-investment-plan-v8200',ticker,market:report.market,name:report.name||ticker,currency,live:report.live===true,asOf:report.asOf||new Date().toISOString(),provider:report.provider||'live adapter',
    marketSnapshot:{price:report.price,changePct:report.changePct,rsi:report.rsi,volumeRatio:report.volumeRatio,direction:report.direction||dir,riskScore:Number(report.riskScore||70)},
    setup:{direction:'WAIT',entry,stop:null,target:null,support,resistance,atr:atrV},
    capitalPlan:{capital,riskBudgetPct:riskPct,maxRisk:capital*riskPct/100,maxLoss:0,quantity:0,invested:0,unusedCapital:capital,expectedProfit:0,profitPct:0,riskReward:null},
    probability:{bullish:50,bearish:50,confidence:Math.max(0,Number(research.confidence||0)-10),modelType:'scenario score; not probability of profit'},
    roundTable:{marketAgent:dir,bullAgent:'WAIT',bearAgent:'WAIT',riskAgent:'REVIEW',cfo:'CAPITAL PROTECT',ceo:'WAIT / VERIFY',evidenceConfidence:Number(research.confidence||0)},
    evidence:{confidence:Number(research.confidence||0),qualityScore:Number(research.qualityScore||0),freshnessScore:Number(research.freshnessScore||0),sourceDiversity:Number(research.sourceDiversity||0),primarySourceCount:Number(research.primarySourceCount||0),contradictions:Number(research.contradictions||0),sources:(research.verifiedEvidence||[]).slice(0,8)},
    controls:{stopLossEnforcedByPlan:false,approvalRequired:true,canAutoExecute:false},
    warning:'No directional edge is established by the live technical model. FinPilot will not manufacture a trade setup.'});
  }
  const direction=dir==='BEARISH'?'SHORT':dir==='BULLISH'?'LONG':(Number(u.searchParams.get('target')||0)>entry?'LONG':'SHORT');
  const stop=Number(u.searchParams.get('stop')||(direction==='SHORT'?Math.min(entry+atrV,entry*1.03):Math.max(support,entry-atrV)));
  const target=Number(u.searchParams.get('target')||(direction==='SHORT'?Math.max(entry-atrV*2,entry*.94):Math.max(resistance,entry+atrV*2)));
  const long=direction==='LONG';
  if((long&&stop>=entry)||(long&&target<=entry)||(!long&&stop<=entry)||(!long&&target>=entry))return send(res,422,{ok:false,error:'Invalid live trade geometry',report});
  const stopDistance=Math.abs(entry-stop),targetDistance=Math.abs(target-entry),rr=targetDistance/Math.max(1e-9,stopDistance),maxRisk=capital*riskPct/100;
  const qty=Math.max(0,Math.min(Math.floor(maxRisk/stopDistance),Math.floor(capital/entry))),invested=qty*entry,maxLoss=qty*stopDistance,grossProfit=qty*targetDistance;
  const technicalRisk=Number(report.riskScore||70),evidencePenalty=Number(research.confidence||0)<60?8:0;
  const baseBull=dir==='BULLISH'?65:dir==='BEARISH'?35:50;
  const bull=coreClamp(Math.round(baseBull+Math.min(15,Math.max(-10,(rr-1)*7))-(technicalRisk>70?8:technicalRisk>55?3:0)-evidencePenalty),5,95);
  const bear=100-bull;
  const confidence=coreClamp(Math.round(50+Math.abs(bull-50)*.8+(report.live?10:0)+(Number(research.confidence||0)*.15)-(technicalRisk>75?10:0)),0,95);
  const riskScore=coreClamp(Math.round(technicalRisk+(riskPct>1?5:0)+(rr<1.5?10:0)+(qty===0?10:0)+(Number(research.contradictions||0)>3?8:0)),0,100);
  const cfo=riskScore>=65||qty<1?'REJECT / PROTECT':riskScore>=45?'REDUCE SIZE / REVIEW':'CAPITAL AVAILABLE';
  const ceo=confidence>=70&&rr>=2&&riskScore<45&&Number(research.confidence||0)>=65?(long?'LONG BIAS':'SHORT BIAS'):'WAIT / VERIFY';
  return send(res,200,{ok:true,engine:'live-governed-investment-plan-v8200',ticker,market:report.market,name:report.name||ticker,live:report.live===true,asOf:report.asOf||new Date().toISOString(),provider:report.provider||'live adapter',
   marketSnapshot:{price:report.price,changePct:report.changePct,rsi:report.rsi,volumeRatio:report.volumeRatio,direction:report.direction||dir,riskScore:technicalRisk},
   setup:{direction:long?'LONG':'SHORT',entry,stop,target,support,resistance,atr:atrV},
   capitalPlan:{capital,riskBudgetPct:riskPct,maxRisk,maxLoss,quantity:qty,invested,unusedCapital:capital-invested,expectedProfit:grossProfit,profitPct:invested?grossProfit/invested*100:0,riskReward:Math.round(rr*100)/100},
   probability:{bullish:bull,bearish:bear,confidence,modelType:'scenario score; not probability of profit'},
   roundTable:{marketAgent:report.direction||dir,bullAgent:bull>=55?'LONG':'WAIT',bearAgent:bear>=55?'SHORT':'WAIT',riskAgent:riskScore>=65?'REJECT':'REVIEW',cfo,ceo,evidenceConfidence:Number(research.confidence||0)},
   evidence:{confidence:Number(research.confidence||0),qualityScore:Number(research.qualityScore||0),freshnessScore:Number(research.freshnessScore||0),sourceDiversity:Number(research.sourceDiversity||0),primarySourceCount:Number(research.primarySourceCount||0),contradictions:Number(research.contradictions||0),sources:(research.verifiedEvidence||[]).slice(0,8)},
   controls:{stopLossEnforcedByPlan:true,approvalRequired:true,canAutoExecute:false},
   warning:'Live/recent market data can be delayed; fees, slippage, taxes, gaps and liquidity can change realized results. Decision support only.'});
 }catch(err){return send(res,502,{ok:false,error:'LIVE_MARKET_ANALYSIS_UNAVAILABLE',message:String(err?.message||err)})}
}
function quantumStatus(req,res){
 const configured=Boolean(process.env.QUANTUM_API_URL&&process.env.QUANTUM_API_KEY);
 return send(res,200,{ok:true,configured,backend:configured?'EXTERNAL_QUANTUM_PROVIDER':'UNCONFIGURED',mode:'HYBRID_OPTIMIZATION',finalValidator:'CLASSICAL',providerUrlConfigured:Boolean(process.env.QUANTUM_API_URL),note:configured?'External provider may be used for candidate search; FinPilot still applies classical risk/liquidity/diversification/compliance validation.':'No external quantum provider is configured. Client Training Fabric uses a deterministic classical fallback and does not claim quantum advantage.'});
}
async function quantumOptimize(req,res){
 const configured=Boolean(process.env.QUANTUM_API_URL&&process.env.QUANTUM_API_KEY);
 if(!configured)return send(res,503,{ok:false,error:'QUANTUM_PROVIDER_NOT_CONFIGURED',backend:'UNCONFIGURED',fallback:'client-classical-search',finalValidator:'CLASSICAL'});
 const x=await body(req);
 try{
   const payload={task:'FINPILOT_HYBRID_PORTFOLIO_SEARCH',constraints:{maxConcentration:x.maxConcentration??35,minLiquidity:x.minLiquidity??20,maxRiskBudget:x.maxRiskBudget??10},capital:Number(x.capital||100000),assets:Array.isArray(x.assets)?x.assets:[]};
   const r=await fetch(process.env.QUANTUM_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.QUANTUM_API_KEY},body:JSON.stringify(payload)});
   const text=await r.text(); let d={}; try{d=JSON.parse(text)}catch{d={raw:text}};
   if(!r.ok)return send(res,502,{ok:false,error:'QUANTUM_PROVIDER_ERROR',status:r.status,detail:d});
   return send(res,200,{ok:true,backend:'EXTERNAL_QUANTUM_PROVIDER',status:'CANDIDATE_RETURNED',candidate:d,finalValidator:'CLASSICAL',validationRequired:true});
 }catch(e){return send(res,502,{ok:false,error:'QUANTUM_PROVIDER_UNAVAILABLE',message:String(e?.message||e),finalValidator:'CLASSICAL'});}
}
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
function remember(agent,entry){
 const k=clean(agent,64)||'Unknown';
 if(!AGENT_MEMORY.has(k)&&AGENT_MEMORY.size>=100)AGENT_MEMORY.delete(AGENT_MEMORY.keys().next().value);
 const a=AGENT_MEMORY.get(k)||{agent:k,runs:0,decisions:0,serverExecutedRuns:0,clientReportedRuns:0,lessons:[]};
 const source=entry?.source==='SERVER_EXECUTED'?'SERVER_EXECUTED':'CLIENT_REPORTED_UNVERIFIED';
 a.runs++;
 if(source==='SERVER_EXECUTED')a.serverExecutedRuns++;else a.clientReportedRuns++;
 if(source==='SERVER_EXECUTED'&&entry?.decision)a.decisions++;
 const lesson=clean(entry?.lesson||'',600);
 if(lesson)a.lessons.unshift({text:lesson,source,recordedAt:new Date().toISOString()});
 a.lessons=a.lessons.slice(0,20);
 a.memoryTrust=a.serverExecutedRuns>0&&a.clientReportedRuns>0?'MIXED':source==='SERVER_EXECUTED'?'SERVER_EXECUTED':'CLIENT_REPORTED_UNVERIFIED';
 AGENT_MEMORY.set(k,a);return a;
}
function evidenceFusion(req,res){
 const x=JSON.parse(req._bodyCache||'{}');
 const incoming=Array.isArray(x.evidence)?x.evidence.slice(0,50):[];
 const existing=new Set(EVIDENCE_LEDGER.map(e=>String(e.url||e.fingerprint||'')).filter(Boolean));
 const accepted=[],seen=new Set();let duplicatesSuppressed=0,invalidDiscarded=0;
 for(const raw of incoming){
  const row=raw&&typeof raw==='object'?raw:{};
  let url=String(row.url||'').trim().slice(0,2048);
  try{
   if(url){const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)url='';else{u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['fbclid','gclid','mc_cid','mc_eid'].includes(k.toLowerCase()))u.searchParams.delete(k);url=u.href;}}
  }catch{url='';}
  const title=String(row.title||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\\s+/g,' ').trim().slice(0,220);
  const query=String(row.query||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\\s+/g,' ').trim().slice(0,200);
  const snippet=String(row.snippet||row.text||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').slice(0,1200);
  if(!title&&!snippet&&!url){invalidDiscarded++;continue;}
  const fingerprint=url||[query,title,snippet.slice(0,100)].join('|');
  if(seen.has(fingerprint)||existing.has(fingerprint)){duplicatesSuppressed++;continue;}
  seen.add(fingerprint);
  const age=Date.parse(row.publishedAt||'');
  const freshness=typeof row.fresh==='boolean'?row.fresh:Number.isFinite(age)?(Date.now()-age>=-30_000&&Date.now()-age<=7*86400000):null;
  accepted.push({
   title,url,query,snippet,source:String(row.source||'unknown').slice(0,120),
   topic:String(row.topic||row.domain||'Web Search').slice(0,120),
   publishedAt:Number.isFinite(age)?new Date(age).toISOString():null,
   fresh:freshness,
   retrievalStatus:row.retrievalStatus==='RETRIEVED'?'RETRIEVED':'SNIPPET_ONLY',
   sourceType:row.sourceType==='ARTICLE_TEXT'?'ARTICLE_TEXT':'SEARCH_SNIPPET',
   direction:['BULL','BEAR'].includes(String(row.direction||'').toUpperCase())?String(row.direction).toUpperCase():null,
   receivedAt:new Date().toISOString(),fingerprint
  });
 }
 EVIDENCE_LEDGER.push(...accepted);while(EVIDENCE_LEDGER.length>500)EVIDENCE_LEDGER.shift();
 const grouped={};
 for(const e of EVIDENCE_LEDGER){const topic=String(e.topic||'Web Search');(grouped[topic]??=[]).push(e);}
 const topics=Object.entries(grouped).map(([topic,arr])=>{
  const dated=arr.filter(e=>typeof e.fresh==='boolean').length;
  const fresh=arr.filter(e=>e.fresh===true).length;
  const supports=arr.filter(e=>e.direction==='BULL').length,opposes=arr.filter(e=>e.direction==='BEAR').length;
  const conflict=supports>0&&opposes>0;
  return {topic,count:arr.length,freshness:dated?Math.round(fresh/dated*100):null,freshnessKnown:dated,freshnessUnknown:arr.length-dated,
   retrieved:arr.filter(e=>e.retrievalStatus==='RETRIEVED').length,snippetOnly:arr.filter(e=>e.retrievalStatus!=='RETRIEVED').length,
   bull:supports,bear:opposes,conflict,confidence:coreClamp(55+Math.min(25,arr.length*2)-(conflict?20:0)-(dated===0?10:0)-(fresh<dated?10:0),0,95)};
 });
 const conflicts=topics.filter(t=>t.conflict).length;
 const confidence=topics.length?Math.round(topics.reduce((a,t)=>a+t.confidence,0)/topics.length):0;
 return send(res,200,{ok:true,engine:'evidence-fusion-v4500',accepted:accepted.length,duplicatesSuppressed,invalidDiscarded,
  topics,conflicts,overallConfidence:confidence,staleEvidence:EVIDENCE_LEDGER.filter(e=>e.fresh===false).length,
  unknownTimestampEvidence:EVIDENCE_LEDGER.filter(e=>typeof e.fresh!=='boolean').length,
  retrievedPages:EVIDENCE_LEDGER.filter(e=>e.retrievalStatus==='RETRIEVED').length,ledgerSize:EVIDENCE_LEDGER.length});
}
function agentMemory(req,res){
 const agents=[...AGENT_MEMORY.values()];
 const summary=agents.reduce((a,x)=>({serverExecutedRuns:a.serverExecutedRuns+Number(x.serverExecutedRuns||0),clientReportedRuns:a.clientReportedRuns+Number(x.clientReportedRuns||0)}),{serverExecutedRuns:0,clientReportedRuns:0});
 return send(res,200,{ok:true,engine:'agent-memory-v4300',agents,totalAgents:agents.length,...summary,
  trust:'Client-reported events are unverified telemetry, not independently executed server runs or trained outcomes.',
  persistence:'PROCESS_MEMORY',persistent:false});
}
function recordMemory(req,res){
 const x=JSON.parse(req._bodyCache||'{}');
 const rows=Array.isArray(x.agents)?x.agents.slice(0,12):[x];
 const recorded=[];
 for(const row of rows){
  const agent=clean(row?.agent,64);
  if(!agent)continue;
  const lesson=clean(row?.lesson||'',600);
  const memory=remember(agent,{source:'CLIENT_REPORTED_UNVERIFIED',decision:null,lesson});
  recorded.push({agent:memory.agent,clientReportedRuns:memory.clientReportedRuns,memoryTrust:'CLIENT_REPORTED_UNVERIFIED'});
 }
 return send(res,200,{ok:true,engine:'agent-memory-v4300',source:'CLIENT_REPORTED_UNVERIFIED',recorded:recorded.length,agents:recorded,
  warning:'Client-submitted agent activity is unverified telemetry. It does not count as a server-executed run, training event, or outcome.'});
}
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
function coreStatus(req,res){
 const agents=[...AGENT_MEMORY.values()];
 const serverExecutedAgentRuns=agents.reduce((n,a)=>n+Number(a.serverExecutedRuns||0),0);
 const clientReportedAgentRuns=agents.reduce((n,a)=>n+Number(a.clientReportedRuns||0),0);
 return send(res,200,{ok:true,engine:'autonomous-intelligence-core-v5000',version:'7.0',uptimeMs:Date.now()-CORE.started,
  memoryAgents:AGENT_MEMORY.size,serverExecutedAgentRuns,clientReportedAgentRuns,
  agentMemoryTrust:clientReportedAgentRuns&&serverExecutedAgentRuns?'MIXED':clientReportedAgentRuns?'CLIENT_REPORTED_UNVERIFIED':serverExecutedAgentRuns?'SERVER_EXECUTED':'NO_AGENT_MEMORY_RECORDED',
  agentMemoryPersistence:'PROCESS_MEMORY',agentMemoryPersistent:false,
  evidenceLedger:EVIDENCE_LEDGER.length,marketEvents:MARKET_EVENTS.length,researchQueue:RESEARCH_QUEUE.length,decisionCache:DECISION_CACHE.size,cacheHits:CORE.cacheHits,decisions:CORE.decisions,
  features:['bounded-agent-memory-telemetry','evidence-fusion','contradiction-detection','real-time-event-detection','portfolio-risk','research-queue','decision-cache','execution-guard','CEO-CFO governance','human approval']});
}

async function globalMarketTest(req,res,u){
 const type=String(u.searchParams.get('type')||'index').toLowerCase();
 const requested=(u.searchParams.get('symbols')||'').split(',').map(x=>x.trim()).filter(Boolean);
 const universe=type==='stock'?(requested.length?requested:GLOBAL_STOCK_TEST_SET.map(x=>x[1])):(requested.length?requested:GLOBAL_INDEXES.map(x=>x.symbol));
 const concurrency=Math.min(6,Math.max(1,Number(u.searchParams.get('concurrency')||4)));
 const rows=[];let cursor=0;
 async function worker(){while(true){const i=cursor++;if(i>=universe.length)return;const input=universe[i];try{const report=await liveEquity(input);rows[i]={input,ok:true,symbol:report.symbol,name:report.name,price:report.price,changePct:report.changePct,live:report.live===true,provider:report.provider,asOf:report.asOf||null,candles:report.candles?.length||0};}catch(e){rows[i]={input,ok:false,error:e?.message||'provider error'};}}}
 await Promise.all(Array.from({length:Math.min(concurrency,universe.length)},worker));
 const passed=rows.filter(x=>x.ok).length,failed=rows.length-passed;
 return send(res,200,{ok:true,type,total:rows.length,passed,failed,coveragePct:rows.length?Math.round(passed/rows.length*100):0,testedAt:new Date().toISOString(),rows,disclaimer:'Coverage test only. A pass means a provider response was received; it does not imply the quote is exchange-authoritative or suitable for trading.'});
}
function marketUniverse(req,res){return send(res,200,{ok:true,crypto:Object.keys(CRYPTO_ASSETS).filter(x=>!x.endsWith('USDT')),equities:Object.keys(INDIA_EQUITIES),globalIndexes:GLOBAL_INDEXES,timeframes:Object.keys(TIMEFRAMES),globalStockResolver:true,providers:[{name:'Binance public market data',status:'public-adapter',coverage:'Supported crypto pairs'},{name:'Yahoo Finance chart + symbol resolver',status:'unofficial-recent',coverage:'Global Yahoo-listed equities, ETFs and indexes subject to provider availability'},{name:'NSE India market-data page',status:'exchange-page-adapter',coverage:'NIFTY/BANKNIFTY/FINNIFTY/SENSEX'}],note:'Global coverage is provider-dependent; FinPilot must label delayed/unavailable data rather than inventing it.'})}
function compliance(req,res){return send(res,200,{ok:true,policyVersion:'2026-10-07',jurisdiction:'India',productMode:'Financial information & decision support',regulatedAdvice:false,controls:{transactionExecution:false,guaranteedReturns:false,riskProfilingRequiredForRegulatedAdvice:true,suitabilityRequiredForRegulatedAdvice:true,evidenceRequiredForMarketSensitiveClaims:true,humanApprovalForHighImpactActions:true},sources:[{name:'SEBI Investment Advisers Regulations',url:'https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1740726382475.pdf',freshness:'verified against official SEBI source'},{name:'SEBI Master Circular for Investment Advisers',url:'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6',freshness:'official SEBI listing'}]})}
function staticFile(req,res,u){
 let p=u.pathname==='/'?'/index.html':u.pathname;
 p=path.normalize(p).replace(/^\.{2}(\/|\\)/,'');
 const file=path.join(ROOT,p);
 if(!file.startsWith(ROOT))return send(res,403,{error:'Forbidden'});
 fs.stat(file,(e,s)=>{if(e||!s.isFile())return send(res,404,'Not found','text/plain'); const ext=path.extname(file);res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(),microphone=(),geolocation=(),payment=()','Content-Security-Policy':"default-src 'self'; connect-src 'self' https://api.binance.com https://fapi.binance.com https://eapi.binance.com; img-src 'self' data: https://www.tradingview.com https://s3.tradingview.com; style-src 'self' 'unsafe-inline' https://www.tradingview.com; script-src 'self' 'unsafe-inline' https://s3.tradingview.com https://www.tradingview.com; frame-src 'self' https://www.tradingview.com https://in.tradingview.com; child-src 'self' https://www.tradingview.com https://in.tradingview.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});fs.createReadStream(file).pipe(res);});
}

// FinPilot 5.1 Security + Real-Time Automation layer
const SECURITY={started:Date.now(),blocked:0,rateLimited:0,events:[],lastRefresh:null};
const RATE_LIMITER=createBoundedRateLimiter({limit:Number(process.env.FINPILOT_RATE_LIMIT||240),maxClients:10000});
const TRADINGVIEW_ALERT_LIMITER=createBoundedRateLimiter({limit:60,windowMs:60000,maxClients:1000});
const TRADINGVIEW_ALERT_INBOX=createTradingViewAlertInbox({getToken:()=>process.env.FINPILOT_TRADINGVIEW_WEBHOOK_TOKEN||''});
const AUTO={enabled:true,marketRefreshMs:5000,agentRefreshMs:15000,maxConcurrentAgents:5,cacheTtlMs:CACHE_TTL_MS,lastOptimization:null,optimizations:0};
function clientKey(req){return String(req.socket?.remoteAddress||'unknown').replace(/^::ffff:/,'');}
function securityEvent(type,detail){SECURITY.events.unshift({type,detail,time:new Date().toISOString()});SECURITY.events=SECURITY.events.slice(0,100);}
function rateCheck(req){const key=clientKey(req),result=RATE_LIMITER.check(key);if(!result.allowed){SECURITY.rateLimited++;securityEvent('RATE_LIMIT',key);return false}return true;}
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
 res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no','X-FinPilot-Version':'8.6'});
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
 if(event.type==='AUTONOMOUS_RESEARCH_UPDATE')matches=AGENT_CATALOG.filter(a=>['research','risk','quant','compliance','ceo'].includes(a.id));
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
 const p=job.trigger.payload||{};let result='MONITOR',evidenceScore=0;
 if(job.trigger.type==='AUTONOMOUS_RESEARCH_UPDATE'){const q=Number(p.qualityScore||0);evidenceScore=q;if(job.agentId==='research')result=q>=70?'LEARNING_CANDIDATE_REVIEW':'EVIDENCE_REVIEW';else if(job.agentId==='risk')result=q<65?'LEARNING_RISK_FLAG':'LEARNING_RISK_REVIEW';else if(job.agentId==='quant')result=q>=70?'RESEARCH_READY':'DATA_REJECT';else if(job.agentId==='compliance')result=q>=70?'SOURCE_CHECK_PASS':'SOURCE_CHECK_REQUIRED';else if(job.agentId==='ceo')result=q>=80?'LEARNING_SYNTHESIS_READY':'LEARNING_SYNTHESIS_BLOCKED';
 } else if(job.trigger.type==='RESEARCH_UPDATE'){const z=p.analysis||EXA_ANALYSIS;evidenceScore=Number(z.confidence||0);
   if(job.agentId==='research')result=evidenceScore>=70?'EVIDENCE_VERIFIED':'EVIDENCE_REVIEW';
   else if(job.agentId==='risk')result=evidenceScore<60||z.contradictions>Math.max(2,EXA_CACHE.length*.2)?'RISK_ESCALATE':'RISK_REVIEW';
   else if(job.agentId==='quant')result=evidenceScore>=65?'QUANT_REVIEW':'DATA_REJECT';
   else if(job.agentId==='compliance')result=z.primarySourceCount>0&&z.freshnessScore>=60?'SOURCE_CHECK_PASS':'SOURCE_CHECK_REQUIRED';
   else if(job.agentId==='ceo')result=evidenceScore>=75&&z.contradictions<=3?'SYNTHESIS_READY':'SYNTHESIS_BLOCKED';
 } else {
   if(job.agentId==='risk'&&(p.changePct<-5||p.openInterestChange>12))result='ESCALATE_RISK';
   if(job.agentId==='cfo'&&(p.freeCash<0||p.cashRunway<3))result='PROTECT_LIQUIDITY';
   if(job.agentId==='compliance'&&p.marketSensitive)result='VERIFY_EVIDENCE';
   if(job.agentId==='security'&&job.trigger.type==='SECURITY_ALERT')result='CONTAIN';
   if(job.agentId==='ceo'&&job.trigger.type==='USER_DECISION')result='SYNTHESIZE';
 }
 const delta=(result.includes('BLOCKED')||result.includes('REJECT')||result.includes('ESCALATE')||result.includes('REQUIRED'))?-1:1;
 a.health='READY';a.score=Math.max(0,Math.min(100,Math.round(a.score+delta)));
 audit('AGENT_WAKE',{agent:a.name,trigger:job.trigger.type,result,evidenceScore});
}
function qualityUpdate(source,ok,latency,error){const x=DATA_HEALTH.sources[source]??={};if(ok){x.status='HEALTHY';x.latencyMs=latency;x.lastSuccess=new Date().toISOString();x.lastError=null}else{x.status='DEGRADED';x.lastError=error;x.latencyMs=latency;RESILIENCE.providerFailures++;RESILIENCE.lastIncident=new Date().toISOString();}const vals=Object.values(DATA_HEALTH.sources);DATA_HEALTH.qualityScore=Math.round(vals.reduce((n,v)=>n+(v.status==='HEALTHY'?100:v.status==='DEGRADED'?45:0),0)/Math.max(1,vals.length));DATA_HEALTH.freshness=DATA_HEALTH.qualityScore>=90?'FRESH':DATA_HEALTH.qualityScore>=50?'DEGRADED':'STALE';DATA_HEALTH.updatedAt=new Date().toISOString();if(!ok)emitEvent('DATA_QUALITY_ALERT',{source,error},95);}
function providerCooldownError(source){const c=claimProviderRequest(source);return c&&c.active?new Error(c.halfOpen?`PROVIDER_RECOVERY_PROBE_IN_PROGRESS:${source}`:`PROVIDER_COOLDOWN_ACTIVE:${source}:RETRY_AFTER_${Math.ceil(c.retryAfterMs/1000)}S`):null;}
function resilientFetch(url,source='provider',timeoutMs=7000){const cooldownError=providerCooldownError(source);if(cooldownError)return Promise.reject(cooldownError);if(RESILIENCE.circuitOpen)return Promise.reject(new Error('PROVIDER_CIRCUIT_OPEN'));const started=Date.now();return Promise.race([fetch(url),new Promise((_,rej)=>setTimeout(()=>rej(new Error('PROVIDER_TIMEOUT')),timeoutMs))]).then(async r=>{const t=Date.now()-started;if(!r.ok)throw new Error(`HTTP_${r.status}`);qualityUpdate(source,true,t);recordProviderSuccess(source);return r}).catch(async e=>{qualityUpdate(source,false,Date.now()-started,e.message);recordProviderFailure(source,e.message);if(RESILIENCE.providerFailures>=5){RESILIENCE.circuitOpen=true;setTimeout(()=>{RESILIENCE.circuitOpen=false;RESILIENCE.providerFailures=0;},Math.min(30000,RESILIENCE.backoffMs*4));}throw e;});}

// Exa Intelligence Layer: web research is evidence-only and never allowed to fabricate market numbers.
let EXA_LAST_RUN=0, EXA_RUNNING=false, EXA_CACHE=[];
let EXA_ANALYSIS={confidence:0,qualityScore:0,freshnessScore:0,sourceDiversity:0,contradictions:0,primarySourceCount:0,verifiedEvidence:[],warnings:[]};
function analyzeExaEvidence(rows){
 const now=Date.now(), seen=new Set(), domains=new Set(), verified=[], warnings=[]; let quality=0,fresh=0,primary=0,contradictions=0;
 for(const r of rows){try{const u=new URL(r.url);const host=u.hostname.replace(/^www\\./,'');domains.add(host);const age=r.publishedDate?Math.max(0,now-Date.parse(r.publishedDate)):null;const isFresh=age===null||age<7*86400000;const isPrimary=/sec\\.gov|sebi\\.gov|rbi\\.org|nseindia|bseindia|company|filing|ir\\./i.test(host+r.title);if(isFresh)fresh++;if(isPrimary)primary++;if(!seen.has(host)){quality+=isPrimary?100:70;seen.add(host)}const text=String([r.title,...(r.highlights||[])].join(' ')).toLowerCase();if(/fraud|risk|warning|loss|bearish|decline|downgrade|lawsuit/.test(text))contradictions++;verified.push({title:r.title,url:r.url,host,publishedDate:r.publishedDate||null,sourceTier:isPrimary?'PRIMARY':'SECONDARY',fresh:isFresh});}catch{warnings.push('INVALID_SOURCE_URL');}}
 const n=rows.length||1; const freshnessScore=Math.round(fresh/n*100), sourceDiversity=Math.round(Math.min(100,domains.size/Math.max(1,Math.min(8,n))*100));
 const qualityScore=Math.round(quality/Math.max(1,seen.size)); const contradictionRate=Math.min(100,Math.round(contradictions/n*100));
 const confidence=coreClamp(Math.round(0.4*qualityScore+0.3*freshnessScore+0.2*sourceDiversity+0.1*Math.max(0,100-contradictionRate)),0,100);
 EXA_ANALYSIS={confidence,qualityScore,freshnessScore,sourceDiversity,contradictions,primarySourceCount:primary,verifiedEvidence:verified.slice(0,32),warnings:[...new Set(warnings)]};
 return EXA_ANALYSIS;
}
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
  const analysis=analyzeExaEvidence(EXA_CACHE);
  audit('EXA_RESEARCH_REFRESH',{topic,count:EXA_CACHE.length,confidence:analysis.confidence,qualityScore:analysis.qualityScore,primarySourceCount:analysis.primarySourceCount,latencyMs:Date.now()-started});
  emitEvent('RESEARCH_UPDATE',{source:'Exa',count:EXA_CACHE.length,topic,analysis},70);
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
// Background Exa calls are opt-in to prevent unattended quota drain. Manual refresh remains available.
setInterval(()=>{if(String(process.env.FINPILOT_EXA_AUTO_REFRESH||'false').toLowerCase()==='true'&&process.env.EXA_API_KEY&&Date.now()-EXA_LAST_RUN>EXA_REFRESH_MS)runExaIntelligence('global finance market data AI risk regulation').catch(()=>{});},60000);

const AUTONOMOUS_LEARNING_INIT=initAutonomousLearning({searchWeb,emitEvent,audit,getSchedulerState:()=>({running:SCHEDULER.running,maxConcurrency:SCHEDULER.maxConcurrency,queue:SCHEDULER.queue})});
audit('AUTONOMOUS_LEARNING_INIT',{version:AUTONOMOUS_LEARNING_INIT.version,enabled:AUTONOMOUS_LEARNING_INIT.enabled,intervalMs:AUTONOMOUS_LEARNING_INIT.intervalMs});
const AIOS_MARKET_TRAINING_INIT=initializeAIOSMarketTrainingDirector({
 loadSnapshot:ticker=>loadMarketStreamSnapshot(String(ticker)+'\\u001f1h')
}).then(status=>{audit('AIOS_MARKET_TRAINING_INIT',{version:status.version,enabled:status.enabled,requestedEnabled:status.requestedEnabled,persistence:status.persistence,blockedReason:status.blockedReason});return status;}).catch(error=>{audit('AIOS_MARKET_TRAINING_INIT_ERROR',{error:String(error?.message||error)});return null;});


function osControlPlaneObservations(){
 const learning=autonomousLearningStatus(),data=dataHealthDiagnostics();
 return {
  health:{ok:true,status:'OPERATIONAL',frontendSyntax:frontendSyntax(),search:data.search},
  core:{ok:true,uptimeMs:Date.now()-CORE.started,memoryAgents:AGENT_MEMORY.size,evidenceLedger:EVIDENCE_LEDGER.length,marketEvents:MARKET_EVENTS.length,researchQueue:RESEARCH_QUEUE.length,decisionCache:DECISION_CACHE.size,cacheHits:CORE.cacheHits,decisions:CORE.decisions},
  performance:{requests:PERF.requests,cacheHits:PERF.cacheHits,errors:PERF.errors,agentRuns:PERF.agentRuns},
  fleet:{ok:true,agents:AGENT_POOL.size,scheduler:{queue:SCHEDULER.queue.length,running:SCHEDULER.running,completed:SCHEDULER.completed,failed:SCHEDULER.failed}},
  data:data,
  marketHealth:{providers:providerHealthSnapshot(),registry:globalProviderStatus()},
  learning,
  policy:{ok:true,policy:POLICY,autonomy:{level:AUTONOMY.level,mode:AUTONOMY.mode}},
  security:{ok:true,blocked:SECURITY.blocked,rateLimited:SECURITY.rateLimited,events:SECURITY.events.slice(0,12),headers:['CSP','X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy'],secretExposure:'server-only'},
  autonomy:{ok:true,level:AUTONOMY.level,mode:AUTONOMY.mode,cycles:AUTONOMY.cycles,policyBlocks:AUTONOMY.policyBlocks},
  eventBus:{ok:true,events:EVENT_BUS.events.length,routed:EVENT_BUS.routed,coalesced:EVENT_BUS.coalesced,wakeups:EVENT_BUS.wakeups},
  quantum:{ok:true,configured:Boolean(process.env.QUANTUM_API_URL&&process.env.QUANTUM_API_KEY),backend:(process.env.QUANTUM_API_URL&&process.env.QUANTUM_API_KEY)?'EXTERNAL_QUANTUM_PROVIDER':'UNCONFIGURED',mode:'HYBRID_OPTIMIZATION',finalValidator:'CLASSICAL'},
  marketStream:{ok:true,...MARKET_STREAM_HUB.stats(),pollMs:MARKET_STREAM_POLL_MS,heartbeatMs:15000},
  evolution:getShadowEvaluationStatus()
 };
}
async function osControlPlaneSnapshot(req,res){
 const observations=osControlPlaneObservations();
 observations.agentFactory=await getManagedAgentRegistrySnapshot();
 observations.marketTraining=await getAIOSMarketTrainingStatus();
 return send(res,200,await getOSControlPlaneSnapshot(observations));
}
async function osControlPlaneCycle(req,res){
 const observations=osControlPlaneObservations();
 observations.agentFactory=await getManagedAgentRegistrySnapshot();
 observations.marketTraining=await getAIOSMarketTrainingStatus();
 const plan=await runAutonomousCoreCycle(observations);
 audit('AUTONOMOUS_CORE_CYCLE',{cycleId:plan.id,mode:plan.mode,taskCount:plan.tasks.length,actionsExecuted:plan.actionsExecuted.length});
 emitEvent('OS_CONTROL_CYCLE',{cycleId:plan.id,mode:plan.mode,taskCount:plan.tasks.length},65);
 return send(res,200,plan);
}
async function osControlPlaneFeedback(req,res){
 const result=await recordOSControlFeedback(req._parsedBody||{});
 if(!result.ok)return send(res,result.status||400,result);
 audit('AUTONOMOUS_CORE_FEEDBACK',{cycleId:result.record.cycleId,taskId:result.record.taskId,outcome:result.record.outcome,category:result.record.category});
 emitEvent('OS_LEARNING_FEEDBACK',{category:result.record.category,outcome:result.record.outcome},55);
 return send(res,200,result);
}
async function osControlPlaneMode(req,res){
 const result=setAutonomousCoreMode((req._parsedBody||{}).mode);
 if(!result.ok)return send(res,400,result);
 audit('AUTONOMOUS_CORE_MODE',{mode:result.mode});
 emitEvent('OS_AUTONOMY_MODE',{mode:result.mode},70);
 return send(res,200,result);
}
async function osControlPlaneSecurityCheck(req,res){
 const result=evaluateSecurityRequest(req._parsedBody||{});
 audit('AUTONOMOUS_SECURITY_POLICY_CHECK',{action:result.action,target:result.target,allowed:result.allowed,status:result.status});
 if(!result.allowed)securityEvent('AUTONOMOUS_POLICY_DENIED',result.status+' · '+result.action);
 return send(res,200,result);
}

function osControlPlaneShadowEvaluate(req,res){
 const result=evaluateShadowCandidate(req._parsedBody||{});
 audit('AUTONOMOUS_SHADOW_EVALUATION',{candidateId:result.candidateId,status:result.status,blockers:result.blockers,productionMutation:false});
 emitEvent('OS_SHADOW_EVALUATION',{candidateId:result.candidateId,status:result.status},55);
 return send(res,200,result);
}
function eventStatus(req,res){return send(res,200,{ok:true,version:'5.2',events:EVENT_BUS.events.slice(0,30),routed:EVENT_BUS.routed,coalesced:EVENT_BUS.coalesced,wakeups:EVENT_BUS.wakeups,dropped:EVENT_BUS.dropped,queue:SCHEDULER.queue.length,running:SCHEDULER.running,completed:SCHEDULER.completed,failed:SCHEDULER.failed});}
function agentFleetStatus(req,res){return send(res,200,{ok:true,version:'6.0',agents:[...AGENT_POOL.values()],scheduler:{queue:SCHEDULER.queue.length,running:SCHEDULER.running,maxConcurrency:SCHEDULER.maxConcurrency,completed:SCHEDULER.completed,failed:SCHEDULER.failed},routing:'event-driven selective wakeups'});}
function dataHealth(req,res){return send(res,200,{ok:true,version:'5.4',...DATA_HEALTH,resilience:RESILIENCE});}
function policyStatus(req,res){return send(res,200,{ok:true,version:'6.1',policy:POLICY,autonomy:{level:AUTONOMY.level,mode:AUTONOMY.mode},protected:['money movement','credential access','compliance mutation','CFO veto','execution guard']});}
function autonomyStatus(req,res){return send(res,200,{ok:true,version:'7.1',autonomy:AUTONOMY,policyBlocks:AUTONOMY.policyBlocks,eventBus:{events:EVENT_BUS.events.length,routed:EVENT_BUS.routed,wakeups:EVENT_BUS.wakeups,coalesced:EVENT_BUS.coalesced},scheduler:{queue:SCHEDULER.queue.length,running:SCHEDULER.running,completed:SCHEDULER.completed},dataHealth:DATA_HEALTH.qualityScore,auditRecords:AUDIT.length,autonomousLearning:autonomousLearningStatus()});}
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
const DATA_HEALTH_STALE_AFTER_MS=Math.max(120000,Number(EXECUTION_FRESHNESS_MS)||90000);
function dataHealthDiagnostics(){
 const now=Date.now();
 const sources=Object.entries(DATA_HEALTH.sources||{}).map(([name,raw])=>{
  const lastSuccess=raw.lastSuccess||null;
  const lastSuccessMs=lastSuccess?Date.parse(lastSuccess):NaN;
  const lastSuccessAgeMs=Number.isFinite(lastSuccessMs)?Math.max(0,now-lastSuccessMs):null;
  let status=String(raw.status||'UNKNOWN').toUpperCase();
  if(status==='HEALTHY'&&lastSuccessAgeMs!==null&&lastSuccessAgeMs>DATA_HEALTH_STALE_AFTER_MS)status='STALE';
  if(!['HEALTHY','DEGRADED','STALE','UNKNOWN'].includes(status))status='UNKNOWN';
  return {name,status,latencyMs:raw.latencyMs!==null&&raw.latencyMs!==undefined&&Number.isFinite(Number(raw.latencyMs))?Number(raw.latencyMs):null,lastSuccess,lastSuccessAgeMs,staleAfterMs:DATA_HEALTH_STALE_AFTER_MS,lastError:raw.lastError?String(raw.lastError).slice(0,180):null};
 });
 const providers=aggregateDataHealthSources(now);
 const states=providers.map(x=>x.status);
 const allUnknown=!states.length||states.every(x=>x==='UNKNOWN');
 let dataQuality='UNKNOWN';
 if(!allUnknown){
  if(states.includes('DEGRADED'))dataQuality='DEGRADED';
  else if(states.includes('STALE'))dataQuality='STALE';
  else if(states.includes('UNKNOWN'))dataQuality='DEGRADED';
  else dataQuality='FRESH';
 }
 const weights={HEALTHY:100,STALE:50,DEGRADED:35,UNKNOWN:0};
 const dataQualityScore=providers.length?Math.round(providers.reduce((sum,x)=>sum+(weights[x.status]??0),0)/providers.length):0;
 const warnings=[];
 const cooldowns=activeProviderCooldowns(now);
 for(const cooldown of cooldowns)warnings.push(cooldown.source+' provider is cooling down for about '+Math.ceil(cooldown.retryAfterMs/1000)+' seconds after '+cooldown.kind+'; FinPilot will skip it temporarily and try available fallback providers.');
 if(allUnknown)warnings.push('No successful market-provider check has been recorded since this process started. Run a market lookup to measure source health.');
 for(const x of providers){
  if(x.status==='STALE')warnings.push(x.id+' last succeeded '+Math.round((x.lastSuccessAgeMs||0)/1000)+' seconds ago; refresh market data before relying on it.');
  else if(x.status==='DEGRADED')warnings.push(x.id+' provider is degraded'+(x.lastError?': '+x.lastError:'')+'.');
  else if(x.status==='UNKNOWN')warnings.push(x.id+' source has not been verified in this process.');
 }
 const aiConfigured=Boolean(process.env.LLM_API_URL&&process.env.LLM_API_KEY);
 if(!aiConfigured)warnings.push('External AI gateway is not configured. Deterministic analysis remains available; live external AI reasoning is not active.');
 const paidSearchFallbackEnabled=String(process.env.SEARCH_ALLOW_PAID_FALLBACK||'false').toLowerCase()==='true';
 return {
  dataQuality,dataQualityScore,updatedAt:DATA_HEALTH.updatedAt||null,staleAfterMs:DATA_HEALTH_STALE_AFTER_MS,
  sources,providers,warnings,providerCooldowns:cooldowns,
  ai:{configured:aiConfigured,mode:aiConfigured?'EXTERNAL_GATEWAY':'DETERMINISTIC_ONLY'},
  search:{providerMode:String(process.env.SEARCH_PROVIDER||'auto').toLowerCase(),freeFirst:true,paidFallbackEnabled:paidSearchFallbackEnabled}
 };
}
function health70(req,res){
 const diagnostics=dataHealthDiagnostics();
 return send(res,200,{
  ok:true,service:'FinPilot Web Gateway',version:'8.6',status:'OPERATIONAL',
  readiness:diagnostics.dataQuality==='FRESH'?'MARKET_DATA_READY':diagnostics.dataQuality==='UNKNOWN'?'NOT_YET_VERIFIED':'PARTIAL',
  autonomy:'governed',eventDriven:true,selfHealing:true,autonomousLearning:autonomousLearningStatus().enabled,
  dataQuality:diagnostics.dataQuality,dataQualityScore:diagnostics.dataQualityScore,
  dataQualityUpdatedAt:diagnostics.updatedAt,dataQualityStaleAfterMs:diagnostics.staleAfterMs,
  dataSources:diagnostics.sources,dataProviders:diagnostics.providers,dataQualityWarnings:diagnostics.warnings,providerCooldowns:diagnostics.providerCooldowns,
  aiConfigured:diagnostics.ai.configured,ai:diagnostics.ai,search:diagnostics.search,
  security:'hardened',realtime:true,execution:'human-approval-gated',
  executionFreshnessMs:EXECUTION_FRESHNESS_MS,marketCacheMs:MARKET_CACHE_MS,
  frontendSyntax:frontendSyntax(),timestamp:new Date().toISOString()
 });
}

const server=http.createServer(async(req,res)=>{
 const started=Date.now(); PERF.requests++; const rid=requestId(); res.setHeader('X-FinPilot-Request-Id',rid); res.setHeader('X-FinPilot-Version','8.6');
 try{
  if(!rateCheck(req)){SECURITY.blocked++;return send(res,429,{ok:false,error:'RATE_LIMITED',requestId:rid});}
  const origin=String(req.headers.origin||'');
  const forwardedProto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim();
  const requestProtocol=forwardedProto||(req.socket?.encrypted?'https':'http');
  const originAllowed=isAllowedRequestOrigin({origin:req.headers.origin,host:req.headers.host,allowedOrigin:process.env.ALLOWED_ORIGIN||'',requestProtocol});
  if((req.method==='POST'||req.method==='OPTIONS')&&!originAllowed){
   SECURITY.blocked++;securityEvent('CROSS_ORIGIN_WRITE_BLOCKED','Origin policy rejected '+origin.slice(0,120));
   return send(res,403,{ok:false,error:'CROSS_ORIGIN_WRITE_BLOCKED',requestId:rid});
  }
  if(req.method==='OPTIONS'){
   const headers={'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Max-Age':'600'};
   if(origin)headers['Access-Control-Allow-Origin']=origin;
   return send(res,204,'','text/plain; charset=utf-8',headers);
  }
  const contentLength=Number(req.headers['content-length']||0);
  if(Number.isFinite(contentLength)&&contentLength>MAX_REQUEST_BODY_BYTES){req.resume();return send(res,413,{ok:false,error:'REQUEST_BODY_TOO_LARGE',requestId:rid});}
  const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));

  if(req.method==='GET'&&u.pathname==='/api/exa-intelligence')return exaIntelligence(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/quantum-status')return quantumStatus(req,res);
  if(req.method==='POST'&&u.pathname==='/api/quantum-optimize')return quantumOptimize(req,res);
  if(req.method==='GET'&&u.pathname==='/api/exa-status')return exaStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/ai-os/training/status')return send(res,200,await getAIOSMarketTrainingStatus());
  if(req.method==='POST'&&u.pathname==='/api/ai-os/training/cycle'){
   if(String(process.env.FINPILOT_AI_OS_MANUAL_CYCLE_ENABLED||'false').toLowerCase()!=='true')return send(res,403,{ok:false,error:'MANUAL_TRAINING_CYCLE_DISABLED',detail:'Enable FINPILOT_AI_OS_MANUAL_CYCLE_ENABLED only after reviewing data-provider limits.'});
   await body(req);return send(res,200,await runAIOSMarketTrainingCycle({trigger:'operator-request'}));
  }
  if(req.method==='GET'&&u.pathname==='/api/ai-os/agents')return send(res,200,await listManagedAgents());
  if(req.method==='POST'&&u.pathname==='/api/ai-os/agents'){await body(req);const r=await createManagedAgent(req._parsedBody||{});return send(res,r.ok?201:(r.status||400),r);}
  if(req.method==='GET'&&u.pathname==='/api/os-control-plane')return osControlPlaneSnapshot(req,res);
  if(req.method==='POST'&&u.pathname==='/api/os-control-plane/cycle'){await body(req);return osControlPlaneCycle(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/os-control-plane/feedback'){await body(req);return osControlPlaneFeedback(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/os-control-plane/mode'){await body(req);return osControlPlaneMode(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/os-control-plane/security-check'){await body(req);return osControlPlaneSecurityCheck(req,res);}
  if(req.method==='POST'&&u.pathname==='/api/os-control-plane/shadow-evaluate'){await body(req);return osControlPlaneShadowEvaluate(req,res);}
  if(req.method==='GET'&&u.pathname==='/api/autonomous-learning/status')return send(res,200,{ok:true,...autonomousLearningStatus()});
  if(req.method==='GET'&&u.pathname==='/api/autonomous-learning/queue')return send(res,200,{ok:true,queue:autonomousLearningQueue(u.searchParams.get('limit')||40)});
  if(req.method==='POST'&&u.pathname==='/api/autonomous-learning/cycle'){const r=await autonomousLearningCycle();return send(res,r.ok?200:503,r);}
  if(req.method==='GET'&&u.pathname==='/api/autonomous-learning/live-test')return send(res,200,{ok:true,...autonomousLearningStatus().liveTest});
  if(req.method==='POST'&&u.pathname==='/api/autonomous-learning/live-test'){const r=await runLiveAgentComparison({searchWeb,emitEvent,audit});return send(res,r.ok?200:503,r);}
  if(req.method==='POST'&&u.pathname==='/api/autonomous-learning/improve'){const r=await runLiveAgentComparison({searchWeb,emitEvent,audit,improveWeak:true,improvementRounds:3,improvementAgentCount:4});return send(res,r.ok?200:503,{ok:r.ok,status:r.status,averageScore:r.averageScore,improvement:r.improvement,rankings:r.rankings,error:r.error||null});}
  if(req.method==='POST'&&u.pathname==='/api/autonomous-learning/enable'){await body(req);const x=req._parsedBody||{};return send(res,200,{ok:true,...autonomousLearningEnable(x.enabled!==false)});}
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
  if(req.method==='GET'&&u.pathname==='/api/tradingview-alert-status')return send(res,200,TRADINGVIEW_ALERT_INBOX.status());
  if((req.method==='GET'&&u.pathname==='/api/tradingview-alerts')||(req.method==='POST'&&u.pathname==='/api/tradingview-alert')){
   const limiter=TRADINGVIEW_ALERT_LIMITER.check(clientKey(req));
   if(!limiter.allowed)return send(res,429,{ok:false,error:'TRADINGVIEW_ALERT_RATE_LIMITED'});
   if(req.method==='GET'){
    const result=TRADINGVIEW_ALERT_INBOX.list(req.headers['x-finpilot-webhook-token']);
    if(!result.ok)return send(res,result.statusCode||401,result);
    return send(res,200,result);
   }
   if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')return send(res,415,{ok:false,error:'JSON_CONTENT_TYPE_REQUIRED'});
   const input=await body(req);
   if(Buffer.byteLength(req._bodyCache||'','utf8')>8192)return send(res,413,{ok:false,error:'TRADINGVIEW_ALERT_TOO_LARGE',maxBytes:8192});
   // Allow authenticated diagnostic clients to provide the same webhook secret via header;
   // TradingView itself can continue sending the token in its JSON payload.
   if(input&&typeof input==='object'&&!Array.isArray(input)&&input.token===undefined&&req.headers['x-finpilot-webhook-token'])input.token=req.headers['x-finpilot-webhook-token'];
   const result=TRADINGVIEW_ALERT_INBOX.ingest(input);
   if(!result.ok)return send(res,result.statusCode||400,result);
   return send(res,202,result);
  }
  if(req.method==='GET'&&u.pathname==='/api/security-status')return securityStatus(req,res);
  if(req.method==='GET'&&u.pathname==='/api/realtime-status')return realtimeStatus(req,res);
  if(req.method==='POST'&&u.pathname==='/api/auto-optimize')return autoOptimize(req,res);
  if(req.method==='GET'&&u.pathname==='/api/market-history')return marketHistory(req,res,u);
  if(req.method==='POST'&&u.pathname==='/api/market-ingest'){await body(req);const checked=normalizeMarketTick(req._parsedBody||{});if(!checked.ok)return send(res,400,{ok:false,error:'INVALID_MARKET_TICK',reason:checked.error});const x=checked.value;const stored=await storeMarketTick(x);emitEvent('MARKET_TICK',{ticker:x.ticker,price:x.price,time:x.time,sourceVerified:false},90);return send(res,200,{ok:true,cloudStored:stored,sourceVerified:false,source:x.source,agentCoreHandoff:true,message:stored?'Validated tick archived as unverified client-reported data.':'Tick validated, but cloud archive did not confirm storage.'});}
  if(req.method==='GET'&&u.pathname==='/api/market-stream')return marketStream(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/compliance')return compliance(req,res);
  if(req.method==='GET'&&u.pathname==='/api/research/fetch')return researchFetch(req,res,u);
  if(req.method==='POST'&&u.pathname==='/api/task-intelligence'){await body(req);const plan=planFinancialTask(req._parsedBody||{});return send(res,200,{ok:true,plan,sourceCatalog:getSourceCatalog().map(x=>({id:x.id,name:x.name,tier:x.tier,assetClasses:x.assetClasses,dataTypes:x.dataTypes,liveCapability:x.liveCapability,url:x.url}))});}
  if(req.method==='POST'&&u.pathname==='/api/task-research')return taskResearch(req,res);
  if(req.method==='GET'&&u.pathname==='/api/search')return search(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/cloud-knowledge')return cloudKnowledge(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/derivatives-report')return derivativesReport(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/option-chain-scan')return optionChainScan(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/instrument-search')return instrumentSearch(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-snapshot')return marketSnapshotRoute(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/stock-report')return stockReport(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-data-os')return marketDataOS(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-data-stream')return marketDataStream(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-universe')return marketUniverse(req,res);
  if(req.method==='GET'&&u.pathname==='/api/global-market-test')return globalMarketTest(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-provider-status')return send(res,200,{ok:true,...globalProviderStatus()});
if(req.method==='GET'&&u.pathname==='/api/market-provider-health'){const diagnostics=dataHealthDiagnostics();return send(res,200,{ok:true,providers:providerHealthSnapshot(),cooldowns:diagnostics.providerCooldowns,dataQuality:diagnostics.dataQuality,dataQualityScore:diagnostics.dataQualityScore,timestamp:new Date().toISOString()});}
if(req.method==='GET'&&u.pathname==='/api/market-provenance')return marketProvenanceRoute(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/market-picks')return marketPicks(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/options-math')return optionsMath(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/chain-analytics')return chainAnalytics(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/round-table-decision')return roundTableDecision(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/risk-guard')return riskGuard(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/command-decision')return commandDecision(req,res,u);
  if(req.method==='GET'&&u.pathname==='/api/investment-plan')return investmentPlan(req,res,u);
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
 }catch(e){const status=Number(e?.statusCode)===413?413:500;send(res,status,{ok:false,error:status===413?'REQUEST_BODY_TOO_LARGE':'INTERNAL_SERVER_ERROR',requestId:rid})}
});
server.on('error',(e)=>{console.error(`FinPilot Web server error: ${e.message}`);process.exitCode=1;});
const AUTONOMOUS_CORE_SCHEDULER=setInterval(async()=>{
 if(getAutonomousCoreMode()!=='SAFE_AUTONOMY')return;
 try{
  const result=await runAutonomousCoreCycle(osControlPlaneObservations());
  audit('AUTONOMOUS_CORE_SCHEDULED_CYCLE',{cycleId:result.id,taskCount:result.tasks.length,actionsExecuted:result.actionsExecuted.length});
  emitEvent('OS_CONTROL_SCHEDULED_CYCLE',{cycleId:result.id,taskCount:result.tasks.length},50);
 }catch(e){audit('AUTONOMOUS_CORE_SCHEDULE_ERROR',{error:String(e?.message||e).slice(0,160)});}
},5*60*1000);
AUTONOMOUS_CORE_SCHEDULER.unref?.();

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
server.listen(PORT,HOST,()=>{console.log(`FinPilot Web running on http://${HOST}:${PORT}`); console.log('[frontend-syntax]',JSON.stringify(frontendSyntax())); if(AUTONOMOUS_LEARNING_INIT.enabled)setTimeout(async()=>{const r=await autonomousLearningCycle();console.log('[autonomous-learning-startup]',JSON.stringify({ok:r.ok,status:r.status,agent:r.agent,topic:r.topic,provider:r.provider,evidence:r.evidence,accepted:r.accepted,qualityScore:r.qualityScore,candidateStatus:r.candidateStatus}));if(String(process.env.RUN_AGENT_LIVE_TEST||'false').toLowerCase()==='true'){const t=await runLiveAgentComparison({searchWeb,emitEvent,audit,improveWeak:true});console.log('[agent-live-comparison]',JSON.stringify({ok:t.ok,status:t.status,runId:t.runId,tests:t.tests,averageScore:t.averageScore,rankings:t.rankings,improvement:t.improvement}));}},2000);});
if(process.env.RUN_SMOKE_50==='true')setTimeout(()=>runFinPilotSmoke50().catch(e=>console.error('[smoke-50-fatal]',e?.message||e)),1500);
async function runGlobalMarketSmoke(){
 const started=Date.now();const idx=GLOBAL_INDEXES.map(x=>x.symbol);const stocks=GLOBAL_STOCK_TEST_SET.map(x=>x[1]);
 try{await fetchYahooWorldIndexPage()}catch{}
 const test=async(list,concurrency=2)=>{const out=[];let cursor=0;const worker=async()=>{while(true){const i=cursor++;if(i>=list.length)return;try{const x=await liveEquity(list[i]);out[i]={input:list[i],ok:true,symbol:x.symbol,price:x.price,provider:x.provider,live:x.live===true,proxy:Boolean(x.proxy)};}catch(e){out[i]={input:list[i],ok:false,error:e?.message||'error'};}await new Promise(r=>setTimeout(r,250));}};await Promise.all(Array.from({length:concurrency},worker));return out};
 const indices=await test(idx,1); await new Promise(r=>setTimeout(r,1000)); const stockResults=await test(stocks,2);
 console.log('[global-market-smoke]',JSON.stringify({indexes:{total:indices.length,pass:indices.filter(x=>x.ok).length,fail:indices.filter(x=>!x.ok).length,rows:indices},stocks:{total:stockResults.length,pass:stockResults.filter(x=>x.ok).length,fail:stockResults.filter(x=>!x.ok).length,rows:stockResults},elapsedMs:Date.now()-started}));
}
