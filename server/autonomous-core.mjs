import pg from 'pg';

const {Pool}=pg;
const MAX_HISTORY=160;
const MAX_FEEDBACK=500;
const ALLOWED_MODES=new Set(['MONITOR_ONLY','SAFE_AUTONOMY']);
const VALID_OUTCOMES=new Set(['SUCCESS','FAILURE','FALSE_POSITIVE','INCONCLUSIVE']);
const SAFE_ACTIONS=new Set(['health_check','run_health_check','refresh_status','read_only_diagnostic','analyze_logs','record_feedback','benchmark_candidate']);

export const OS_REGISTRY=[
 {id:'main-core',name:'Main Core OS',domain:'ORCHESTRATION',criticality:'CRITICAL',dependencies:['core-brain','ai-security-os'],description:'Coordinates evidence, tasks and governed decisions.',signal:'core'},
 {id:'core-brain',name:'Core Brain',domain:'REASONING',criticality:'HIGH',dependencies:['data-os','agent-mesh'],description:'Decision memory, evidence fusion and task routing.',signal:'brain'},
 {id:'agent-mesh',name:'Agent Mesh OS',domain:'AGENTS',criticality:'HIGH',dependencies:['main-core','ai-security-os'],description:'Specialist-agent scheduling and event-driven routing.',signal:'fleet'},
 {id:'data-os',name:'Data OS',domain:'DATA',criticality:'HIGH',dependencies:[],description:'Tracks connected data quality and provider freshness.',signal:'data'},
 {id:'market-data-os',name:'Market Data OS',domain:'MARKETS',criticality:'CRITICAL',dependencies:['data-os','ai-security-os'],description:'Provider health, provenance, freshness and quote safety.',signal:'market'},
 {id:'learning-os',name:'Learning OS',domain:'LEARNING',criticality:'MEDIUM',dependencies:['main-core','ai-security-os'],description:'Research, outcome measurement and bounded feedback adaptation.',signal:'learning'},
 {id:'foundation-os',name:'Foundation OS',domain:'GOVERNANCE',criticality:'HIGH',dependencies:['main-core'],description:'Shared governance and release-check contracts.',signal:'foundation'},
 {id:'evolution-os',name:'Evolution OS',domain:'IMPROVEMENT',criticality:'HIGH',dependencies:['learning-os','ai-security-os'],description:'Shadow evaluation and promotion-gated improvement proposals.',signal:'evolution'},
 {id:'quantum-os',name:'Quantum OS',domain:'ROUTING',criticality:'HIGH',dependencies:['agent-mesh','main-core'],description:'Agent routing and decision synthesis.',signal:'quantum'},
 {id:'trading-risk-os',name:'Trading & Risk OS',domain:'EXECUTION_GOVERNANCE',criticality:'CRITICAL',dependencies:['market-data-os','ai-security-os'],description:'Risk veto, quote-quality checks and human approval gates.',signal:'policy'},
 {id:'ai-security-os',name:'AI Security OS',domain:'SECURITY',criticality:'CRITICAL',dependencies:['main-core'],description:'Least-privilege policy checks, security events and containment recommendations.',signal:'security'},
 {id:'research-search-os',name:'Research & Search OS',domain:'RESEARCH',criticality:'MEDIUM',dependencies:['data-os','ai-security-os'],description:'Research and search readiness without treating retrieved content as instructions.',signal:'search'}
];

const state={version:'1.0.0',mode:'MONITOR_ONLY',cycleCount:0,lastCycle:null,lastFeedbackAt:null,recentCycles:[],feedback:[],categories:{},persistence:'PROCESS_MEMORY',persistenceDetail:'Outcome feedback is held in this server process unless DATABASE_URL persistence is available.',persistenceAttempted:false};
let pool=null,storePromise=null;
const now=()=>new Date().toISOString();
const clean=(v,n=200)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):min));

