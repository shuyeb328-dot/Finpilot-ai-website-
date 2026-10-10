import assert from 'node:assert/strict';
import {OS_REGISTRY,getOSControlPlaneSnapshot,runAutonomousCoreCycle,recordOSControlFeedback,setAutonomousCoreMode,evaluateSecurityRequest,evaluateShadowCandidate,getShadowEvaluationStatus,getAutonomousCoreMode,resetAutonomousCoreForTests} from '../server/autonomous-core.mjs';
resetAutonomousCoreForTests();
assert.equal(OS_REGISTRY.length,19);
assert.ok(OS_REGISTRY.some(x=>x.id==='ai-security-os'));
assert.ok(OS_REGISTRY.some(x=>x.id==='main-core'));
for (const id of ['forecast-learning-os','training-fabric-os','autonomous-research-os','market-stream-hub-os','agent-factory-os','decision-memory-os','unified-workspace-os']) {
 assert.ok(OS_REGISTRY.some(x=>x.id===id), 'central registry must include '+id);
}

const unknown=await getOSControlPlaneSnapshot({});
assert.equal(unknown.ok,true);
assert.equal(unknown.mode,'MONITOR_ONLY');
assert.ok(unknown.os.every(x=>['UNKNOWN','PARTIAL','REVIEW_REQUIRED'].includes(x.status)),'missing telemetry must never appear healthy; missing safety policy must force review');
assert.equal(unknown.os.find(x=>x.id==='trading-risk-os').status,'REVIEW_REQUIRED');
assert.equal(unknown.policy.realMoneyExecution,'BLOCKED');
assert.equal(unknown.operatingLayer.version,'AI-OS-1.0');
assert.equal(unknown.operatingLayer.singleRegistry,true);
assert.equal(unknown.operatingLayer.planes.length,5);
assert.equal(unknown.operatingLayer.automaticPromotion,false);
assert.equal(unknown.operatingLayer.liveTrading,false);

