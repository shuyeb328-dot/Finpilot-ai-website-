import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildMarketSnapshot} from './market-snapshot.mjs';
import {normalizeMarketTick} from './market-tick-contract.mjs';
import {normalizeMarketPicksMarket, resolveMarketPicksUniverse, buildMarketPicksEnvelope} from './market-picks-contract.mjs';
import {evaluateSecurityRequest} from './autonomous-core.mjs';
import {scoreEvidence} from './autonomous-learning.mjs';

export const AGENT_EVALUATION_SUITE_VERSION = '1.0.0';
const MAX_HISTORY = 25;
const MAX_EVIDENCE_ITEMS = 20;
const ACTIONABLE = /\b(long|short|buy|sell|execute|place order|long bias|short bias|buy bias|sell bias)\b/i;
const ABSTENTION = /^(wait|hold|no trade|do not trade|do_not_trade|insufficient evidence|insufficient data|review required|wait for verification)(?:\b|\s|\/)/i;
const VERIFIED_DATA = new Set(['VERIFIED_LIVE','VERIFIED','FRESH_PROVIDER_TIMESTAMP']);
const history = [];
let lastRun = null;
let pool = null;
let schemaReady = false;
let persistenceStatus = process.env.DATABASE_URL ? 'POSTGRES_NOT_YET_VERIFIED' : 'PROCESS_MEMORY';
let persistenceDetail = process.env.DATABASE_URL
  ? 'A database URL is configured; persistence is checked when a run is recorded.'
  : 'No DATABASE_URL is configured; evaluation history is process-memory only and is lost on restart.';

function timestamp(nowMs, deltaMs = 0) {
  return new Date(nowMs + deltaMs).toISOString();
}
function sampleCandles(nowMs) {
  return [
    {time:timestamp(nowMs,-120000),open:100,high:103,low:99,close:102,volume:1000},
    {time:timestamp(nowMs,-60000),open:102,high:104,low:101,close:103,volume:1200}
  ];
}
function sampleQuote(nowMs, overrides = {}) {
  return {
    ticker:'IRFC',symbol:'IRFC',name:'Indian Railway Finance Corporation',
    market:'INDIA_EQUITY',exchange:'NSE',currency:'INR',price:103,
    previous:101,changePct:1.98,dayHigh:104,dayLow:99,live:true,
    asOf:timestamp(nowMs,-30000),sourceTimestampType:'PROVIDER_TIMESTAMP',
    provider:'Evaluation fixture',candles:sampleCandles(nowMs),...overrides
  };
}
function samplePick(nowMs, overrides = {}) {
  return {
    ticker:'AAPL',symbol:'AAPL',name:'Apple',market:'GLOBAL_EQUITY',
    exchange:'NASDAQ',listingExchange:'NASDAQ',score:80,price:200,live:true,
    executionEligible:false,sourceTimestampType:'PROVIDER_TIMESTAMP',
    asOf:timestamp(nowMs,-10000),provider:'Evaluation fixture',...overrides
  };
}
function checkCase(id, domain, description, run) {
  return {id,domain,description,run};
}

