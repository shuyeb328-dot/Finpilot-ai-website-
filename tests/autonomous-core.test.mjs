import assert from 'node:assert/strict';
import {OS_REGISTRY,getOSControlPlaneSnapshot,runAutonomousCoreCycle,recordOSControlFeedback,setAutonomousCoreMode,evaluateSecurityRequest,getAutonomousCoreMode,resetAutonomousCoreForTests} from '../server/autonomous-core.mjs';
resetAutonomousCoreForTests();
assert.equal(OS_REGISTRY.length,12);
assert.ok(OS_REGISTRY.some(x=>x.id==='ai-security-os'));
assert.ok(OS_REGISTRY.some(x=>x.id==='main-core'));
const unknown=await getOSControlPlaneSnapshot({});
assert.equal(unknown.ok,true);
assert.equal(unknown.mode,'MONITOR_ONLY');
assert.ok(unknown.os.every(x=>x.status==='UNKNOWN'||x.status==='PARTIAL'));
assert.equal(unknown.policy.realMoneyExecution,'BLOCKED');
const observations={
 health:{ok:true,frontendSyntax:{ok:true},search:{providerMode:'auto',freeFirst:true}},
 core:{ok:true,uptimeMs:1000,evidenceLedger:10,memoryAgents:12},
 performance:{requests:100,errors:0},
 fleet:{ok:true,scheduler:{failed:0,completed:5,running:0,queue:0}},
 data:{dataQuality:'FRESH',dataQualityScore:95,providers:[{},{}]},
 marketHealth:{providers:[{id:'coinbase',status:'HEALTHY'},{id:'nasdaq-public',status:'HEALTHY'},{id:'binance',status:'DEGRADED'}]},
 learning:{version:'3.3',enabled:false,stats:{cycles:10,evidenceAccepted:20}},
 policy:{policy:{execution:'HUMAN_APPROVAL_REQUIRED',moneyMovement:'BLOCKED',credentialAccess:'BLOCKED',cfoVeto:'ENFORCED'}},
 security:{ok:true,blocked:0,rateLimited:0,events:[]},quantum:{ok:true}
};
const snap=await getOSControlPlaneSnapshot(observations);
assert.equal(snap.os.find(x=>x.id==='main-core').status,'HEALTHY');
assert.equal(snap.os.find(x=>x.id==='market-data-os').status,'DEGRADED');
assert.equal(snap.os.find(x=>x.id==='trading-risk-os').status,'SAFE_GATED');
assert.equal(snap.os.find(x=>x.id==='ai-security-os').status,'ACTIVE');
assert.equal(snap.os.find(x=>x.id==='learning-os').status,'IDLE');
const beforeMode=getAutonomousCoreMode();
const cycle=await runAutonomousCoreCycle({...observations,marketHealth:{providers:[{id:'nasdaq-public',status:'DEGRADED'}]},data:{dataQuality:'DEGRADED',dataQualityScore:35}});
assert.equal(cycle.ok,true);
assert.ok(cycle.tasks.some(x=>x.id==='market-feed-review'));
assert.equal(cycle.actionsExecuted.length,0);
assert.equal(getAutonomousCoreMode(),beforeMode);
const task=cycle.tasks[0];
const fb=await recordOSControlFeedback({cycleId:cycle.id,taskId:task.id,outcome:'SUCCESS',evidence:'Operator verified after bounded diagnostic.'});
assert.equal(fb.ok,true);assert.equal(fb.category.samples,1);assert.ok(fb.category.reliability>0.7);
const duplicate=await recordOSControlFeedback({cycleId:cycle.id,taskId:task.id,outcome:'SUCCESS'});
assert.equal(duplicate.ok,false);assert.equal(duplicate.error,'FEEDBACK_ALREADY_RECORDED');
assert.equal(setAutonomousCoreMode('FULL_AUTONOMY').ok,false);
assert.equal(setAutonomousCoreMode('SAFE_AUTONOMY').ok,true);assert.equal(getAutonomousCoreMode(),'SAFE_AUTONOMY');
assert.equal(setAutonomousCoreMode('MONITOR_ONLY').ok,true);
for(const action of ['place_order','move_money','disable_security','self_modify_source_code','deploy_production','export_api_key']){
 const v=evaluateSecurityRequest({action,target:'production'});assert.equal(v.allowed,false,action+' must be denied autonomous permission');assert.equal(v.status,'BLOCKED_HUMAN_AUTHORIZATION_REQUIRED');
}
assert.equal(evaluateSecurityRequest({action:'run_health_check'}).allowed,true);
assert.equal(evaluateSecurityRequest({action:'unknown-action'}).allowed,false);
console.log('Autonomous Core OS: registry, health truthfulness, governed cycle, bounded learning and security policy tests passed.');