const observations={
 health:{ok:true,frontendSyntax:{ok:true},search:{providerMode:'auto',freeFirst:true}},
 core:{ok:true,uptimeMs:1000,evidenceLedger:10,memoryAgents:12},
 performance:{requests:100,errors:0},
 fleet:{ok:true,scheduler:{failed:0,completed:5,running:0,queue:0}},
 data:{dataQuality:'FRESH',dataQualityScore:95,providers:[{},{}]},
 marketHealth:{providers:[{id:'coinbase',status:'HEALTHY'},{id:'nasdaq-public',status:'HEALTHY'},{id:'binance',status:'DEGRADED'}]},
 learning:{version:'3.3',enabled:false,stats:{cycles:10,evidenceAccepted:20}},
 evolution:{ok:true,evaluations:0,claimedThresholdsMet:0,rejected:0,riskRegressionCount:0},
 policy:{policy:{execution:'HUMAN_APPROVAL_REQUIRED',moneyMovement:'BLOCKED',credentialAccess:'BLOCKED',cfoVeto:'ENFORCED'}},
 security:{ok:true,blocked:0,rateLimited:0,events:[]},quantum:{ok:true,configured:false,backend:'UNCONFIGURED'}
};
const snap=await getOSControlPlaneSnapshot(observations);
assert.equal(snap.os.find(x=>x.id==='main-core').status,'HEALTHY');
assert.equal(snap.os.find(x=>x.id==='core-brain').status,'HEALTHY');
const emptyBrain=await getOSControlPlaneSnapshot({...observations,core:{...observations.core,evidenceLedger:0,memoryAgents:0}});
assert.equal(emptyBrain.os.find(x=>x.id==='core-brain').status,'PARTIAL','Core Brain must not claim healthy while its evidence/memory layers are empty');
assert.match(emptyBrain.os.find(x=>x.id==='core-brain').detail,/not yet established/);
assert.equal(snap.os.find(x=>x.id==='market-data-os').status,'DEGRADED');
assert.equal(snap.os.find(x=>x.id==='trading-risk-os').status,'SAFE_GATED');
assert.equal(snap.os.find(x=>x.id==='ai-security-os').status,'ACTIVE');
assert.equal(snap.os.find(x=>x.id==='learning-os').status,'PARTIAL');
assert.equal(snap.os.find(x=>x.id==='learning-os').metrics.feedbackPersistence,'PROCESS_MEMORY');
assert.match(snap.os.find(x=>x.id==='learning-os').detail,/can be lost on restart/);
assert.equal(snap.os.find(x=>x.id==='evolution-os').status,'READY');
assert.equal(snap.os.find(x=>x.id==='quantum-os').status,'PARTIAL');
const beforeMode=getAutonomousCoreMode();
const cycle=await runAutonomousCoreCycle({...observations,marketHealth:{providers:[{id:'nasdaq-public',status:'DEGRADED'}]},data:{dataQuality:'DEGRADED',dataQualityScore:35}});
assert.equal(cycle.ok,true);
assert.ok(cycle.tasks.some(x=>x.id==='market-feed-review'));
assert.equal(cycle.actionsExecuted.length,0);
assert.equal(getAutonomousCoreMode(),beforeMode);
const task=cycle.tasks.find(x=>x.category==='provider');
assert.ok(task);
const basePriority=task.priorityScore;
const fb=await recordOSControlFeedback({cycleId:cycle.id,taskId:task.id,outcome:'FAILURE',evidence:'The proposed diagnosis did not resolve the observed problem.'});
assert.equal(fb.ok,true);assert.equal(fb.category.samples,1);assert.ok(fb.category.reliability<0.7);
const duplicate=await recordOSControlFeedback({cycleId:cycle.id,taskId:task.id,outcome:'SUCCESS'});
assert.equal(duplicate.ok,false);assert.equal(duplicate.error,'FEEDBACK_ALREADY_RECORDED');
const cycle2=await runAutonomousCoreCycle({...observations,marketHealth:{providers:[{id:'nasdaq-public',status:'DEGRADED'}]},data:{dataQuality:'DEGRADED',dataQualityScore:35}});
const reissued=cycle2.tasks.find(x=>x.category==='provider');
assert.ok(reissued.priorityScore>basePriority,'a poorly performing recommendation category should escalate to review, not silently lose priority');
const successTask=cycle2.tasks.find(x=>x.category==='data-quality');
assert.ok(successTask);
const successFeedback=await recordOSControlFeedback({cycleId:cycle2.id,taskId:successTask.id,outcome:'SUCCESS'});
assert.equal(successFeedback.ok,true);assert.ok(successFeedback.category.reliability>0.7);
assert.equal(setAutonomousCoreMode('FULL_AUTONOMY').ok,false);
assert.equal(setAutonomousCoreMode('SAFE_AUTONOMY').ok,true);assert.equal(getAutonomousCoreMode(),'SAFE_AUTONOMY');
assert.equal(setAutonomousCoreMode('MONITOR_ONLY').ok,true);
for(const action of ['place_order','move_money','disable_security','self_modify_source_code','deploy_production','export_api_key']){
 const v=evaluateSecurityRequest({action,target:'production'});assert.equal(v.allowed,false,action+' must be denied autonomous permission');assert.equal(v.status,'BLOCKED_HUMAN_AUTHORIZATION_REQUIRED');
}
assert.equal(evaluateSecurityRequest({action:'run_health_check'}).allowed,true);
assert.equal(evaluateSecurityRequest({action:'unknown-action'}).allowed,false);
const eligibleShadow=evaluateShadowCandidate({candidateId:'shadow-v2',baselineScore:70,candidateScore:75,samples:25,testsPassed:true,riskRegression:false,evidence:['Held-out test set','No safety regression']});
assert.equal(eligibleShadow.status,'CLAIMED_THRESHOLDS_MET_UNVERIFIED');
assert.equal(eligibleShadow.automaticPromotion,false);
assert.equal(eligibleShadow.productionMutation,false);
assert.equal(eligibleShadow.financialExecution,false);
assert.equal(eligibleShadow.isolatedExecutionPerformed,false);
assert.equal(eligibleShadow.metricsVerified,false);
assert.equal(eligibleShadow.validationMode,'CALLER_SUPPLIED_METADATA_ONLY');
assert.match(eligibleShadow.message,/not proof of a successful shadow run/);
const underSampled=evaluateShadowCandidate({candidateId:'shadow-v3',baselineScore:70,candidateScore:90,samples:4,testsPassed:true,evidence:['small test']});
assert.ok(underSampled.blockers.includes('INSUFFICIENT_SHADOW_SAMPLES'));
const riskRegression=evaluateShadowCandidate({candidateId:'shadow-v4',baselineScore:70,candidateScore:90,samples:100,testsPassed:true,riskRegression:true,evidence:['benchmark']});
assert.ok(riskRegression.blockers.includes('RISK_REGRESSION_DETECTED'));
const missingEvidence=evaluateShadowCandidate({candidateId:'shadow-v5',baselineScore:70,candidateScore:90,samples:100,testsPassed:true});
assert.ok(missingEvidence.blockers.includes('EVIDENCE_REQUIRED'));
const shadowStatus=getShadowEvaluationStatus();
assert.equal(shadowStatus.evaluations,4);
assert.equal(shadowStatus.claimedThresholdsMet,1);
assert.equal(shadowStatus.riskRegressionCount,1);
assert.equal(shadowStatus.metricsVerified,false);
assert.equal(shadowStatus.automaticPromotion,false);
const unknownAdapters=snap.os.filter(x=>x.status==='UNKNOWN');
assert.ok(unknownAdapters.every(x=>x.evidenceLevel==='NONE'),'unknown health adapters must expose zero evidence');
assert.ok(snap.os.every(x=>x.adapter&&x.observedAt),'each OS status must identify its adapter and observation time');
console.log('Autonomous Core OS: registry, health truthfulness, governed cycle, bounded learning and security policy tests passed.');
