/* FinPilot Forecast Evaluation OS
 * Scores only forecasts resolved against a fresh, matching, provider-verified market snapshot.
 * It never fabricates prices, changes a forecast after the fact, or marks heuristic probabilities calibrated.
 */
(function(){
'use strict';
const VERSION='FPE-1.0';
const MAX_LIVE_AGE_MS=90_000;
const FUTURE_TOLERANCE_MS=30_000;
const EPSILON=1e-6;
const DEFAULT_DEADBAND_PCT=0.5;
const finite=n=>n!==null&&n!==undefined&&String(n).trim()!==''&&Number.isFinite(Number(n))?Number(n):null;
const positive=n=>{const v=finite(n);return v!==null&&v>0?v:null;};
const timeMs=n=>{if(n===null||n===undefined||String(n).trim()==='')return null;const v=Date.parse(n);return Number.isFinite(v)?v:null;};
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
function normalizeTicker(v){return String(v||'').trim().toUpperCase().replace(/\.(?:NS|BO)$/,'').replace(/\s+/g,'');}
function exchangeIdentity(ticker,exchange){
  const symbol=String(ticker||'').trim().toUpperCase();
  if(/\.NS$/.test(symbol))return 'NSE';
  if(/\.BO$/.test(symbol))return 'BSE';
  const value=String(exchange||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,' ');
  if(/\b(?:NSE|NSEI|NSE INDIA|NATIONAL STOCK EXCHANGE)\b/.test(value))return 'NSE';
  if(/\b(?:BSE|BSE INDIA|BOMBAY STOCK EXCHANGE)\b/.test(value))return 'BSE';
  if(/\b(?:NMS|NGM|NCM|NASDAQ|NASDAQ GLOBAL SELECT MARKET)\b/.test(value))return 'NASDAQ';
  if(/\b(?:NYQ|NYSE|NEW YORK STOCK EXCHANGE)\b/.test(value))return 'NYSE';
  if(/\b(?:PCX|NYSE ARCA|NYSEARCA)\b/.test(value))return 'NYSE_ARCA';
  if(/\b(?:ASE|AMEX|NYSE AMERICAN)\b/.test(value))return 'AMEX';
  if(/\b(?:LSE|LONDON STOCK EXCHANGE)\b/.test(value))return 'LSE';
  if(/\bBINANCE\b/.test(value))return 'BINANCE';
  return null;
}
function hasExplicitListingIdentity(ticker,exchange){
  return Boolean(/\.(?:NS|BO)$/i.test(String(ticker||''))||exchangeIdentity(ticker,exchange));
}
function normalizeProbabilities(raw){
  if(!raw||typeof raw!=='object')return null;
  const up=finite(raw.up),down=finite(raw.down),hold=finite(raw.hold);
  if([up,down,hold].some(v=>v===null||v<0||v>100))return null;
  const sum=up+down+hold;
  if(!Number.isFinite(sum)||sum<=0)return null;
  return {up:up/sum,down:down/sum,hold:hold/sum};
}
function verifiedSnapshot(snapshot,nowMs=Date.now()){
  const reasons=[];
  if(!snapshot||typeof snapshot!=='object')return {ok:false,reasons:['NO_SNAPSHOT']};
  const quality=snapshot.quality||{},quote=snapshot.quote||{},timing=snapshot.timing||{},instrument=snapshot.instrument||{};
  if(quality.forecastEligible!==true||quality.status!=='VERIFIED_LIVE')reasons.push('SNAPSHOT_NOT_FORECAST_ELIGIBLE');
  if(instrument.symbolMatches!==true||!normalizeTicker(instrument.ticker||instrument.symbol))reasons.push('INSTRUMENT_IDENTITY_NOT_VERIFIED');
  if(positive(quote.price)===null)reasons.push('INVALID_CURRENT_PRICE');
  const asOfMs=timeMs(timing.sourceAsOf);
  if(asOfMs===null)reasons.push('PROVIDER_TIMESTAMP_MISSING');
  const maxAge=Math.min(MAX_LIVE_AGE_MS,Math.max(1_000,finite(timing.maxAgeMs)??MAX_LIVE_AGE_MS));
  if(asOfMs!==null){
    const age=nowMs-asOfMs;
    if(age < -FUTURE_TOLERANCE_MS)reasons.push('PROVIDER_TIMESTAMP_IN_FUTURE');
    if(age > maxAge)reasons.push('CURRENT_QUOTE_STALE');
  }
  if(timing.fresh!==true)reasons.push('SNAPSHOT_FRESHNESS_FLAG_FALSE');
  const instrumentTicker=instrument.ticker||instrument.symbol;
  return {ok:reasons.length===0,reasons,ticker:normalizeTicker(instrumentTicker),exchange:exchangeIdentity(instrumentTicker,instrument.exchange),explicitListingIdentity:hasExplicitListingIdentity(instrumentTicker,instrument.exchange),price:positive(quote.price),sourceAsOf:asOfMs===null?null:new Date(asOfMs).toISOString(),ageMs:asOfMs===null?null:nowMs-asOfMs,provider:String(snapshot.provenance?.provider||'UNKNOWN'),snapshotId:String(snapshot.snapshotId||'')};
}
function scoreForecast(probabilities,outcome){
  const p=normalizeProbabilities(probabilities);
  const key=String(outcome||'').toUpperCase();
  if(!p||!['UP','DOWN','HOLD'].includes(key))return null;
  const actual={UP:0,DOWN:0,HOLD:0};actual[key]=1;
  const brierScore=Object.keys(actual).reduce((sum,k)=>sum+Math.pow(p[k.toLowerCase()]-actual[k],2),0);
  const logLoss=-Math.log(Math.max(EPSILON,p[key.toLowerCase()]));
  const topProbability=Math.max(p.up,p.down,p.hold);
  const predicted=['UP','DOWN','HOLD'].find(k=>p[k.toLowerCase()]===topProbability)||'HOLD';
  return {brierScore:+brierScore.toFixed(8),logLoss:+logLoss.toFixed(8),predictedOutcome:predicted,correctTopClass:predicted===key,probabilities:{up:+p.up.toFixed(8),down:+p.down.toFixed(8),hold:+p.hold.toFixed(8)},scoringMethod:'MULTICLASS_BRIER_SUM_AND_LOG_LOSS'};
}
function summarize(ledger){
  const rows=Array.isArray(ledger)?ledger:[];
  const resolved=rows.filter(x=>x&&x.forecastStatus==='RESOLVED'&&Number.isFinite(Number(x.brierScore))&&Number.isFinite(Number(x.logLoss)));
  const avg=key=>resolved.length?+(resolved.reduce((s,x)=>s+Number(x[key]),0)/resolved.length).toFixed(6):null;
  const count=(fn)=>rows.filter(fn).length;
  const wins=resolved.filter(x=>x.correctTopClass===true).length;
  const eligible=count(x=>x&&x.forecastEligible===true);
  const blocked=count(x=>x&&(x.forecastEligible!==true||String(x.forecastStatus||'').startsWith('BLOCKED')));
  const pending=count(x=>x&&x.forecastEligible===true&&x.forecastStatus==='PENDING_OUTCOME');
  return {
    version:VERSION,total:rows.length,eligible,blocked,pending,resolved:resolved.length,
    meanBrierScore:avg('brierScore'),meanLogLoss:avg('logLoss'),
    topClassAccuracyPct:resolved.length?+(wins/resolved.length*100).toFixed(2):null,
    calibrationStatus:resolved.length<100?'INSUFFICIENT_RESOLVED_OUTCOMES':'READY_FOR_HELD_OUT_CALIBRATION_REVIEW',
    probabilitiesCalibrated:false,
    scoringBasis:'Raw model estimates scored only against later, fresh, matching provider-verified quotes; not proof of profitability.',
    minimumResolvedOutcomesForCalibrationReview:100,
    updatedAt:new Date().toISOString()
  };
}
function resolveMatured(ledger,snapshot,options={}){
  const rows=Array.isArray(ledger)?ledger:[];
  const nowValue=options.now;
  const nowMs=Number.isFinite(Number(nowValue))?Number(nowValue):Date.now();
  const current=verifiedSnapshot(snapshot,nowMs);
  const result={version:VERSION,resolved:0,skipped:0,skippedReasons:[],snapshot:current,summary:null};
  if(!current.ok){
    result.skipped=rows.filter(x=>x&&x.forecastEligible===true&&x.forecastStatus==='PENDING_OUTCOME').length;
    result.skippedReasons=current.reasons;
    result.summary=summarize(rows);
    return result;
  }
  for(const forecast of rows){
    if(!forecast||forecast.forecastStatus!=='PENDING_OUTCOME'||forecast.forecastEligible!==true)continue;
    const forecastTicker=normalizeTicker(forecast.ticker);
    if(!forecastTicker||forecastTicker!==current.ticker){result.skipped++;continue;}
    const forecastExchange=exchangeIdentity(forecast.ticker,forecast.exchange);
    const forecastHasExplicitIdentity=hasExplicitListingIdentity(forecast.ticker,forecast.exchange);
    const currentHasExplicitIdentity=current.explicitListingIdentity;
    // Same company is not the same tradable listing: NSE and BSE prices cannot cross-settle.
    if((forecastExchange&&current.exchange&&forecastExchange!==current.exchange)
      ||((forecastHasExplicitIdentity||currentHasExplicitIdentity)&&forecastExchange!==current.exchange)){
      result.skipped++;
      result.skippedReasons.push('EXCHANGE_IDENTITY_MISMATCH');
      continue;
    }
    const dueMs=timeMs(forecast.dueAt),sourceMs=timeMs(forecast.quoteAsOf);
    if(dueMs===null||sourceMs===null||current.price===null||!(sourceMs<=dueMs&&Date.parse(current.sourceAsOf)>=dueMs)){
      if(dueMs===null||sourceMs===null){forecast.evaluationStatus='BLOCKED_INVALID_FORECAST_TIMING';forecast.evaluationReason='FORECAST_TIMESTAMP_MISSING';}
      result.skipped++;continue;
    }
    const reference=positive(forecast.referencePrice);
    const probabilities=normalizeProbabilities(forecast.probabilities);
    if(reference===null||!probabilities){
      forecast.forecastStatus='BLOCKED_INVALID_FORECAST';
      forecast.evaluationStatus='BLOCKED_INVALID_FORECAST';
      forecast.evaluationReason=reference===null?'REFERENCE_PRICE_INVALID':'PROBABILITIES_INVALID';
      result.skipped++;continue;
    }
    const actualReturnPct=(current.price/reference-1)*100;
    const threshold=clamp(finite(forecast.outcomeThresholdPct)??DEFAULT_DEADBAND_PCT,0,25);
    const outcome=actualReturnPct>=threshold?'UP':actualReturnPct<=-threshold?'DOWN':'HOLD';
    const scored=scoreForecast(forecast.probabilities,outcome);
    if(!scored){result.skipped++;continue;}
    Object.assign(forecast,{
      forecastStatus:'RESOLVED',
      evaluationStatus:'SCORED_UNCALIBRATED_BASELINE',
      realizedOutcome:outcome,
      actualPrice:current.price,
      actualQuoteAsOf:current.sourceAsOf,
      actualReturnPct:+actualReturnPct.toFixed(6),
      outcomeThresholdPct:threshold,
      evaluatedAt:new Date(nowMs).toISOString(),
      evaluationSnapshotId:current.snapshotId||null,
      evaluationProvider:current.provider,
      evaluationQuoteAgeMs:current.ageMs,
      evaluationSource:'FRESH_MATCHING_PROVIDER_VERIFIED_QUOTE',
      ...scored,
      probabilitiesCalibrated:false
    });
    result.resolved++;
  }
  result.summary=summarize(rows);
  return result;
}
window.FinPilotForecastEvaluation={version:VERSION,normalizeTicker,normalizeProbabilities,verifiedSnapshot,scoreForecast,summarize,resolveMatured};
})();