function categoryState(category){
 const key=clean(category,48).toLowerCase()||'general';
 if(!state.categories[key])state.categories[key]={samples:0,successes:0,failures:0,falsePositives:0,reliability:0.70,lastOutcome:null,lastUpdated:null};
 return state.categories[key];
}
function applyFeedback(record){
 const c=categoryState(record.category),outcome=String(record.outcome||'INCONCLUSIVE');
 const target=outcome==='SUCCESS'?1:outcome==='FAILURE'?0:outcome==='FALSE_POSITIVE'?0.35:0.5;
 c.samples++;if(outcome==='SUCCESS')c.successes++;if(outcome==='FAILURE')c.failures++;if(outcome==='FALSE_POSITIVE')c.falsePositives++;
 c.reliability=clamp(c.reliability*0.8+target*0.2,0.25,0.98);
 c.lastOutcome=outcome;c.lastUpdated=record.createdAt||now();
 state.feedback.unshift(record);state.feedback=state.feedback.slice(0,MAX_FEEDBACK);state.lastFeedbackAt=record.createdAt||now();
}
async function ensurePersistence(){
 if(storePromise)return storePromise;
 if(state.persistenceAttempted)return;
 state.persistenceAttempted=true;
 storePromise=(async()=>{
  if(!process.env.DATABASE_URL){state.persistence='PROCESS_MEMORY';state.persistenceDetail='No DATABASE_URL configured; learned outcomes remain in process memory.';return}
  try{
   pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1,idleTimeoutMillis:5000,connectionTimeoutMillis:1400});
   await pool.query('CREATE TABLE IF NOT EXISTS finpilot_os_learning_events (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), event JSONB NOT NULL)');
   const q=await pool.query('SELECT event FROM finpilot_os_learning_events ORDER BY id DESC LIMIT 500');
   state.feedback=[];state.categories={};
   for(const e of q.rows.map(x=>x.event).reverse())applyFeedback(e);
   state.persistence='POSTGRES';state.persistenceDetail='Outcome journal restored from PostgreSQL.';
  }catch(e){
   state.persistence='PROCESS_MEMORY';state.persistenceDetail='Database persistence unavailable; operating in process-memory mode ('+clean(e?.message||'database unavailable',100)+').';
   try{await pool?.end()}catch{}pool=null;
  }
 })();
 return storePromise;
}
async function persistFeedback(record){
 await ensurePersistence();
 if(!pool||state.persistence!=='POSTGRES')return false;
 try{await pool.query('INSERT INTO finpilot_os_learning_events(created_at,event) VALUES($1,$2::jsonb)',[record.createdAt,JSON.stringify(record)]);return true}
 catch(e){state.persistence='PROCESS_MEMORY';state.persistenceDetail='Database write failed; continuing with process-memory feedback only.';try{await pool.end()}catch{}pool=null;return false}
}

