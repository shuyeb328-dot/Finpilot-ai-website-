import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/money-scenario.js',import.meta.url),'utf8');
const context={window:{}};
vm.runInNewContext(source,context);
const e=context.window.FinpilotMoneyEngine;
assert.equal(typeof e.analyze,'function');
const result=e.analyze({
  risk:40,confidence:72,webSignal:{stance:'Positive'},quantumSignal:{confidence:78},
  executive:{ceoConfidence:76,cfoConfidence:68,judgeConfidence:72,inputs:{market:70,evidence:82,disagreement:8}}
},1000,30);
assert.equal(result.amount,1000);
assert.equal(result.horizon,30);
assert.ok(result.buyProbability>=5&&result.buyProbability<=90);
assert.ok(result.sellProbability>=5&&result.sellProbability<=85);
assert.ok(result.holdProbability>=5&&result.holdProbability<=90);
assert.ok(Math.abs(result.buyProbability+result.sellProbability+result.holdProbability-100)<0.01);
assert.ok(result.estimatedProfit>0);
assert.ok(result.estimatedLoss>0);
assert.ok(result.riskReward>0);
assert.ok(Number.isFinite(result.expectedValue));
console.log('Money scenario tests: PASS');
console.log('₹1000 action:',result.action,'buy',result.buyProbability+'%','sell',result.sellProbability+'%','R:R',result.riskReward+':1');
