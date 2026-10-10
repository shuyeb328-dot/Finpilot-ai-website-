import assert from 'node:assert/strict';
import {
 initializeAIOSMarketTrainingDirector,
 runAIOSMarketTrainingCycle,
 getAIOSMarketTrainingStatus,
 evaluateForecastBenchmarks,
 normalizeSnapshot,
 resetAIOSMarketTrainingForTests
} from '../server/ai-os-market-training.mjs';

await resetAIOSMarketTrainingForTests();

const validSource = {
  ticker:'BTC',status:'LIVE',verified:true,stale:false,price:100,
  provider:'test-provider',sourceTimestampType:'PROVIDER_TIMESTAMP',
  asOf:new Date(Date.now()-1000).toISOString()
};
assert.equal(normalizeSnapshot('BTC',validSource,Date.now()).ok,true);
const observationOnly=normalizeSnapshot('BTC',{...validSource,sourceTimestampType:'OBSERVATION_TIMESTAMP'},Date.now());
assert.equal(observationOnly.ok,false,'observation time must not be treated as exchange timestamp');
assert.ok(observationOnly.reasons.includes('PROVIDER_TIMESTAMP_PROVENANCE_REQUIRED'));

const forecastRow=(id,index,outcome,probabilities,spacingHours=3,settlementHours=1,ticker='BTC',horizonMinutes=60)=>{
  const base=Date.parse('2026-01-01T00:00:00.000Z')+index*spacingHours*60*60*1000;
  return {
    id,ticker,modelName:'TEST_MODEL',horizonMinutes,
    referenceAsOf:new Date(base).toISOString(),
    settledAt:new Date(base+settlementHours*60*60*1000).toISOString(),
    outcome,pUp:probabilities.UP,pDown:probabilities.DOWN,pHold:probabilities.HOLD
  };
};
const strongRows=['UP','UP','DOWN','UP','HOLD','DOWN','UP'].map((outcome,i)=>{
  const probabilities={UP:10,DOWN:10,HOLD:10};probabilities[outcome]=80;
  return forecastRow('strong-'+i,i,outcome,probabilities);
});
const benchmark=evaluateForecastBenchmarks(strongRows,{minimumPriorOutcomes:2,minimumForModelSelection:5});
assert.equal(benchmark.evaluatedForecasts,7);
assert.equal(benchmark.uniformBaseline.count,7);
assert.equal(benchmark.uniformBaseline.meanBrier,0.666667);
assert.equal(benchmark.uniformBaseline.meanLogLoss,1.098612);
assert.equal(benchmark.uniformBaseline.topClassAccuracyPct,null,'accuracy for a three-way probability tie must be marked not applicable');
assert.equal(benchmark.uniformBaseline.topClassAccuracyTiedCount,7);
assert.equal(benchmark.classCoverage.observed,3);
assert.equal(benchmark.classCoverage.warning,null);

const btcRows=['UP','UP','DOWN','UP','HOLD','DOWN','UP'].map((outcome,i)=>{
  const probabilities={UP:10,DOWN:10,HOLD:10};probabilities[outcome]=80;
  return forecastRow('btc-'+i,i,outcome,probabilities);
});
const mixedTickerRows=[
 ...btcRows,
 forecastRow('eth-early-1',-2,'HOLD',{UP:10,DOWN:10,HOLD:80},3,1,'ETH',60),
 forecastRow('eth-early-2',-1,'HOLD',{UP:10,DOWN:10,HOLD:80},3,1,'ETH',60)
];
const perTickerBenchmark=evaluateForecastBenchmarks(mixedTickerRows,{minimumPriorOutcomes:2,minimumForModelSelection:5});
assert.equal(perTickerBenchmark.rollingPriorBaseline.count,4,'outcomes from ETH must not enter the BTC rolling prior');
assert.equal(perTickerBenchmark.currentVsRollingPrior.sampleCount,4);

const differentHorizonRows=[
 ...btcRows,
 forecastRow('btc-short-1',-2,'HOLD',{UP:10,DOWN:10,HOLD:80},3,1,'BTC',15),
 forecastRow('btc-short-2',-1,'HOLD',{UP:10,DOWN:10,HOLD:80},3,1,'BTC',15)
];
const perHorizonBenchmark=evaluateForecastBenchmarks(differentHorizonRows,{minimumPriorOutcomes:2,minimumForModelSelection:5});
assert.equal(perHorizonBenchmark.rollingPriorBaseline.count,4,'15-minute outcomes must not be mixed into the 60-minute rolling prior');