function checkStatus(signal,obs){
 if(signal==='core'){
  const x=obs.core;if(!x?.ok)return {status:'UNKNOWN',detail:'Core runtime telemetry has not been verified.'};
  const errors=Number(obs.performance?.errors||0),requests=Number(obs.performance?.requests||0);
  return {status:errors>10&&requests>0&&errors/requests>.2?'DEGRADED':'HEALTHY',detail:'Core API observed; '+Number(x.evidenceLedger||0)+' evidence records and '+Number(x.memoryAgents||0)+' memory agents.',metrics:{uptimeMs:Number(x.uptimeMs||0),evidenceLedger:Number(x.evidenceLedger||0),memoryAgents:Number(x.memoryAgents||0)}};
 }
 if(signal==='brain'){
  const x=obs.core;if(!x?.ok)return {status:'UNKNOWN',detail:'Core Brain runtime telemetry has not been verified.'};
  const evidenceLedger=Number(x.evidenceLedger||0),memoryAgents=Number(x.memoryAgents||0);
  const status=evidenceLedger>0&&memoryAgents>0?'HEALTHY':'PARTIAL';
  return {status,detail:status==='HEALTHY'?'Decision memory and evidence ledger are populated.':'Core API is responding, but evidence ledger ('+evidenceLedger+') or memory agents ('+memoryAgents+') are empty; reasoning readiness is not yet established.',metrics:{evidenceLedger,memoryAgents}};
 }
 if(signal==='fleet'){
  const f=obs.fleet;if(!f?.ok)return {status:'UNKNOWN',detail:'Agent fleet endpoint has not been verified.'};
  const failed=Number(f.scheduler?.failed||0),completed=Number(f.scheduler?.completed||0),running=Number(f.scheduler?.running||0),queued=Number(f.scheduler?.queue||0);
  return {status:failed>=5&&failed>completed?'DEGRADED':running||queued?'ACTIVE':'READY',detail:running+' running · '+queued+' queued · '+failed+' failed.',metrics:{running,queued,completed,failed}};
 }
 if(signal==='data'){
  const x=obs.data;if(!x?.dataQuality)return {status:'UNKNOWN',detail:'Data quality has not been measured in this process.'};
  const quality=String(x.dataQuality).toUpperCase(),statuses={FRESH:'HEALTHY',DEGRADED:'DEGRADED',STALE:'DEGRADED',UNKNOWN:'UNKNOWN'};
  return {status:statuses[quality]||'UNKNOWN',detail:quality+' · score '+Number(x.dataQualityScore||0)+'/100.',metrics:{quality,score:Number(x.dataQualityScore||0),providers:Array.isArray(x.providers)?x.providers.length:0}};
 }
 if(signal==='market'){
  const p=obs.marketHealth?.providers||[];if(!p.length)return {status:'UNKNOWN',detail:'No provider health observations are available yet.'};
  const healthy=p.filter(x=>String(x.status).toUpperCase()==='HEALTHY').length;
  const degraded=p.filter(x=>['DEGRADED','STALE','FAILED'].includes(String(x.status).toUpperCase())).length;
  const unknown=p.filter(x=>String(x.status).toUpperCase()==='UNKNOWN').length;
  return {status:healthy===0?(degraded?'DEGRADED':'UNKNOWN'):degraded?'DEGRADED':'HEALTHY',detail:healthy+' healthy · '+degraded+' degraded · '+unknown+' unknown providers.',metrics:{healthy,degraded,unknown,total:p.length},note:'Provider reachability does not imply that each quote is live or execution-eligible.'};
 }
 if(signal==='learning'){
  const x=obs.learning;if(!x||!x.version)return {status:'UNKNOWN',detail:'Learning OS status is unavailable.'};
  const enabled=Boolean(x.enabled),failed=Boolean(x.lastError);
  return {status:failed?'DEGRADED':enabled?'ACTIVE':'IDLE',detail:failed?clean(x.lastError,140):enabled?'Governed research loop enabled; agent mutation remains gated.':'Learning engine available; background research is currently disabled.',metrics:{enabled,cycles:Number(x.stats?.cycles||x.cycles||0),evidenceAccepted:Number(x.stats?.evidenceAccepted||0)}};
 }
 if(signal==='foundation'){
  const x=obs.health?.frontendSyntax;
  return x?.ok?{status:'PARTIAL',detail:'Server/frontend syntax checks pass. Browser foundation benchmark must be measured client-side.'}:{status:'UNKNOWN',detail:'Foundation runtime telemetry is not available.'};
 }
 if(signal==='evolution'){
  return obs.learning?.version?{status:'PARTIAL',detail:'Governed learning is connected. Candidate promotion still requires shadow benchmarks and explicit gates.'}:{status:'UNKNOWN',detail:'Evolution gate telemetry unavailable.'};
 }
 if(signal==='quantum'){
  return obs.quantum?.ok?{status:'ACTIVE',detail:'Quantum routing endpoint responded; review its decision and guard metrics.'}:{status:'PARTIAL',detail:'Quantum OS is present in the browser; a server-side health signal is not yet exposed in this snapshot.'};
 }
 if(signal==='policy'){
  const x=obs.policy?.policy,safe=Boolean(x&&x.execution==='HUMAN_APPROVAL_REQUIRED'&&x.moneyMovement==='BLOCKED'&&x.credentialAccess==='BLOCKED'&&x.cfoVeto==='ENFORCED');
  return safe?{status:'SAFE_GATED',detail:'Human approval, money-movement block, credential isolation and CFO veto are enforced.'}:{status:'REVIEW_REQUIRED',detail:'Policy contract is missing required controls; do not enable execution.'};
 }
 if(signal==='security'){
  const x=obs.security;if(!x?.ok)return {status:'UNKNOWN',detail:'Security telemetry has not been verified.'};
  const recent=Array.isArray(x.events)?x.events.length:0,blocked=Number(x.blocked||0),rateLimited=Number(x.rateLimited||0);
  return {status:'ACTIVE',detail:'Application safeguards active · '+blocked+' blocked · '+rateLimited+' rate-limited · '+recent+' recent events.',metrics:{blocked,rateLimited,recentEvents:recent},note:'Application-level telemetry only; not host-level monitoring or a security certification.'};
 }
 if(signal==='search'){
  const x=obs.health?.search;return x?{status:'READY',detail:'Search mode '+clean(x.providerMode||'auto')+' · free-first '+(x.freeFirst===true?'on':'unverified')+'.'}:{status:'PARTIAL',detail:'Search API is registered; provider readiness has not yet been verified.'};
 }
 return {status:'UNKNOWN',detail:'No status adapter registered.'};
}
export async function getOSControlPlaneSnapshot(observations={}){
 await ensurePersistence();
 const os=OS_REGISTRY.map(item=>({...item,...checkStatus(item.signal,observations),observedAt:now()}));
 const statusCounts=os.reduce((acc,x)=>(acc[x.status]=(acc[x.status]||0)+1,acc),{});
 return {ok:true,version:state.version,mode:state.mode,persistence:state.persistence,persistenceDetail:state.persistenceDetail,registryVersion:'1.0.0',os,statusCounts,
  summary:{total:os.length,healthy:(statusCounts.HEALTHY||0)+(statusCounts.READY||0)+(statusCounts.ACTIVE||0),degraded:statusCounts.DEGRADED||0,unknown:statusCounts.UNKNOWN||0,reviewRequired:statusCounts.REVIEW_REQUIRED||0,guarded:statusCounts.SAFE_GATED||0,cycles:state.cycleCount,lastCycle:state.lastCycle,lastFeedbackAt:state.lastFeedbackAt},
  learning:{feedbackCount:state.feedback.length,categories:Object.entries(state.categories).map(([category,x])=>({category,...x})),recentFeedback:state.feedback.slice(0,8),promotionPolicy:{minSamples:30,minReliability:0.8,requiresShadowBenchmark:true,automaticPromotion:false},adaptation:'Feedback adjusts bounded recommendation priorities only; it cannot alter security policy or execution gates.'},
  policy:{autonomousModes:[...ALLOWED_MODES],safeAllowlist:[...SAFE_ACTIONS],neverAutonomous:['live money movement','placing/cancelling broker orders','credential access/export','security-policy changes','disabling risk or approval gates','unreviewed production deployments','self-modifying source code'],execution:'HUMAN_APPROVAL_REQUIRED',realMoneyExecution:'BLOCKED'}};
}
function categoryReliability(category){return categoryState(category).reliability}
function buildTasks(observations){
 const tasks=[];
 const market=checkStatus('market',observations);
 if(['DEGRADED','UNKNOWN'].includes(market.status))tasks.push({id:'market-feed-review',category:'provider',title:'Review market provider health',priority:92,risk:'LOW',action:'read_only_diagnostic',reason:market.detail,recommendation:'Inspect per-provider cooldowns, verify source timestamps, then run one bounded retry after cooldown. Keep execution blocked until a trustworthy live quote is available.'});
 const data=checkStatus('data',observations);
 if(['DEGRADED','UNKNOWN'].includes(data.status))tasks.push({id:'data-quality-review',category:'data-quality',title:'Investigate data quality',priority:88,risk:'LOW',action:'read_only_diagnostic',reason:data.detail,recommendation:'Check source freshness, independent-provider coverage and missing fields; never fill missing prices with estimates.'});
 const fleet=checkStatus('fleet',observations);
 if(['DEGRADED','UNKNOWN'].includes(fleet.status))tasks.push({id:'agent-fleet-review',category:'agent-operations',title:'Diagnose agent fleet',priority:75,risk:'LOW',action:'read_only_diagnostic',reason:fleet.detail,recommendation:'Review failed jobs and queue depth before changing concurrency or restarting workers.'});
 const sec=checkStatus('security',observations);
 if(sec.status==='UNKNOWN')tasks.push({id:'security-telemetry-review',category:'security',title:'Verify security telemetry',priority:98,risk:'LOW',action:'health_check',reason:sec.detail,recommendation:'Check security event telemetry, security headers, rate limits and policy enforcement.'});
 const learning=checkStatus('learning',observations);
 if(learning.status==='DEGRADED')tasks.push({id:'learning-health-review',category:'learning',title:'Review learning loop errors',priority:68,risk:'LOW',action:'read_only_diagnostic',reason:learning.detail,recommendation:'Inspect the research/benchmark failure before resuming learning.'});
 if(!tasks.length)tasks.push({id:'baseline-regression',category:'verification',title:'Run a bounded regression check',priority:55,risk:'LOW',action:'benchmark_candidate',reason:'No high-priority server-side fault was observed in this cycle.',recommendation:'Run existing contract and smoke tests; preserve the current release unless measured evidence supports a change.'});
 return tasks.map(t=>{const reliability=categoryReliability(t.category),learnedAdjustment=clamp((0.7-reliability)*20,-5,8);return {...t,priorityScore:Math.round(clamp(t.priority+learnedAdjustment,0,100)),learnedReliability:Math.round(reliability*100),learningEffect:learnedAdjustment>=1?'LOW_RELIABILITY_ESCALATES_REVIEW':learnedAdjustment<=-1?'HIGH_RELIABILITY_CONFIRMED':'NO_MATERIAL_ADJUSTMENT',feedbackSamples:categoryState(t.category).samples,execution:'PLAN_ONLY',requiresApproval:false}}).sort((a,b)=>b.priorityScore-a.priorityScore).slice(0,6);
}
export async function runAutonomousCoreCycle(observations={}){
 await ensurePersistence();
 const cycleId='core_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),tasks=buildTasks(observations);
 const cycle={id:cycleId,createdAt:now(),mode:state.mode,status:'PLANNED',observedOS:OS_REGISTRY.length,tasks,actionsExecuted:[],message:state.mode==='SAFE_AUTONOMY'?'Safe autonomy ran read-only checks and prepared a bounded plan. No code, deployment, credentials or financial action was changed.':'Monitor-only cycle collected status and prepared recommendations; no action was executed.'};
 state.cycleCount++;state.lastCycle=cycle.createdAt;state.recentCycles.unshift(cycle);state.recentCycles=state.recentCycles.slice(0,MAX_HISTORY);
 return {ok:true,...cycle,learning:{feedbackCount:state.feedback.length,mode:state.mode}};
}
export async function recordOSControlFeedback(input={}){
 await ensurePersistence();
 const cycleId=clean(input.cycleId,100),taskId=clean(input.taskId,100),outcome=String(input.outcome||'').toUpperCase(),cycle=state.recentCycles.find(x=>x.id===cycleId);
 if(!cycle)return {ok:false,status:400,error:'UNKNOWN_OR_EXPIRED_CYCLE'};
 const task=cycle.tasks.find(x=>x.id===taskId);if(!task)return {ok:false,status:400,error:'UNKNOWN_TASK_FOR_CYCLE'};
 if(!VALID_OUTCOMES.has(outcome))return {ok:false,status:400,error:'INVALID_OUTCOME'};
 if(state.feedback.some(x=>x.cycleId===cycleId&&x.taskId===taskId))return {ok:false,status:409,error:'FEEDBACK_ALREADY_RECORDED'};
 const record={id:'fb_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),cycleId,taskId,category:task.category,outcome,evidence:clean(input.evidence,500),reviewedBy:clean(input.reviewedBy||'operator',48),createdAt:now()};
 applyFeedback(record);const persisted=await persistFeedback(record);
 return {ok:true,record:{id:record.id,cycleId,taskId,category:record.category,outcome,createdAt:record.createdAt},category:{category:record.category,...categoryState(record.category)},persistence:state.persistence,persisted,learning:'Recommendation prioritization updated within bounded limits; security and execution policies unchanged.'};
}
export function setAutonomousCoreMode(mode){
 const requested=String(mode||'').toUpperCase();if(!ALLOWED_MODES.has(requested))return {ok:false,error:'MODE_NOT_ALLOWED',allowed:[...ALLOWED_MODES]};
 state.mode=requested;return {ok:true,mode:state.mode,message:requested==='SAFE_AUTONOMY'?'Safe mode enabled: scheduled read-only checks and bounded planning only.':'Monitor-only mode enabled: no scheduled cycles.'};
}
export function evaluateSecurityRequest(input={}){
 const action=clean(input.action,100).toLowerCase().replace(/[\s-]+/g,'_'),target=clean(input.target,100);
 const sensitive=/(trade|trading|order|execute|execution|money|transfer|payment|credential|secret|api_key|token|disable_security|disable_guard|risk_gate|approval_gate|policy_change|self_modify|source_code|deploy|database_delete|drop_table|shell|command_exec|real_money|broker)/i.test(action+' '+target);
 if(sensitive)return {ok:true,allowed:false,status:'BLOCKED_HUMAN_AUTHORIZATION_REQUIRED',action,target,reason:'High-impact financial, credential, policy, production or self-modification actions are never autonomous.',policy:'HUMAN_APPROVAL_REQUIRED',recommendation:'Create an auditable approval request; do not retry through another agent or route.'};
 if(!SAFE_ACTIONS.has(action))return {ok:true,allowed:false,status:'DENIED_NOT_ON_SAFE_ALLOWLIST',action,target,reason:'Action is not on the pre-approved read-only allowlist.',policy:'DENY_BY_DEFAULT'};
 return {ok:true,allowed:true,status:'ALLOWED_BOUNDED_READ_ONLY',action,target,reason:'This endpoint evaluates policy only; it does not execute an action.',policy:'LEAST_PRIVILEGE'};
}
export function getAutonomousCoreMode(){return state.mode}
export function resetAutonomousCoreForTests(){state.mode='MONITOR_ONLY';state.cycleCount=0;state.lastCycle=null;state.lastFeedbackAt=null;state.recentCycles=[];state.feedback=[];state.categories={};}