export function gradeDecisionOutput(input = {}) {
  const decision = String(input?.decision ?? '').trim().slice(0, 120);
  const confidence = Number(input?.confidence);
  const dataQuality = String(input?.dataQuality ?? 'UNKNOWN').trim().toUpperCase();
  const sourceCount = Number(input?.sourceCount ?? 0);
  const timestampType = String(input?.sourceTimestampType ?? 'UNKNOWN').trim().toUpperCase();
  const evidence = Array.isArray(input?.evidence) ? input.evidence.slice(0, MAX_EVIDENCE_ITEMS) : [];
  const risks = Array.isArray(input?.risks) ? input.risks.filter(x => String(x ?? '').trim()).slice(0, 20) : [];
  const reason = String(input?.reason ?? '').trim().slice(0, 1200);
  const actionable = ACTIONABLE.test(decision) && !ABSTENTION.test(decision);
  const blockers = [];

  if (!decision) blockers.push('DECISION_REQUIRED');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) blockers.push('CONFIDENCE_MUST_BE_0_TO_100');
  if (!reason) blockers.push('DECISION_RATIONALE_REQUIRED');
  if (actionable) {
    if (!VERIFIED_DATA.has(dataQuality)) blockers.push('ACTIONABLE_DECISION_REQUIRES_VERIFIED_DATA');
    if (!Number.isInteger(sourceCount) || sourceCount < 2) blockers.push('TWO_OR_MORE_INDEPENDENT_SOURCES_REQUIRED');
    if (timestampType !== 'PROVIDER_TIMESTAMP') blockers.push('PROVIDER_TIMESTAMP_REQUIRED');
    if (!evidence.some(item => item && typeof item === 'object' && /^https?:\/\//i.test(String(item.url || '')) && String(item.title || item.claim || '').trim())) {
      blockers.push('TRACEABLE_EVIDENCE_REQUIRED');
    }
    if (!risks.length) blockers.push('RISK_DISCLOSURE_REQUIRED');
  }
  return {
    ok: blockers.length === 0,
    version: AGENT_EVALUATION_SUITE_VERSION,
    decision: decision || null,
    decisionType: actionable ? 'ACTIONABLE' : ABSTENTION.test(decision) ? 'ABSTAIN' : 'UNCLASSIFIED',
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? confidence : null,
    blockers,
    automaticExecution: false,
    humanApprovalRequired: true,
    note: 'This is a structural output gate, not a guarantee that a recommendation is financially correct.'
  };
}

