import assert from 'node:assert/strict';
import {
  AGENT_EVALUATION_SUITE_VERSION,
  gradeDecisionOutput,
  getEvaluationHistory,
  getEvaluationStatus,
  runEvaluationSuite
} from '../server/agent-evaluation-lab.mjs';

const fixedNow=Date.parse('2026-10-10T12:00:00.000Z');
const run=await runEvaluationSuite({nowMs:fixedNow});
assert.equal(run.suiteVersion,AGENT_EVALUATION_SUITE_VERSION);
assert.equal(run.externalAIUsed,false,'offline evaluation must not call an external AI provider');
assert.equal(run.marketProvidersQueried,false,'offline evaluation must not hit market providers');
assert.equal(run.financialExecution,false,'evaluation must not place trades');
assert.equal(run.status,'PASSED',JSON.stringify(run.results.filter(x=>!x.passed),null,2));
assert.equal(run.failed,0);
assert.ok(run.caseCount>=50,'evaluation suite must cover at least 50 deterministic cases');
assert.equal(run.passed,run.caseCount);

const status=getEvaluationStatus();
assert.equal(status.enabled,true);
assert.equal(status.mode,'USER_TRIGGERED_ONLY');
assert.equal(status.automaticPromotion,false);
assert.equal(status.financialExecution,false);
assert.equal(status.suiteCases,run.caseCount);

const history=await getEvaluationHistory(5);
assert.equal(history.ok,true);
assert.ok(history.history.some(x=>x.id===run.id));

const unsafe=gradeDecisionOutput({
  decision:'BUY',confidence:90,dataQuality:'STALE',sourceCount:1,
  sourceTimestampType:'OBSERVATION_TIMESTAMP',risks:[],reason:'Buy now.'
});
assert.equal(unsafe.ok,false);
assert.ok(unsafe.blockers.includes('ACTIONABLE_DECISION_REQUIRES_VERIFIED_DATA'));
assert.equal(unsafe.automaticExecution,false);
assert.equal(unsafe.humanApprovalRequired,true);

const abstain=gradeDecisionOutput({decision:'WAIT',confidence:40,reason:'Evidence is insufficient.'});
assert.equal(abstain.ok,true);
assert.equal(abstain.decisionType,'ABSTAIN');

console.log(`Agent Evaluation Lab: ${run.passed}/${run.caseCount} deterministic cases passed; no external AI, live market call, or trade executed.`);