const holdOnlyRows=Array.from({length:30},(_,i)=>forecastRow('hold-only-'+i,i,'HOLD',{UP:30,DOWN:30,HOLD:40}));
const holdOnlyBenchmark=evaluateForecastBenchmarks(holdOnlyRows,{minimumForModelSelection:30});
assert.equal(holdOnlyBenchmark.classCoverage.observed,1);
assert.equal(holdOnlyBenchmark.classCoverage.status,'ONE_CLASS_ONLY');
assert.ok(holdOnlyBenchmark.classCoverage.warning.includes('Only 1 of 3 outcome classes'));
assert.equal(holdOnlyBenchmark.modelSelectionStatus,'INSUFFICIENT_CLASS_DIVERSITY','even a 30-row sample is not enough when it contains one outcome class');
assert.match(holdOnlyBenchmark.reason,/do not tune or promote/);
assert.ok(benchmark.currentModel.meanBrier<benchmark.uniformBaseline.meanBrier);
assert.ok(benchmark.currentModel.meanLogLoss<benchmark.uniformBaseline.meanLogLoss);
assert.equal(benchmark.rollingPriorBaseline.count,4,'rolling prior uses only outcomes settled before each forecast timestamp and requires three prior outcomes');
assert.equal(benchmark.currentVsRollingPrior.sampleCount,4);
assert.equal(benchmark.probabilitiesCalibrated,false);
assert.equal(benchmark.promotionEligible,false);
assert.equal(benchmark.automaticPromotion,false);
assert.match(benchmark.modelSelectionStatus,/INSUFFICIENT_OUTCOMES/,'small samples must never reach model-selection review');

const weakRows=['UP','DOWN','HOLD','UP','DOWN','HOLD'].map((outcome,i)=>{
 const probabilities={UP:10,DOWN:80,HOLD:10};
 if(outcome==='DOWN'){probabilities.UP=80;probabilities.DOWN=10;}
 if(outcome==='HOLD'){probabilities.UP=80;probabilities.DOWN=10;probabilities.HOLD=10;}
 return forecastRow('weak-'+i,i,outcome,probabilities);
});
const weak=evaluateForecastBenchmarks(weakRows);
assert.equal(weak.currentVsUniform.underperforms,true,'bad predictions must be flagged against the uniform baseline');
assert.equal(weak.promotionEligible,false);

const noLeakage=evaluateForecastBenchmarks([
 forecastRow('overlap-1',0,'UP',{UP:80,DOWN:10,HOLD:10},1,2),
 forecastRow('overlap-2',1,'DOWN',{UP:10,DOWN:80,HOLD:10},1,2)
],{minimumPriorOutcomes:1});
assert.equal(noLeakage.rollingPriorBaseline.count,0,'an outcome that settles after the next forecast reference timestamp must not leak into its baseline');

const invalidVector=evaluateForecastBenchmarks([
 forecastRow('valid',0,'UP',{UP:80,DOWN:10,HOLD:10}),
 {...forecastRow('invalid',1,'UP',{UP:80,DOWN:10,HOLD:10}),pHold:0}
]);
assert.equal(invalidVector.evaluatedForecasts,1,'invalid probability vectors must be excluded from benchmark scoring');


let clockMs = Date.now();
let index = 0;
let repeatLast = false;
let lastSnapshot = null;
let staleMode = false;
const prices = [100, 101, 102, 104];
const loadSnapshot = async ticker => {
  if (repeatLast && lastSnapshot) return lastSnapshot;
  index++;
  const price = prices[Math.min(index - 1, prices.length - 1)];
  const asOf = new Date(clockMs - (staleMode ? 600000 : 1000)).toISOString();
  lastSnapshot = {
    ticker,
    status: staleMode ? 'STALE' : 'LIVE',
    verified: !staleMode,
    stale: staleMode,
    price,
    changePct: 1.1,
    volume: 1234,
    provider: 'test-provider',
    sourceTimestampType: 'PROVIDER_TIMESTAMP',
    asOf
  };
  return lastSnapshot;
};