function buildCases(nowMs) {
  const good = sampleQuote(nowMs);
  const staleTick = timestamp(nowMs, -8 * 24 * 60 * 60 * 1000);
  const baseTick = {ticker:'BTC',symbol:'BTCUSD',price:83000,high:83500,low:82000,time:timestamp(nowMs,-1000),source:'Pretend Exchange'};
  const india = {ticker:'RELIANCE',symbol:'RELIANCE.NS',market:'INDIA_EQUITY',score:80,price:1200,live:true,executionEligible:false,sourceTimestampType:'PROVIDER_TIMESTAMP',asOf:timestamp(nowMs,-10000),provider:'Fixture'};
  const stale = samplePick(nowMs,{asOf:timestamp(nowMs,-180000),executionEligible:true});
  const goodDecision = {
    decision:'LONG BIAS',confidence:72,dataQuality:'VERIFIED_LIVE',sourceCount:3,
    sourceTimestampType:'PROVIDER_TIMESTAMP',evidence:[{title:'Exchange filing',url:'https://www.nseindia.com/example'}],
    risks:['Price may reverse.'],reason:'Fresh source data agrees and the upside case passes the stated risk threshold.'
  };

  const cases = [
    checkCase('SNAP-01','market-data','Fresh provider-timestamped quote with valid OHLC is eligible',()=>{
      const x=buildMarketSnapshot(good,{requestedTicker:'IRFC',capturedAt:nowMs,maxAgeMs:90000});
      assert.equal(x.quality.status,'VERIFIED_LIVE');assert.equal(x.quality.forecastEligible,true);
    }),
    checkCase('SNAP-02','market-data','Stale quote blocks forecast eligibility',()=>{
      const x=buildMarketSnapshot({...good,asOf:timestamp(nowMs,-180000)},{requestedTicker:'IRFC',capturedAt:nowMs,maxAgeMs:90000});
      assert.equal(x.quality.status,'STALE');assert.equal(x.quality.forecastEligible,false);
    }),
    checkCase('SNAP-03','market-data','Local observation time is not a provider timestamp',()=>{
      const x=buildMarketSnapshot({...good,sourceTimestampType:'OBSERVATION_TIMESTAMP'},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.status,'UNVERIFIED_TIMESTAMP_SOURCE');assert.equal(x.quality.forecastEligible,false);
    }),
    checkCase('SNAP-04','market-data','Missing timestamp provenance fails closed',()=>{
      const {sourceTimestampType,...x}=good;const s=buildMarketSnapshot(x,{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(s.quality.status,'UNVERIFIED_TIMESTAMP_SOURCE');assert.equal(s.quality.forecastEligible,false);
    }),
    checkCase('SNAP-05','market-data','Returned symbol must match requested instrument',()=>{
      const x=buildMarketSnapshot({...good,ticker:'TCS',symbol:'TCS'},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.status,'SYMBOL_MISMATCH');assert.equal(x.quality.forecastEligible,false);
    }),
    checkCase('SNAP-06','market-data','Zero price is rejected',()=>{
      const x=buildMarketSnapshot({...good,price:0},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.status,'INVALID_PRICE');
    }),
    checkCase('SNAP-07','market-data','Non-live quote is never forecast-eligible',()=>{
      const x=buildMarketSnapshot({...good,live:false},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.status,'DELAYED');assert.equal(x.quality.forecastEligible,false);
    }),
    checkCase('SNAP-08','market-data','Missing candle series is explicitly incomplete',()=>{
      const x=buildMarketSnapshot({...good,candles:[]},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.status,'INCOMPLETE_CANDLES');assert.equal(x.quality.forecastEligible,false);
    }),
    checkCase('SNAP-09','market-data','Malformed OHLC rows are rejected and counted',()=>{
      const x=buildMarketSnapshot({...good,candles:[...sampleCandles(nowMs),{time:timestamp(nowMs),open:0,high:2,low:0,close:1,volume:1}]},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.candles.rejectedCount,1);assert.equal(x.quality.forecastEligible,true);
    }),
    checkCase('SNAP-10','market-data','Timestamp too far in the future is rejected',()=>{
      const x=buildMarketSnapshot({...good,asOf:timestamp(nowMs,120000)},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.status,'INVALID_TIMESTAMP');assert.equal(x.quality.forecastEligible,false);
    }),
    checkCase('SNAP-11','market-data','Missing report does not create market evidence',()=>{
      const x=buildMarketSnapshot(null,{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.quality.forecastEligible,false);assert.notEqual(x.quality.status,'VERIFIED_LIVE');
    }),
    checkCase('SNAP-12','market-data','NSE suffix normalizes to same instrument',()=>{
      const x=buildMarketSnapshot(good,{requestedTicker:'IRFC.NS',capturedAt:nowMs});
      assert.equal(x.instrument.symbolMatches,true);
    }),
    checkCase('SNAP-13','market-data','Invalid OHLC high/low relations remove broken candle',()=>{
      const x=buildMarketSnapshot({...good,candles:[...sampleCandles(nowMs),{time:timestamp(nowMs),open:104,high:103,low:99,close:101,volume:1}]},{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.candles.rejectedCount,1);assert.equal(x.candles.count,2);
    }),
    checkCase('SNAP-14','market-data','Quote age is computed from source timestamp',()=>{
      const x=buildMarketSnapshot(good,{requestedTicker:'IRFC',capturedAt:nowMs});
      assert.equal(x.timing.ageMs,30000);
    }),
    checkCase('TICK-01','ingestion','Valid client tick is accepted but remains unverified',()=>{
      const x=normalizeMarketTick(baseTick,nowMs);assert.equal(x.ok,true);assert.equal(x.value.sourceVerified,false);
    }),
    checkCase('TICK-02','ingestion','Claimed provider text cannot prove authenticity',()=>{
      const x=normalizeMarketTick({...baseTick,source:'Trusted Exchange'},nowMs);
      assert.equal(x.ok,true);assert.equal(x.value.sourceVerified,false);assert.match(x.value.source,/unverified/i);
    }),
    checkCase('TICK-03','ingestion','Stale client tick is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,time:staleTick},nowMs);assert.equal(x.ok,false);assert.equal(x.error,'STALE_MARKET_TICK');
    }),
    checkCase('TICK-04','ingestion','Far-future client tick is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,time:timestamp(nowMs,10*60*1000)},nowMs);assert.equal(x.ok,false);assert.equal(x.error,'FUTURE_MARKET_TICK');
    }),
    checkCase('TICK-05','ingestion','Ticker injection is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,ticker:'BTC;DROP TABLE'},nowMs);assert.equal(x.ok,false);
    }),
    checkCase('TICK-06','ingestion','Zero price is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,price:0},nowMs);assert.equal(x.ok,false);assert.equal(x.error,'INVALID_PRICE');
    }),
    checkCase('TICK-07','ingestion','High below last price is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,high:82000},nowMs);assert.equal(x.ok,false);assert.equal(x.error,'HIGH_BELOW_LAST_PRICE');
    }),
    checkCase('TICK-08','ingestion','Low above last price is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,high:85000,low:84000},nowMs);assert.equal(x.ok,false);assert.equal(x.error,'LOW_ABOVE_LAST_PRICE');
    }),
    checkCase('TICK-09','ingestion','Implausible percentage change is rejected',()=>{
      const x=normalizeMarketTick({...baseTick,changePct:10001},nowMs);assert.equal(x.ok,false);assert.equal(x.error,'INVALID_CHANGE_PCT');
    }),
    checkCase('TICK-10','ingestion','Non-object tick payload is rejected',()=>{
      const x=normalizeMarketTick([],nowMs);assert.equal(x.ok,false);assert.equal(x.error,'INVALID_PAYLOAD');
    }),
    checkCase('TICK-11','ingestion','Normalized tick keeps an explicit source timestamp',()=>{
      const x=normalizeMarketTick(baseTick,nowMs);assert.equal(x.value.time,timestamp(nowMs,-1000));
    }),
    checkCase('TICK-12','ingestion','Boolean price cannot be coerced to a valid quote',()=>{
      const x=normalizeMarketTick({...baseTick,price:true},nowMs);assert.equal(x.ok,false);
    }),
    checkCase('SEC-01','security','Allowlisted read-only status action is allowed',()=>{
      const x=evaluateSecurityRequest({action:'refresh_status'});assert.equal(x.allowed,true);assert.equal(x.status,'ALLOWED_BOUNDED_READ_ONLY');
    }),
    checkCase('SEC-02','security','Unknown action is denied by default',()=>{
      const x=evaluateSecurityRequest({action:'read arbitrary file'});assert.equal(x.allowed,false);assert.equal(x.status,'DENIED_NOT_ON_SAFE_ALLOWLIST');
    }),
    checkCase('SEC-03','security','Trade or order action requires human authorization',()=>{
      const x=evaluateSecurityRequest({action:'create_order'});assert.equal(x.allowed,false);assert.equal(x.status,'BLOCKED_HUMAN_AUTHORIZATION_REQUIRED');
    }),
    checkCase('SEC-04','security','Credential access is not allowlisted',()=>{
      const x=evaluateSecurityRequest({action:'api_key_read'});assert.equal(x.allowed,false);
    }),
    checkCase('SEC-05','security','Production deployment cannot be autonomously authorized',()=>{
      const x=evaluateSecurityRequest({action:'deploy production'});assert.equal(x.allowed,false);
    }),
    checkCase('SEC-06','security','Self-modification cannot be autonomously authorized',()=>{
      const x=evaluateSecurityRequest({action:'self_modify'});assert.equal(x.allowed,false);
    }),
    checkCase('SEC-07','security','Safety policy changes are not autonomously authorized',()=>{
      const x=evaluateSecurityRequest({action:'policy_change'});assert.equal(x.allowed,false);
    }),
    checkCase('MARKET-01','task-routing','India market alias normalizes',()=>{
      assert.deepEqual(normalizeMarketPicksMarket('NSE',false),{ok:true,market:'INDIA'});
    }),
    checkCase('MARKET-02','task-routing','US market alias normalizes',()=>{
      assert.deepEqual(normalizeMarketPicksMarket('United States',true),{ok:true,market:'US'});
    }),
    checkCase('MARKET-03','task-routing','Unsupported market is rejected',()=>{
      assert.equal(normalizeMarketPicksMarket('Moon',true).ok,false);
    }),
    checkCase('UNIVERSE-01','task-routing','Explicit universe tickers are deduplicated',()=>{
      const x=resolveMarketPicksUniverse({market:'US',requestedTickers:['aapl',' AAPL ','msft'],indiaTickers:['RELIANCE'],globalStockTestSet:[]});
      assert.deepEqual(x,['AAPL','MSFT']);
    }),
    checkCase('UNIVERSE-02','task-routing','India universe selects Indian registry only',()=>{
      const x=resolveMarketPicksUniverse({market:'INDIA',indiaTickers:['TCS','RELIANCE'],globalStockTestSet:[['United States','AAPL']]});
      assert.deepEqual(x,['TCS','RELIANCE']);
    }),
    checkCase('UNIVERSE-03','task-routing','US universe excludes Indian equities',()=>{
      const x=resolveMarketPicksUniverse({market:'US',indiaTickers:['RELIANCE'],globalStockTestSet:[['United States','AAPL'],['India','TCS']]});
      assert.deepEqual(x,['AAPL']);
    }),
    checkCase('UNIVERSE-04','task-routing','Global default universe excludes India to avoid double mixing',()=>{
      const x=resolveMarketPicksUniverse({market:'GLOBAL',indiaTickers:['RELIANCE'],globalStockTestSet:[['United States','AAPL'],['India','TCS']]});
      assert.deepEqual(x,['AAPL']);
    }),
    checkCase('PICKS-01','market-picks','Fresh provider timestamp is distinct from execution eligibility',()=>{
      const x=buildMarketPicksEnvelope([samplePick(nowMs)],{market:'US',nowMs,maxAgeMs:90000});
      assert.equal(x.live,true);assert.equal(x.executionEligible,false);assert.equal(x.verified,false);
    }),
    checkCase('PICKS-02','market-picks','Stale row cannot claim verified or execution-eligible status',()=>{
      const x=buildMarketPicksEnvelope([stale],{market:'US',nowMs,maxAgeMs:90000});
      assert.equal(x.live,false);assert.equal(x.verified,false);assert.equal(x.executionEligible,false);
    }),
    checkCase('PICKS-03','market-picks','Unknown source timestamp is never replaced with retrieval time',()=>{
      const x=buildMarketPicksEnvelope([{...samplePick(nowMs),asOf:null}],{market:'AUTO',nowMs});
      assert.equal(x.asOf,null);assert.equal(x.live,false);
    }),
    checkCase('PICKS-04','market-picks','Universe filter excludes India from US candidates',()=>{
      const x=buildMarketPicksEnvelope([india,samplePick(nowMs)],{market:'US',nowMs});
      assert.equal(x.candidates.some(row=>row.ticker==='RELIANCE'),false);
    }),
    checkCase('PICKS-05','market-picks','Empty candidate list cannot be live or verified',()=>{
      const x=buildMarketPicksEnvelope([],{market:'US',nowMs});
      assert.equal(x.count,0);assert.equal(x.live,false);assert.equal(x.verified,false);
    }),
    checkCase('GRADE-01','decision-quality','Actionable decision passes only with verified evidence and risk disclosure',()=>{
      assert.equal(gradeDecisionOutput(goodDecision).ok,true);
    }),
    checkCase('GRADE-02','decision-quality','Actionable decision with unknown data is blocked',()=>{
      const x=gradeDecisionOutput({...goodDecision,dataQuality:'UNKNOWN'});assert.equal(x.ok,false);assert.ok(x.blockers.includes('ACTIONABLE_DECISION_REQUIRES_VERIFIED_DATA'));
    }),
    checkCase('GRADE-03','decision-quality','Actionable decision with one source is blocked',()=>{
      const x=gradeDecisionOutput({...goodDecision,sourceCount:1});assert.equal(x.ok,false);assert.ok(x.blockers.includes('TWO_OR_MORE_INDEPENDENT_SOURCES_REQUIRED'));
    }),
    checkCase('GRADE-04','decision-quality','Actionable decision without risk disclosure is blocked',()=>{
      const x=gradeDecisionOutput({...goodDecision,risks:[]});assert.equal(x.ok,false);assert.ok(x.blockers.includes('RISK_DISCLOSURE_REQUIRED'));
    }),
    checkCase('GRADE-05','decision-quality','Invalid confidence is blocked',()=>{
      const x=gradeDecisionOutput({...goodDecision,confidence:101});assert.equal(x.ok,false);assert.ok(x.blockers.includes('CONFIDENCE_MUST_BE_0_TO_100'));
    }),
    checkCase('GRADE-06','decision-quality','Actionable decision without traceable sources is blocked',()=>{
      const x=gradeDecisionOutput({...goodDecision,evidence:[]});assert.equal(x.ok,false);assert.ok(x.blockers.includes('TRACEABLE_EVIDENCE_REQUIRED'));
    }),
    checkCase('GRADE-07','decision-quality','Actionable decision with observation timestamp is blocked',()=>{
      const x=gradeDecisionOutput({...goodDecision,sourceTimestampType:'OBSERVATION_TIMESTAMP'});assert.equal(x.ok,false);assert.ok(x.blockers.includes('PROVIDER_TIMESTAMP_REQUIRED'));
    }),
    checkCase('GRADE-08','decision-quality','WAIT/abstention does not become an actionable recommendation',()=>{
      const x=gradeDecisionOutput({decision:'WAIT',confidence:55,reason:'Evidence is insufficient.'});
      assert.equal(x.ok,true);assert.equal(x.decisionType,'ABSTAIN');assert.equal(x.automaticExecution,false);
    }),
    checkCase('EVIDENCE-01','research-quality','Official regulator evidence has high authority score',()=>{
      const x=scoreEvidence({title:'Official filing',url:'https://www.sec.gov/filing',snippet:'Detailed official filing with balance sheet and risk disclosures.',publishedAt:new Date().toISOString()});
      assert.equal(x.authorityScore,100);assert.ok(x.qualityScore>=80);
    }),
    checkCase('EVIDENCE-02','research-quality','Evidence without publication date is marked unknown-age',()=>{
      const x=scoreEvidence({title:'Article',url:'https://example.com/article',snippet:'A detailed but undated report about markets and risk.'});
      assert.equal(x.freshnessLabel,'UNKNOWN_AGE');
    }),
    checkCase('EVIDENCE-03','research-quality','Publication timestamp produces deterministic live freshness score',()=>{
      const x=scoreEvidence({title:'Current filing',url:'https://www.sec.gov/filing',snippet:'Fresh source data with detailed financial disclosures.',publishedAt:new Date().toISOString()});
      assert.equal(x.freshnessLabel,'LIVE');assert.equal(x.freshnessScore,100);
    }),
    checkCase('EVIDENCE-04','research-quality','Authority score is kept separate from freshness score',()=>{
      const primary=scoreEvidence({title:'Regulator filing',url:'https://www.sec.gov/filing',snippet:'Short official source.',publishedAt:timestamp(nowMs,-24*60*60*1000)});
      const secondary=scoreEvidence({title:'Recent article',url:'https://example.com/article',snippet:'A recent, detailed analysis with risk factors and uncertainty.',publishedAt:new Date().toISOString()});
      assert.equal(primary.authorityScore,100);assert.equal(secondary.authorityScore,55);assert.equal(secondary.freshnessScore,100);
    })
  ];
  return cases;
}

