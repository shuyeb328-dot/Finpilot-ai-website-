import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../public/adaptive-research.js',import.meta.url),'utf8');
const box={window:{}};
new Function('window',src)(box.window);
const R=box.window.FinPilotResearch;
assert.ok(R);
const series=[
 {price:100,momentum:30,quality:80,valuation:75,risk:25},
 {price:105,momentum:35,quality:82,valuation:72,risk:28},
 {price:110,momentum:20,quality:78,valuation:68,risk:30},
 {price:95,momentum:-35,quality:45,valuation:42,risk:75},
 {price:90,momentum:-45,quality:40,valuation:38,risk:80}
];
assert.equal(R.signal(series[0]),'BUY');
assert.equal(R.signal(series[3]),'SELL');
const result=R.backtest(series,{startingCash:100000,maxAllocation:20000});
assert.equal(result.ok,true);
assert.equal(result.observations,5);
assert.ok(Number.isFinite(result.maxDrawdownPct));
const adaptive=R.adaptiveScore({CFO:{outcomes:10,accuracy:70,avgConfidence:72}});
assert.ok(adaptive.score>50);
console.log('Adaptive research tests passed');