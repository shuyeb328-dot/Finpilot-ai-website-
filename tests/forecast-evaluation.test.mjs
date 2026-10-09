import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/forecast-evaluation.js',import.meta.url),'utf8');
const window={};
vm.runInNewContext(source,{window,Date,Math,Number,String,Object,Array,Boolean,JSON});
const api=window.FinPilotForecastEvaluation;
assert.ok(api,'forecast evaluator must export its public API');
assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeProbabilities({up:60,down:20,hold:20}))),{up:0.6,down:0.2,hold:0.2});
assert.equal(api.normalizeProbabilities({up:null,down:null,hold:null}),null,'missing probabilities must not silently become 0');
assert.equal(api.normalizeProbabilities({up:-1,down:20,hold:81}),null,'negative probabilities must be rejected');
assert.equal(api.normalizeProbabilities({up:0,down:0,hold:0}),null,'empty probability mass must be rejected');

const score=api.scoreForecast({up:60,down:20,hold:20},'UP');
assert.equal(score.brierScore,0.24,'multiclass Brier score must use the one-hot realized outcome');
assert.ok(Math.abs(score.logLoss-(-Math.log(0.6)))<1e-8,'log loss must penalize the probability assigned to the realized outcome');
assert.equal(score.predictedOutcome,'UP');
assert.equal(score.correctTopClass,true);
assert.equal(api.scoreForecast({up:null,down:null,hold:null},'UP'),null);

const baseNow=Date.parse('2026-10-09T06:00:00.000Z');
function snapshot({ticker='TCS',price=110,ageMs=30000,quality=true}={}){
  return {
    schemaVersion:1,snapshotId:'ms_test_snapshot',
    instrument:{ticker,symbol:ticker,symbolMatches:true},
    quote:{price},
    timing:{sourceAsOf:new Date(baseNow-ageMs).toISOString(),capturedAt:new Date(baseNow).toISOString(),ageMs,maxAgeMs:120000,fresh:ageMs<=120000},
    provenance:{provider:'Example Verified Provider'},
    quality:{status:quality?'VERIFIED_LIVE':'STALE',forecastEligible:quality}
  };
}
function forecast({id='f1',ticker='TCS',dueAt='2026-10-08T00:00:00.000Z',eligible=true,probabilities={up:60,down:20,hold:20}}={}){
  return {forecastId:id,ticker,forecastEligible:eligible,forecastStatus:eligible?'PENDING_OUTCOME':'BLOCKED_UNVERIFIED_DATA',
    createdAt:'2026-10-01T00:00:00.000Z',dueAt,quoteAsOf:'2026-10-01T00:00:00.000Z',referencePrice:100,
    probabilities,probabilitiesCalibrated:false,outcomeThresholdPct:0.5};
}
const ledger=[
  forecast(),
  forecast({id:'other-symbol',ticker:'RELIANCE'}),
  forecast({id:'not-due',dueAt:'2026-10-10T00:00:00.000Z'}),
  forecast({id:'blocked',eligible:false,probabilities:{up:null,down:null,hold:null}})
];
const result=api.resolveMatured(ledger,snapshot(),{now:baseNow});
assert.equal(result.resolved,1,'only due forecasts for the same ticker and verified snapshot should resolve');
assert.equal(ledger[0].forecastStatus,'RESOLVED');
assert.equal(ledger[0].realizedOutcome,'UP');
assert.equal(ledger[0].actualReturnPct,10);
assert.equal(ledger[0].brierScore,0.24);
assert.equal(ledger[0].probabilitiesCalibrated,false,'outcome scoring must never silently claim calibration');
assert.equal(ledger[0].evaluationSource,'FRESH_MATCHING_PROVIDER_VERIFIED_QUOTE');
assert.equal(ledger[1].forecastStatus,'PENDING_OUTCOME','a different ticker must not resolve the forecast');
assert.equal(ledger[2].forecastStatus,'PENDING_OUTCOME','future-due forecast must remain pending');
assert.equal(ledger[3].forecastStatus,'BLOCKED_UNVERIFIED_DATA','blocked forecasts must not be resolved');
assert.equal(result.summary.resolved,1);
assert.equal(result.summary.probabilitiesCalibrated,false);
assert.equal(result.summary.calibrationStatus,'INSUFFICIENT_RESOLVED_OUTCOMES');

const staleLedger=[forecast({id:'stale'})];
const staleResult=api.resolveMatured(staleLedger,snapshot({ageMs:180000}),{now:baseNow});
assert.equal(staleResult.resolved,0,'stale quote must never score a forecast');
assert.equal(staleLedger[0].forecastStatus,'PENDING_OUTCOME');
assert.ok(staleResult.skippedReasons.includes('CURRENT_QUOTE_STALE'));

const unverifiedLedger=[forecast({id:'unverified'})];
const unverifiedResult=api.resolveMatured(unverifiedLedger,snapshot({quality:false}),{now:baseNow});
assert.equal(unverifiedResult.resolved,0,'unverified snapshots must never score a forecast');
assert.equal(unverifiedLedger[0].forecastStatus,'PENDING_OUTCOME');

const mismatchedSnapshot=snapshot({ticker:'TCS',price:110});
mismatchedSnapshot.instrument.symbolMatches=false;
const identityResult=api.verifiedSnapshot(mismatchedSnapshot,baseNow);
assert.equal(identityResult.ok,false,'snapshot must carry explicit identity verification');
console.log('PASS forecast evaluation: proper scores, verified-only resolution, ticker match, horizon gating and uncalibrated status');