const env = {
  FINPILOT_AI_OS_TRAINING_ENABLED: 'true',
  FINPILOT_AI_OS_TRAINING_WATCHLIST: 'BTC',
  FINPILOT_AI_OS_TRAINING_INTERVAL_MS: '300000',
  FINPILOT_AI_OS_FORECAST_HORIZON_MINUTES: '15'
};
const initial = await initializeAIOSMarketTrainingDirector({ env, loadSnapshot, clock: () => clockMs });
assert.equal(initial.requestedEnabled, true);
assert.equal(initial.enabled, false, 'background learning must not start without durable storage');
assert.equal(initial.persistent, false);
assert.equal(initial.blockedReason, 'PERSISTENT_STORAGE_REQUIRED');
assert.equal(initial.requiresAlwaysOnWorkerFor24x7, true);

const first = await runAIOSMarketTrainingCycle({ trigger: 'test' });
assert.equal(first.ok, true);
assert.equal(first.summary.accepted, 1);
assert.equal(first.summary.forecastsCreated, 0, 'baseline needs a minimum history before forecasting');
clockMs += 60_000;

const second = await runAIOSMarketTrainingCycle({ trigger: 'test' });
assert.equal(second.summary.accepted, 1);
assert.equal(second.summary.forecastsCreated, 0);
clockMs += 60_000;

const third = await runAIOSMarketTrainingCycle({ trigger: 'test' });
assert.equal(third.summary.accepted, 1);
assert.equal(third.summary.forecastsCreated, 1, 'forecast should be created only after sufficient prior observations');

let status = await getAIOSMarketTrainingStatus();
assert.equal(status.persistence, 'PROCESS_MEMORY');
assert.equal(status.persistent, false);
assert.equal(status.observationCount, 3);
assert.equal(status.forecastCount, 1);
assert.equal(status.pendingForecastCount, 1);
assert.equal(status.resolvedForecastCount, 0);
assert.equal(status.probabilitiesCalibrated, false);
assert.equal(status.foundationModelTraining, false);
assert.equal(status.realMoneyExecution, false);
assert.equal(status.automaticPromotion, false);

clockMs += 16 * 60_000;
const fourth = await runAIOSMarketTrainingCycle({ trigger: 'test-settlement' });
assert.equal(fourth.summary.accepted, 1);
assert.equal(fourth.summary.forecastsSettled, 1, 'a later timestamped quote must settle the due forecast');
status = await getAIOSMarketTrainingStatus();
assert.equal(status.resolvedForecastCount, 1);
assert.equal(status.pendingForecastCount, 1, 'a later observation can resolve one forecast and create the next');
assert.ok(Number.isFinite(status.meanBrierScore));
assert.ok(Number.isFinite(status.meanLogLoss));
assert.equal(status.topClassAccuracyPct, 100);
assert.equal(status.benchmark.evaluatedForecasts,1);
assert.equal(status.benchmark.uniformBaseline.meanBrier,0.666667);
assert.equal(status.benchmark.promotionEligible,false);
assert.equal(status.calibrationStatus,'INSUFFICIENT_RESOLVED_OUTCOMES');

repeatLast = true;
const duplicate = await runAIOSMarketTrainingCycle({ trigger: 'test-duplicate' });
assert.equal(duplicate.summary.duplicates, 1);
status = await getAIOSMarketTrainingStatus();
assert.equal(status.counters.duplicateObservations, 1);
assert.equal(status.observationCount, 4, 'duplicate timestamps must not inflate the observation history');

repeatLast = false;
staleMode = true;
const stale = await runAIOSMarketTrainingCycle({ trigger: 'test-stale' });
assert.equal(stale.summary.rejected, 1, 'stale/unverified source snapshots must be rejected');
status = await getAIOSMarketTrainingStatus();
assert.equal(status.counters.rejectedSnapshots, 1);
assert.equal(status.observationCount, 4, 'a stale quote must not enter the learning set');

await resetAIOSMarketTrainingForTests();
console.log('PASS AI OS Market Training: verified-only observations, duplicate protection, historical baseline, horizon settlement, Brier/log-loss scoring, explicit memory-only and no-execution guards');
