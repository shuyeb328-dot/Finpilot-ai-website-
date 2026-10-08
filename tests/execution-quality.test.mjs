import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/paper-engine.js',import.meta.url),'utf8');
const context={window:{},Date,Math,Number,String,Boolean,Object,Array,JSON,console};
vm.runInNewContext(source,context);
const core=context.window.FinPilotPaperCore;
assert.equal(typeof core.executionQualityReport,'function');
const state={};core.ensure(state);core.ensureAgent(state.paperTrading,{id:'qa',name:'QA Agent'});
const order=core.paperOrder(state,'qa','TEST','BUY',2,51,'fixture');
Object.assign(order,{quoteBid:49,quoteAsk:51,avgFillPrice:51,executionLatencyMs:50,marketImpactBps:1,quoteAgeSec:1,executionEligible:true,filledQty:2});
const report=core.executionQualityReport(state);
assert.equal(report.fills,1);assert.equal(report.scoredFills,1);assert.equal(report.rows[0].adverseSlippageBps,200);assert.equal(report.governance.autoPromotion,false);assert.equal(report.virtualOnly,true);
console.log('Execution Quality Intelligence tests passed');


// Agent recommendation -> paper outcome attribution is governed and virtual-only.
{
  const state={};
  core.ensure(state);
  core.ensureAgent(state.paperTrading,{id:'qa',name:'QA Agent',role:'Test'});
  const decision=core.recordDecision(state,'qa','TEST','BUY',{confidence:88,edge:74,source:'TEST'});
  assert.equal(decision.action,'BUY');
  const o=core.paperOrder(state,'qa','TEST','BUY',2,51,'linked decision',{decisionId:decision.id});
  Object.assign(o,{quoteBid:50,quoteAsk:51,avgFillPrice:51,executionLatencyMs:45,marketImpactBps:1,quoteAgeSec:1,executionEligible:true,filledQty:2});
  const report=core.agentExecutionOutcomeReport(state);
  assert.equal(report.agents.length,1);
  assert.equal(report.agents[0].decisionLinked,1);
  assert.equal(report.agents[0].scoredFills,1);
  assert.equal(report.governance.autoPromotion,false);
  assert.equal(report.virtualOnly,true);
}
{
  const state={};
  core.ensure(state);
  const a=core.ensureAgent(state.paperTrading,{id:'qa2',name:'Round Agent',role:'Test'});
  const round=core.roundTable(state,{symbol:'TEST',price:50,momentum:40,quality:80,valuation:75,risk:25,evidence:90});
  assert.ok(round.id);
  assert.ok(state.paperTrading.decisionLedger.some(d=>d.roundId===round.id&&d.agentId===a.id));
}
