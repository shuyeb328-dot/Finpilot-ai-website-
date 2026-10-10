/* FinPilot Autonomous Core OS Control Panel 1.0
   Unified OS status, read-only orchestration, bounded feedback learning and security policy visibility.
   Never places trades, mutates production code, or bypasses execution gates.
*/
(function(){
'use strict';
if(window.FinPilotAutonomousCoreOS)return;
const API='/api/os-control-plane';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const tone=s=>({HEALTHY:'good',READY:'good',ACTIVE:'good',SAFE_GATED:'good',IDLE:'neutral',PARTIAL:'warn',DEGRADED:'bad',UNKNOWN:'neutral',REVIEW_REQUIRED:'bad'}[s]||'neutral');
const nice=s=>String(s||'UNKNOWN').replace(/_/g,' ');
let opened=false,lastData=null,lastCycle=null,busy=false,refreshTimer=null,client=null,managedRegistryData=null;
function clientSignals(){return {
 foundation:window.FinPilotFoundation?.getReport?.()||null,
 evolution:window.FinPilotEvolution?.snapshot?.()||null,
 quantum:window.FinPilotQuantum?.snapshot?.()||null,
 deepLearning:window.FinPilotDeepLearning?.snapshot?.()||null,
 trainingFabric:window.FinPilotTrainingFabric?.snapshot?.()||null,
 unified:window.FinPilotUnifiedOS?.snapshot?.()||null
}}
function styles(){
 if(document.getElementById('fp-autonomous-core-style'))return;
 const s=document.createElement('style');s.id='fp-autonomous-core-style';
 s.textContent=[
 '#fp-autonomous-launch{position:fixed;right:14px;top:82px;z-index:1190;background:#1459d9;color:#fff;border:1px solid #6b99ff;border-radius:999px;padding:10px 14px;font:600 12px system-ui;box-shadow:0 8px 28px #0005;cursor:pointer}',
 '#fp-autonomous-shade{position:fixed;inset:0;background:#020817b8;z-index:1191;opacity:0;pointer-events:none;transition:opacity .18s}',
 '#fp-autonomous-shade.open{opacity:1;pointer-events:auto}',
 '#fp-autonomous-panel{position:fixed;z-index:1192;top:0;left:0;bottom:0;width:min(430px,94vw);background:#07111f;color:#e8f0ff;border-right:1px solid #243650;box-shadow:18px 0 60px #0006;transform:translateX(-105%);transition:transform .2s;display:flex;flex-direction:column;font:13px/1.45 system-ui,-apple-system,sans-serif}',
 '#fp-autonomous-panel.open{transform:translateX(0)}','#fp-autonomous-panel *{box-sizing:border-box}',
 '.fpac-head{padding:17px 16px 14px;border-bottom:1px solid #203047;background:linear-gradient(135deg,#0e2037,#081321)}',
 '.fpac-title{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:800}.fpac-sub{color:#8ea4c1;font-size:11px;margin-top:4px}',
 '.fpac-icon{display:grid;place-items:center;width:34px;height:34px;background:#123e61;border:1px solid #2e7894;border-radius:10px;color:#72e6d1}',
 '.fpac-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.fpac-grow{flex:1}',
 '.fpac-btn{border:1px solid #294564;border-radius:8px;background:#102137;color:#e3efff;padding:8px 10px;font-weight:650;font-size:11px;cursor:pointer}',
 '.fpac-btn.primary{background:#2468e8;border-color:#4984ff;color:white}.fpac-btn.danger{border-color:#86434c;color:#ffc0c7;background:#301820}.fpac-btn:disabled{opacity:.45;cursor:wait}',
 '.fpac-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:12px}.fpac-stat{border:1px solid #21354e;border-radius:9px;background:#0b1a2c;padding:9px}.fpac-stat b{font-size:19px;display:block}.fpac-stat span{color:#8ea4c1;font-size:10px}',
 '.fpac-planes{display:grid;grid-template-columns:1fr;gap:7px}.fpac-plane{border:1px solid #20354d;background:#091929;border-radius:9px;padding:10px}.fpac-plane-top{display:flex;align-items:center;gap:8px}.fpac-plane-name{font-weight:750;font-size:11px;flex:1}.fpac-plane-meta{display:flex;align-items:center;justify-content:space-between;color:#9bb0c9;font-size:10px;margin-top:6px}.fpac-meter{height:4px;background:#203047;border-radius:99px;overflow:hidden;margin-top:7px}.fpac-meter i{display:block;height:100%;background:#56d7bc}',
 '.fpac-content{overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}.fpac-section{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8ea4c1;font-weight:800}',
 '.fpac-os{border:1px solid #20354d;background:#091929;border-radius:10px;overflow:hidden}.fpac-os-main{display:flex;align-items:flex-start;gap:9px;padding:11px}',
 '.fpac-dot{width:9px;height:9px;flex:none;border-radius:50%;margin-top:5px;background:#64748b}.fpac-dot.good{background:#44d3a3;box-shadow:0 0 8px #44d3a355}.fpac-dot.warn{background:#f5bd4f}.fpac-dot.bad{background:#ff6576}',
 '.fpac-os-name{font-weight:750;font-size:12px}.fpac-os-sub{color:#9bb0c9;font-size:10px;margin-top:3px;overflow-wrap:anywhere}',
 '.fpac-badge{border-radius:999px;font-size:9px;font-weight:800;letter-spacing:.04em;padding:4px 6px;white-space:nowrap;background:#172b40;color:#a8bad0}.fpac-badge.good{background:#103b34;color:#6fe2bb}.fpac-badge.warn{background:#443417;color:#ffd27b}.fpac-badge.bad{background:#451d2a;color:#ff9ca9}',
 '.fpac-details{display:none;border-top:1px solid #1b3047;padding:9px 11px;color:#aebed2;font-size:10px}.fpac-os.expanded .fpac-details{display:block}',
 '.fpac-agent-form{display:grid;gap:8px;border:1px solid #21354e;background:#091929;padding:11px;border-radius:10px}.fpac-agent-form input,.fpac-agent-form textarea,.fpac-agent-form select{width:100%;min-width:0;border:1px solid #294564;border-radius:7px;background:#061321;color:#e3efff;padding:9px;font:12px system-ui}.fpac-agent-form label{display:grid;gap:4px;color:#9bb0c9;font-size:10px}.fpac-agent-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.fpac-agent-item{border:1px solid #20354d;border-radius:9px;padding:9px;background:#091929;margin-top:7px}.fpac-agent-title{font-size:12px;font-weight:750}.fpac-agent-meta{font-size:10px;color:#9bb0c9;margin-top:3px;overflow-wrap:anywhere}.fpac-agent-scope{font-size:10px;color:#6eddbb;margin-top:5px;overflow-wrap:anywhere}.fpac-agent-form .fpac-btn{justify-self:start}@media(max-width:420px){.fpac-agent-grid{grid-template-columns:1fr}}',
 '.fpac-plan{border:1px solid #25415e;background:#0c1c30;border-radius:10px;padding:11px}.fpac-plan h4{font-size:12px;margin:0 0 5px}.fpac-plan p{margin:4px 0;color:#9fb2ca;font-size:10px}.fpac-meta{color:#6eddbb;font-size:9px;font-weight:800;text-transform:uppercase}',
 '.fpac-empty{border:1px dashed #314862;border-radius:9px;padding:11px;color:#9db0c9;font-size:11px}.fpac-notice{padding:9px;border:1px solid #41536a;border-radius:8px;color:#c6d4e8;background:#0e1d2f;font-size:10px;overflow-wrap:anywhere}',
 '.fpac-footer{border-top:1px solid #203047;padding:10px 13px;color:#7e95b2;font-size:10px}',
 '@media(max-width:600px){#fp-autonomous-launch{right:10px;top:70px;padding:8px 10px;font-size:11px}#fp-autonomous-panel{width:min(390px,96vw)}}',
 '@media(prefers-reduced-motion:reduce){#fp-autonomous-panel,#fp-autonomous-shade{transition:none}}'
 ].join('');
 document.head.appendChild(s);
}
function ensureDOM(){
 styles();if(document.getElementById('fp-autonomous-panel'))return;
 const shade=document.createElement('div');shade.id='fp-autonomous-shade';shade.addEventListener('click',close);
 const panel=document.createElement('aside');panel.id='fp-autonomous-panel';panel.setAttribute('aria-label','Autonomous OS Control Center');
 panel.innerHTML='<div class="fpac-head"><div class="fpac-row"><div class="fpac-icon">⌘</div><div class="fpac-grow"><div class="fpac-title">FinPilot AI OS <span style="color:#6eddbb;font-size:9px">v1.1</span></div><div class="fpac-sub">One registry · shared operating layer · governed learning</div></div><button class="fpac-btn" id="fpac-close" aria-label="Close panel">✕</button></div><div class="fpac-stats" id="fpac-stats"><div class="fpac-stat"><b>—</b><span>REGISTERED OS</span></div><div class="fpac-stat"><b>—</b><span>DEGRADED</span></div><div class="fpac-stat"><b>—</b><span>LEARNED CASES</span></div></div><div class="fpac-row" style="margin-top:11px"><button class="fpac-btn primary" id="fpac-refresh">Refresh health</button><button class="fpac-btn" id="fpac-cycle">Run core cycle</button><button class="fpac-btn" id="fpac-mode">Enable safe mode</button></div></div><div class="fpac-content"><div id="fpac-alert" class="fpac-notice">Loading measured status…</div><div class="fpac-section">Operating planes · unified registry</div><div id="fpac-planes" class="fpac-planes"><div class="fpac-empty">Loading operating planes…</div></div><div class="fpac-section">Central Agent Factory · server registry</div><form id="fpac-agent-form" class="fpac-agent-form"><div class="fpac-agent-grid"><label>Agent name<input name="name" id="fpac-agent-name" required minlength="2" maxlength="60" placeholder="Market Regime Scout"></label><label>Run interval (minutes)<input name="interval" id="fpac-agent-interval" type="number" min="1" max="1440" value="15" required></label></div><label>Role / expertise<input name="role" id="fpac-agent-role" required maxlength="120" placeholder="Research public market evidence"></label><label>Objective<textarea name="objective" id="fpac-agent-objective" maxlength="600" rows="2" placeholder="Compare independent timestamped sources, identify contradictions and state uncertainty"></textarea></label><div class="fpac-meta">Creates a governed agent definition only. No arbitrary code, credential access, live trading, or automatic execution is granted.</div><button class="fpac-btn primary" id="fpac-agent-submit" type="submit">Register specialist</button></form><div id="fpac-managed-agents" class="fpac-empty">Loading central agent registry…</div><div class="fpac-section">All registered OS modules</div><div id="fpac-os-list" class="fpac-empty">Checking registered OS modules…</div><div class="fpac-section">Autonomous action plan</div><div id="fpac-plan"><div class="fpac-empty">Run a cycle to build a prioritized, read-only plan.</div></div><div class="fpac-section">AI Security OS · policy probe</div><div class="fpac-plan"><h4>Test the security guard</h4><p>Runs a policy-only test for a prohibited autonomous action. It does not attempt a trade, deploy, or change any setting.</p><button class="fpac-btn danger" id="fpac-security-probe">Probe protected action</button><div id="fpac-security-result" style="margin-top:8px"></div></div><div class="fpac-section">Self-learning record</div><div id="fpac-learning" class="fpac-empty">Outcome feedback adjusts bounded task-priority weights; it cannot rewrite code or weaken safety policy.</div></div><div class="fpac-footer">Safe by default · No real-money execution · No autonomous production code changes</div>';
 const launcher=document.createElement('button');launcher.id='fp-autonomous-launch';launcher.textContent='◈ OS Control';launcher.setAttribute('aria-controls','fp-autonomous-panel');launcher.setAttribute('aria-expanded','false');launcher.addEventListener('click',toggle);
 document.body.append(shade,panel,launcher);
 panel.querySelector('#fpac-close').addEventListener('click',close);
 panel.querySelector('#fpac-refresh').addEventListener('click',()=>refresh(true));
 panel.querySelector('#fpac-cycle').addEventListener('click',runCycle);
 panel.querySelector('#fpac-mode').addEventListener('click',toggleMode);
 panel.querySelector('#fpac-security-probe').addEventListener('click',securityProbe);
 panel.querySelector('#fpac-agent-form').addEventListener('submit',createManagedAgentFromOS);
}
async function api(url,options){
 options=options||{};
 const r=await fetch(url,{cache:'no-store',method:options.method||'GET',body:options.body,headers:Object.assign({'Content-Type':'application/json'},options.headers||{})});
 const data=await r.json().catch(()=>({ok:false,error:'INVALID_JSON_RESPONSE'}));
 if(!r.ok||data.ok===false)throw new Error(data.error||('HTTP_'+r.status));
 return data;
}
function renderManagedAgents(data,error){
 const host=document.getElementById('fpac-managed-agents');if(!host)return;
 if(error){host.innerHTML='<div class="fpac-empty">Central Agent Factory is unavailable: '+esc(error)+'. Agents are not registered locally as a fallback.</div>';return}
 if(!data){host.innerHTML='<div class="fpac-empty">Loading central agent registry…</div>';return}
 const agents=Array.isArray(data.agents)?data.agents:[];
 const summary='<div class="fpac-meta">'+agents.length+'/'+Number(data.maxAgents||100)+' definitions · '+esc(nice(data.persistence||'UNKNOWN'))+' · '+(data.persistent?'restart-safe storage':'may reset on server restart')+'</div>';
 host.innerHTML=summary+(agents.length?agents.map(agent=>'<div class="fpac-agent-item"><div class="fpac-agent-title">'+esc(agent.icon||'🤖')+' '+esc(agent.name)+'</div><div class="fpac-agent-meta">'+esc(agent.domain||'CUSTOM')+' · '+esc(agent.status||'REGISTERED')+' · '+esc(agent.executionMode||'USER_TRIGGERED_ONLY')+'</div><div class="fpac-agent-meta">'+esc(agent.role||agent.mission||'No role supplied')+'</div><div class="fpac-agent-scope">Data scopes: '+esc((agent.permissions||[]).join(', ')||'No optional scopes')+'</div></div>').join(''):'<div class="fpac-empty">No managed agent definitions registered yet.</div>');
}
async function createManagedAgentFromOS(event){
 event.preventDefault();if(busy)return;
 const form=document.getElementById('fpac-agent-form'),button=document.getElementById('fpac-agent-submit');
 const name=document.getElementById('fpac-agent-name')?.value?.trim(),role=document.getElementById('fpac-agent-role')?.value?.trim();
 const objective=document.getElementById('fpac-agent-objective')?.value?.trim(),interval=Number(document.getElementById('fpac-agent-interval')?.value||15);
 if(!name||!role||!Number.isInteger(interval)||interval<1||interval>1440){toast('Enter a valid agent name, role and interval from 1 to 1440 minutes');return}
 if(button)button.disabled=true;
 try{
  await api('/api/ai-os/agents',{method:'POST',body:JSON.stringify({name,role,objective,interval})});
  managedRegistryData=await api('/api/ai-os/agents');renderManagedAgents(managedRegistryData);
  form.reset();const iv=document.getElementById('fpac-agent-interval');if(iv)iv.value='15';
  await refresh();toast(managedRegistryData.persistent?'Agent registered in the shared AI OS registry':'Agent registered, but the registry is process-memory only and may reset on restart');
 }catch(error){
  renderManagedAgents(null,error?.message||String(error));
  toast('Central agent registration failed; no local-only agent was created');
 }finally{if(button)button.disabled=false}
}
function open(){
 ensureDOM();opened=true;document.getElementById('fp-autonomous-panel').classList.add('open');document.getElementById('fp-autonomous-shade').classList.add('open');document.getElementById('fp-autonomous-launch').setAttribute('aria-expanded','true');refresh();
 if(!refreshTimer)refreshTimer=setInterval(()=>{if(opened&&!busy)refresh()},25000);
}
function close(){opened=false;document.getElementById('fp-autonomous-panel')?.classList.remove('open');document.getElementById('fp-autonomous-shade')?.classList.remove('open');document.getElementById('fp-autonomous-launch')?.setAttribute('aria-expanded','false')}
function toggle(){opened?close():open()}
function localEvidence(){
 const x=client||clientSignals();
 const foundation=x.foundation,foundationReady=Boolean(foundation?.winner&&Number(foundation?.candidateCount)>=40&&Number.isFinite(Number(foundation.winner.score)));
 const evolution=x.evolution,evolutionEvents=Number(evolution?.events||0),benchmarks=Number(evolution?.benchmarks||0),shadow=Number(evolution?.shadow||0),promoted=Number(evolution?.promoted||0);
 const evolutionStatus=!evolution?'PARTIAL':(evolutionEvents+benchmarks+shadow+promoted)>0?'ACTIVE':'READY';
 const quantum=x.quantum,agents=Number(quantum?.agents||quantum?.agentCount||0),enabled=Number(quantum?.enabled||0),runs=Number(quantum?.quantumRuns||0),researchRuns=Number(quantum?.researchRuns||0);
 const quantumStatus=!quantum?'PARTIAL':(agents>0&&enabled>0)?((runs+researchRuns)>0?'ACTIVE':'READY'):'PARTIAL';
 const fabric=x.trainingFabric,dl=x.deepLearning,forecast=dl?.forecastTraining,unified=x.unified;
 const fpRuns=Number(fabric?.runs||0),fpQueue=Number(fabric?.queue||0);
 const forecastCount=Number(forecast?.forecastCount||0),resolvedForecasts=Number(forecast?.resolvedForecasts||0),pendingForecasts=Number(forecast?.pendingForecasts||0);
 return {
  foundation:foundation?{status:foundationReady?'READY':'PARTIAL',detail:'Foundation benchmark: '+Number(foundation.candidateCount||0)+' candidates · winner '+(foundation.winner?.id||'unavailable')+' · score '+Number(foundation.winner?.score||0)+'/100.'}:{status:'PARTIAL',detail:'Browser benchmark telemetry is not available.'},
  evolution:evolution?{status:evolutionStatus,detail:'Browser Evolution OS: '+promoted+' promoted entries · '+shadow+' shadow entries · '+benchmarks+' benchmarks · '+evolutionEvents+' events. Promotion activity is not proof of live code mutation.'}:{status:'PARTIAL',detail:'Browser Evolution OS snapshot is not available.'},
  quantum:quantum?{status:quantumStatus,detail:'Browser Quantum Core: '+agents+' agents · '+enabled+' enabled · '+runs+' quantum routing runs · '+researchRuns+' research runs. Server external provider configuration is reported separately; fallback is classical.'}:{status:'PARTIAL',detail:'Browser Quantum snapshot is not available.'},
  'training-fabric':fabric?{status:fpRuns?'PARTIAL':'READY',detail:'Browser Training Fabric: '+Number(fabric.agents||0)+' agents · '+fpRuns+' curriculum runs · '+Number(fabric.outcomes||0)+' outcomes · '+fpQueue+' queued tasks. Training records live in this browser; this evaluates agent behavior but does not train foundation-model weights.'}:{status:'PARTIAL',detail:'Training Fabric browser telemetry is not available.'},
  'forecast-learning':forecast?{status:forecastCount?'PARTIAL':'READY',detail:'Deep Learning OS: '+forecastCount+' forecasts · '+resolvedForecasts+' resolved · '+pendingForecasts+' pending · '+Number(forecast.calibratedAgentCount||0)+' calibrated agents. Forecast training is browser-local; no server-side training persistence is claimed.'}:{status:'PARTIAL',detail:'Deep Learning OS forecast telemetry is not available.'},
  'unified-workspace':unified?{status:Number(unified.core?.readiness||0)>=55?'READY':'PARTIAL',detail:'Unified Workspace '+String(unified.version||'unknown')+' · core readiness '+Number(unified.core?.readiness||0)+'/100 · data quality '+Number(unified.data?.quality||0)+'/100 · '+Number(Array.isArray(unified.agents)?unified.agents.length:0)+' local agent profiles. Dashboard-local telemetry only.'}:{status:'PARTIAL',detail:'Unified Workspace browser telemetry is not available.'}
 };
}
function render(data){
 lastData=data;client=clientSignals();
 const stats=document.getElementById('fpac-stats');if(!stats)return;
 const sum=data.summary||{},learn=data.learning||{};
 stats.innerHTML='<div class="fpac-stat"><b>'+Number(sum.total||0)+'</b><span>REGISTERED OS</span></div><div class="fpac-stat"><b>'+(Number(sum.degraded||0)+Number(sum.reviewRequired||0))+'</b><span>DEGRADED / REVIEW</span></div><div class="fpac-stat"><b>'+Number(learn.feedbackCount||0)+'</b><span>LEARNING RECORDS</span></div>';
 const layer=data.operatingLayer||{},planes=Array.isArray(layer.planes)?layer.planes:[];
 const planeHost=document.getElementById('fpac-planes');
 if(planeHost)planeHost.innerHTML=planes.map(p=>'<div class="fpac-plane"><div class="fpac-plane-top"><span class="fpac-dot '+tone(p.status)+'"></span><span class="fpac-plane-name">'+esc(p.name)+'</span><span class="fpac-badge '+tone(p.status)+'">'+esc(nice(p.status))+'</span></div><div class="fpac-plane-meta"><span>'+Number(p.components||0)+' OS modules</span><b>'+Number(p.readiness||0)+'% measured readiness</b></div><div class="fpac-meter"><i style="width:'+Math.max(0,Math.min(100,Number(p.readiness||0)))+'%"></i></div></div>').join('')||'<div class="fpac-empty">Operating plane telemetry is not available.</div>';
 const alert=document.getElementById('fpac-alert');alert.textContent='AI OS: '+nice(layer.status||'UNKNOWN')+' · Mode: '+nice(data.mode)+' · Persistence: '+nice(data.persistence)+'. '+(data.persistenceDetail||'');
 const extra=localEvidence(),rows=Array.isArray(data.os)?data.os:[];
 document.getElementById('fpac-os-list').innerHTML=rows.map(os=>{
  const localKey={'foundation':'foundation','evolution':'evolution','quantum':'quantum','training-fabric':'training-fabric','forecast-learning':'forecast-learning','unified-workspace':'unified-workspace'}[os.signal]||'',local=localKey?extra[localKey]:null;
  const status=local?local.status:os.status,detail=local?local.detail:os.detail,t=tone;
  return '<div class="fpac-os" data-os="'+esc(os.id)+'"><div class="fpac-os-main"><span class="fpac-dot '+t(status)+'"></span><div class="fpac-grow"><div class="fpac-os-name">'+esc(os.name)+'</div><div class="fpac-os-sub">'+esc(os.domain)+' · '+esc(os.criticality)+'</div></div><span class="fpac-badge '+t(status)+'">'+esc(nice(status))+'</span><button class="fpac-btn" data-expand="'+esc(os.id)+'" aria-label="Details for '+esc(os.name)+'">⌄</button></div><div class="fpac-details"><p>'+esc(detail||os.description)+'</p><p>Dependencies: '+esc((os.dependencies||[]).join(', ')||'None registered')+'</p><p>'+esc(os.description||'')+'</p></div></div>';
 }).join('');
 document.getElementById('fpac-os-list').querySelectorAll('[data-expand]').forEach(b=>b.addEventListener('click',()=>b.closest('.fpac-os').classList.toggle('expanded')));
 const cats=Array.isArray(learn.categories)?learn.categories:[];
 document.getElementById('fpac-learning').innerHTML='<div class="fpac-meta">Bounded outcome adaptation</div><p>'+Number(learn.feedbackCount||0)+' reviewed outcomes · '+esc(nice(data.persistence))+'</p>'+(cats.length?cats.slice(0,6).map(c=>'<p>'+esc(c.category)+': '+Math.round(Number(c.reliability||0)*100)+'% observed reliability · '+Number(c.samples||0)+' samples</p>').join(''):'<p>No operator feedback recorded yet. The system does not invent training outcomes.</p>')+'<p>Promotion stays manual and requires at least '+Number(learn.promotionPolicy?.minSamples||30)+' observations plus a shadow benchmark.</p>';
 const modeBtn=document.getElementById('fpac-mode');if(modeBtn)modeBtn.textContent=data.mode==='SAFE_AUTONOMY'?'Pause safe mode':'Enable safe mode';
 renderPlan(lastCycle);
}
function renderPlan(cycle){
 const host=document.getElementById('fpac-plan');if(!host)return;
 if(!cycle?.tasks?.length){host.innerHTML='<div class="fpac-empty">Run a cycle to build a prioritized plan from current status.</div>';return}
 host.innerHTML=cycle.tasks.map(t=>'<div class="fpac-plan"><div class="fpac-row"><span class="fpac-meta">'+esc(t.category)+' · '+esc(t.execution||'PLAN_ONLY')+'</span><span class="fpac-grow"></span><span class="fpac-badge">'+Number(t.priorityScore||t.priority||0)+' priority</span></div><h4>'+esc(t.title)+'</h4><p>'+esc(t.reason)+'</p><p>'+esc(t.recommendation)+'</p><div class="fpac-row" style="margin-top:8px"><button class="fpac-btn" data-feedback="SUCCESS" data-task="'+esc(t.id)+'">Resolved / helpful</button><button class="fpac-btn" data-feedback="FAILURE" data-task="'+esc(t.id)+'">Failed / not helpful</button></div></div>').join('');
 host.querySelectorAll('[data-feedback]').forEach(b=>b.addEventListener('click',()=>sendFeedback(b.dataset.task,b.dataset.feedback,b)));
}
async function refresh(showToast){
 if(busy)return;busy=true;const btn=document.getElementById('fpac-refresh');if(btn)btn.disabled=true;
 try{
  const d=await api(API);render(d);
  try{managedRegistryData=await api('/api/ai-os/agents');renderManagedAgents(managedRegistryData)}catch(registryError){renderManagedAgents(null,registryError?.message||String(registryError))}
  if(showToast)toast('AI OS health and central agent registry refreshed')
 }
 catch(e){const a=document.getElementById('fpac-alert');if(a)a.textContent='Control plane unavailable: '+e.message}
 finally{busy=false;if(btn)btn.disabled=false}
}
function toast(m){if(typeof window.FinPilotBridge?.toast==='function')window.FinPilotBridge.toast(m);else console.info('[FinPilot Core OS]',m)}
async function runCycle(){
 const btn=document.getElementById('fpac-cycle');if(busy)return;busy=true;if(btn)btn.disabled=true;
 try{const d=await api(API+'/cycle',{method:'POST',body:JSON.stringify({requestedFrom:'os-control-panel'})});lastCycle=d;renderPlan(d);const r=await api(API);render(r);renderPlan(d);try{managedRegistryData=await api('/api/ai-os/agents');renderManagedAgents(managedRegistryData)}catch(registryError){renderManagedAgents(null,registryError?.message||String(registryError))}toast('AI OS cycle finished · '+d.tasks.length+' plans · no external actions executed')}
 catch(e){document.getElementById('fpac-plan').innerHTML='<div class="fpac-empty">Cycle stopped safely: '+esc(e.message)+'</div>'}
 finally{busy=false;if(btn)btn.disabled=false}
}
async function sendFeedback(taskId,outcome,btn){
 if(!lastCycle?.id){toast('Run a core cycle first');return}
 btn.disabled=true;
 try{const d=await api(API+'/feedback',{method:'POST',body:JSON.stringify({cycleId:lastCycle.id,taskId:taskId,outcome:outcome,evidence:'Operator feedback submitted from the OS Control Panel.'})});toast('Learning updated · '+Math.round(Number(d.category.reliability||0)*100)+'% observed category reliability');await refresh()}
 catch(e){toast('Feedback not recorded: '+e.message)}
 finally{btn.disabled=false}
}
async function toggleMode(){
 if(busy)return;const mode=lastData?.mode==='SAFE_AUTONOMY'?'MONITOR_ONLY':'SAFE_AUTONOMY',b=document.getElementById('fpac-mode');if(b)b.disabled=true;
 try{await api(API+'/mode',{method:'POST',body:JSON.stringify({mode:mode})});await refresh();toast(mode==='SAFE_AUTONOMY'?'Safe read-only autonomy enabled':'Monitor-only mode enabled')}
 catch(e){toast('Mode change failed: '+e.message)}
 finally{if(b)b.disabled=false}
}
async function securityProbe(){
 const host=document.getElementById('fpac-security-result'),btn=document.getElementById('fpac-security-probe');btn.disabled=true;host.textContent='Evaluating policy…';
 try{const d=await api(API+'/security-check',{method:'POST',body:JSON.stringify({action:'disable_security',target:'AI Security OS',simulation:true})});host.innerHTML='<span class="fpac-badge '+(d.allowed?'bad':'good')+'">'+esc(nice(d.status))+'</span><p>'+esc(d.reason)+'</p>';if(d.allowed)throw new Error('Unsafe policy result: protected action was allowed')}
 catch(e){host.textContent='Security probe failed: '+e.message}
 finally{btn.disabled=false}
}
function boot(){
 ensureDOM();window.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened)close()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.FinPilotAutonomousCoreOS={open:open,close:close,refresh:refresh,runCycle:runCycle,version:'1.0.0'};
})();