async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (pool) return pool;
  const {default: pg} = await import('pg');
  const Pool = pg.Pool || pg.default?.Pool;
  if (typeof Pool !== 'function') return null;
  pool = new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_SSL==='false' ? false : {rejectUnauthorized:false},
    max:1,idleTimeoutMillis:5000,connectionTimeoutMillis:1500
  });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS finpilot_agent_evaluation_runs (
      id TEXT PRIMARY KEY,
      suite_version TEXT NOT NULL,
      case_count INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    schemaReady = true;
    persistenceStatus = 'POSTGRES';
    persistenceDetail = 'Evaluation run summaries are stored in PostgreSQL.';
    return pool;
  } catch (error) {
    try { await pool.end(); } catch {}
    pool = null;
    schemaReady = false;
    persistenceStatus = 'PROCESS_MEMORY';
    persistenceDetail = 'PostgreSQL is unavailable; history is process-memory only (' + String(error?.message || 'database unavailable').slice(0,100) + ').';
    return null;
  }
}

export async function runEvaluationSuite(options = {}) {
  const rawNow = Number(options.nowMs ?? Date.now());
  const nowMs = Number.isFinite(rawNow) ? rawNow : Date.now();
  const started = Date.now();
  const results = [];
  for (const item of buildCases(nowMs)) {
    const caseStarted = Date.now();
    try {
      item.run();
      results.push({id:item.id,domain:item.domain,description:item.description,passed:true,durationMs:Date.now()-caseStarted,error:null});
    } catch (error) {
      results.push({id:item.id,domain:item.domain,description:item.description,passed:false,durationMs:Date.now()-caseStarted,error:String(error?.message || error).slice(0,300)});
    }
  }
  const passed = results.filter(x=>x.passed).length;
  const failed = results.length-passed;
  const run = {
    id:'eval-'+randomUUID(),
    suiteVersion:AGENT_EVALUATION_SUITE_VERSION,
    scope:'DETERMINISTIC_DATA_CONTRACTS_SECURITY_AND_DECISION_OUTPUT_GATES',
    externalAIUsed:false,marketProvidersQueried:false,financialExecution:false,
    startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString(),
    durationMs:Date.now()-started,caseCount:results.length,passed,failed,
    score:results.length?Math.round(passed/results.length*100):0,
    status:failed===0?'PASSED':'FAILED',
    criticalFailureCount:results.filter(x=>!x.passed&&['market-data','ingestion','security','decision-quality'].includes(x.domain)).length,
    results
  };
  let persisted = false;
  try {
    const db = await getPool();
    if (db) {
      await db.query(
        'INSERT INTO finpilot_agent_evaluation_runs(id,suite_version,case_count,passed,failed,duration_ms,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [run.id,run.suiteVersion,run.caseCount,run.passed,run.failed,run.durationMs,JSON.stringify(run)]
      );
      persisted = true;
    }
  } catch (error) {
    persistenceStatus='PROCESS_MEMORY';
    persistenceDetail='Evaluation ran, but the database insert failed; run history remains process-memory only ('+String(error?.message||'database write failed').slice(0,100)+').';
  }
  run.persisted = persisted;
  run.persistence = persisted?'POSTGRES':'PROCESS_MEMORY';
  run.persistent = persisted;
  history.unshift(run);
  history.splice(MAX_HISTORY);
  lastRun={id:run.id,status:run.status,score:run.score,caseCount:run.caseCount,passed:run.passed,failed:run.failed,completedAt:run.completedAt,persisted};
  return run;
}

