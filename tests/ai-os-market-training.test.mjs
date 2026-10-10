import assert from 'node:assert/strict';
import {
 initializeAIOSMarketTrainingDirector,
 runAIOSMarketTrainingCycle,
 getAIOSMarketTrainingStatus,
 resetAIOSMarketTrainingForTests
} from '../server/ai-os-market-training.mjs';

await resetAIOSMarketTrainingForTests();
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
