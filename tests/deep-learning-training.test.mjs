import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../public/deep-learning-os.js', import.meta.url), 'utf8');
const store = new Map();
const context = {
  window: {},
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  },
  Date, Math, Number, String, Object, Array, JSON, RegExp, Set, Map, Infinity,
  console
};
vm.runInNewContext(source, context);
const api = context.window.FinPilotDeepLearning;
assert.ok(api, 'forecast training API must load');
assert.equal(api.version, 'DLO-1.1');

function snapshot({ticker='MSFT', price=100, asOf=Date.now()-1000, verified=true, snapshotId='snap-1'}={}) {
  const time = new Date(asOf).toISOString();
  return {
    snapshotId,
    requested: {ticker, symbol:ticker},
    instrument: {ticker, symbol:ticker, market:'US_EQUITY', currency:'USD', symbolMatches:true},
    quote: {price, changePct:1.2},
    timing: {sourceAsOf:time, capturedAt:new Date().toISOString(), ageMs:1000, maxAgeMs:120000, fresh:true, providerMarkedLive:true},
    candles: {count:30},
    quality: {status:verified?'VERIFIED_LIVE':'UNVERIFIED_TIMESTAMP_SOURCE', forecastEligible:verified, paperExecutionEligible:verified, reasons:verified?[]:['PROVIDER_TIMESTAMP_REQUIRED']}
  };
}

const invalidState = {income:100,spending:50,emergency:500,evidence:[],transactions:[]};
const blocked = api.runFleet(invalidState,{marketSnapshot:snapshot({verified:false})});
assert.equal(Object.keys(blocked).length, api.agents.length, 'all specialist agents should still run their non-market analysis');
assert.ok(Object.values(blocked).every(row => row.forecast.status === 'BLOCKED_UNVERIFIED_DATA'), 'unverified quote must block direction probabilities');
assert.ok(Object.values(blocked).every(row => row.forecast.probabilities === null), 'never fabricate market probabilities when the quote is unverified');
assert.equal(api.forecastTrainingReport().forecastCount, 0, 'blocked snapshots must not enter the outcome-training sample');

const firstSnapshot = snapshot();
const fleet = api.runFleet(invalidState,{marketSnapshot:firstSnapshot});
assert.equal(Object.keys(fleet).length, api.agents.length, 'preserve all existing finance agents');
assert.ok(Object.values(fleet).every(row => row.forecast.forecastEligible === true), 'a validated provider snapshot should allow research forecasts');
for (const row of Object.values(fleet)) {
  const p=row.forecast.probabilities;
  assert.ok(p && ['up','down','hold'].every(k=>Number.isFinite(Number(p[k]))&&p[k]>=0&&p[k]<=100), 'forecast classes must have bounded probabilities');
  assert.ok(Math.abs(Number(p.up)+Number(p.down)+Number(p.hold)-100)<0.01, 'UP/DOWN/HOLD probabilities must sum to 100');
  assert.equal(row.forecast.probabilitiesCalibrated,false, 'a cold-start agent must never claim calibration');
  assert.equal(row.forecast.calibrationStatus,'INSUFFICIENT_SAMPLE');
}
assert.equal(api.forecastTrainingReport().forecastCount, api.agents.length, 'record one independently scored forecast per agent');
api.runFleet(invalidState,{marketSnapshot:firstSnapshot});
assert.equal(api.forecastTrainingReport().forecastCount, api.agents.length, 'the same snapshot/agent/horizon tuple must not be duplicated');

const pending = api.forecastTrainingReport().agents[0].latestForecast;
assert.equal(pending.forecastStatus,'PENDING_OUTCOME');
assert.equal(pending.horizonDays,1);
const dueAt = Date.parse(pending.dueAt);
const settlementAsOf = dueAt + 1000;
const wrongTicker = snapshot({ticker:'TSLA',price:101,asOf:settlementAsOf,snapshotId:'settle-wrong'});
const notSettled = api.resolveDueForecasts(wrongTicker,{nowMs:settlementAsOf});
assert.equal(notSettled.resolved,0,'a different instrument must never settle the forecast');

const settlement = snapshot({ticker:'MSFT',price:101,asOf:settlementAsOf,snapshotId:'settle-msft'});
const settled = api.resolveDueForecasts(settlement,{nowMs:settlementAsOf});
assert.equal(settled.resolved,api.agents.length,'a fresh, matching quote after the horizon should settle every agent forecast');
const report = api.forecastTrainingReport();
assert.equal(report.resolvedForecasts,api.agents.length);
assert.equal(report.uniqueSettledEvents,1,'multiple agent predictions against one quote should count as one unique market settlement event');
assert.ok(report.agents.every(row=>row.count===1), 'resolved forecasts should produce per-agent metrics');
assert.ok(report.agents.every(row=>row.brier!==null && row.brier>=0 && row.brier<=2), 'multiclass Brier scores must stay in [0,2]');
assert.ok(report.agents.every(row=>row.logLoss!==null && row.logLoss>=0), 'log loss should be computed from the forecast probability assigned to the realized class');
assert.ok(report.agents.every(row=>row.calibrationStatus==='INSUFFICIENT_SAMPLE'&&row.probabilitiesCalibrated===false), 'one outcome must not promote any agent to calibrated');
assert.equal(report.persistence,'BROWSER_LOCAL_STORAGE');
assert.equal(report.realMoneyExecution,false);
assert.ok(report.governance.baseline.includes('chronological walk-forward'), 'benchmark must only use outcomes that predate each forecast');

const staleSnapshot = snapshot({ticker:'MSFT',price:102,asOf:Date.now()-600000,verified:true,snapshotId:'stale'});
const before = report.resolvedForecasts;
const staleAttempt = api.resolveDueForecasts(staleSnapshot);
assert.equal(staleAttempt.resolved,0,'stale provider data cannot settle forecasts');
assert.equal(api.forecastTrainingReport().resolvedForecasts,before,'stale data must not change training outcomes');

console.log('PASS forecast training: verified-only issuance, 100% probability sums, duplicate prevention, exact ticker/horizon settlement, Brier/log-loss, walk-forward baseline, and calibration safeguards');