export function getEvaluationStatus() {
  return {
    ok:true,version:AGENT_EVALUATION_SUITE_VERSION,enabled:true,
    suiteCases:buildCases(Date.now()).length,scope:'DETERMINISTIC_DATA_CONTRACTS_SECURITY_AND_DECISION_OUTPUT_GATES',
    mode:'USER_TRIGGERED_ONLY',externalAIUsed:false,marketProvidersQueried:false,
    financialExecution:false,automaticPromotion:false,
    lastRun:lastRun?{...lastRun}:null,historyCount:history.length,
    persistence:persistenceStatus,persistent:persistenceStatus==='POSTGRES',
    persistenceDetail
  };
}

export async function getEvaluationHistory(limit = 10) {
  const safeLimit=Math.max(1,Math.min(25,Math.floor(Number(limit)||10)));
  try {
    const db=await getPool();
    if(db&&schemaReady) {
      const q=await db.query('SELECT result FROM finpilot_agent_evaluation_runs ORDER BY created_at DESC LIMIT $1',[safeLimit]);
      return {ok:true,history:q.rows.map(row=>row.result),persistence:'POSTGRES',persistent:true};
    }
  } catch(error) {
    persistenceStatus='PROCESS_MEMORY';
    persistenceDetail='Could not read stored evaluation history; returning process-memory history ('+String(error?.message||'database read failed').slice(0,100)+').';
  }
  return {ok:true,history:history.slice(0,safeLimit),persistence:'PROCESS_MEMORY',persistent:false};
}
