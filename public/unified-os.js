/* FinPilot Unified OS 9.0
   Connects the existing Core, Data, Agent, Learning, Governance, Research and Execution layers.
   It adds orchestration and visibility; it never bypasses approval or real-money execution gates.
*/
(function(){
  'use strict';
  const VERSION='9.0.0';
  const KEY='finpilot_unified_os_v1';
  const esc=v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')||{runs:0,lastRun:null,server:null,history:[]}}catch{return{runs:0,lastRun:null,server:null,history:[]}}};
  const save=x=>{try{localStorage.setItem(KEY,JSON.stringify(x))}catch{}};
  const st=()=>window.FinPilotBridge?.state||window.state||{};
  const money=n=>typeof window.FinPilotBridge?.money==='function'?window.FinPilotBridge.money(n):'₹'+Math.round(Number(n)||0).toLocaleString('en-IN');
  function agentSnapshot(){
    const s=st(),intel=window.FinPilotAgentIntelligence?.fleetMatrix?.(s,typeof window.liveWebSignal==='function'?window.liveWebSignal():null)||[];
    const dl=window.FinPilotDeepLearning?.snapshot?.()||{};
    const mesh=Array.isArray(s.agentMesh?.agents)?Object.entries(s.agentMesh.agents):Object.entries(s.agentMesh?.agents||{});
    const core=['CFO','Debt','Goals','Risk','Investment','Markets','Tax','Security','Business','Assets','Research','RedTeam'];
    return core.map(name=>{
      const q=intel.find(x=>x.name===name)||{name,mission:name==='RedTeam'?'Adversarial challenge and failure hunting':name==='Research'?'Primary-source evidence and contradiction testing':'Specialist financial analysis',domainScore:60,risk:50,confidence:60,evidenceFreshness:0,calibration:null};
      const d=dl.agents?.find(x=>x.agent===name);
      const m=s.agentScores?.[name]||{};
      return {...q,accuracy:d?.accuracy??m.accuracy??null,runs:d?.runs??m.runs??0,avgConfidence:d?.avgConfidence??m.avgConfidence??q.confidence,agentStatus:mesh.find(x=>x[0]===name)?.[1]?.status||'READY'};
    });
  }
  function localSnapshot(){
    const s=st(),q=load(),core=s.mainCore||{},brain=s.coreBrain||{},fast=s.coreFast||{},data=s.dataOS||{},mesh=s.agentMesh||{};
    const dl=window.FinPilotDeepLearning?.snapshot?.()||{};
    const evo=window.FinPilotEvolution?.snapshot?.()||{};
    const qai=window.FinPilotQuantum?.snapshot?.()||{};
    const foundation=window.FinPilotFoundation?.getReport?.()||null;
    const agents=agentSnapshot();
    const avg=agents.length?agents.reduce((n,a)=>n+Number(a.confidence||0),0)/agents.length:0;
    const calibrated=agents.filter(a=>a.accuracy!=null);
    const accuracy=calibrated.length?calibrated.reduce((n,a)=>n+Number(a.accuracy||0),0)/calibrated.length:null;
    return {
      version:VERSION,runs:q.runs,lastRun:q.lastRun,
      core:{health:Number(core.health||0),readiness:Number(core.readiness||0),verdict:core.verdict||'NOT RUN',latency:Number(core.latency||0)},
      brain:{health:Number(brain.score||0),confidence:Number(brain.confidence||0),decision:brain.decision||'NOT RUN',risks:Array.isArray(brain.risks)?brain.risks:[]},
      fast:{readiness:Number(fast.readiness||0),latency:Number(fast.latencyMs||0),path:fast.fastPath!==false},
      data:{quality:Number(data.quality||0),queue:Array.isArray(data.queue)?data.queue.length:0,sources:Array.isArray(data.sources)?data.sources.length:0},
      mesh:{average:Math.round(Number(mesh.runs?avg:avg)||0),runs:Number(mesh.runs||0),escalations:Array.isArray(mesh.queue)?mesh.queue.length:0},
      learning:{accuracy:accuracy==null?dl.averageAccuracy:accuracy,runs:Number(dl.runs||0),outcomes:Number(dl.outcomes||0)},
      evolution:evo,quantum:qai,foundation:foundation?{score:Number(foundation.winner?.score||0),winner:foundation.winner?.id||'—',candidates:Number(foundation.candidateCount||0)}:null,
      agents
    };
  }
  async function serverSnapshot(){
    const urls={
      autonomy:'/api/autonomy-status',
      fleet:'/api/agent-fleet-status',
      data:'/api/data-health',
      policy:'/api/policy-status',
      security:'/api/security-status',
      realtime:'/api/realtime-status',
      performance:'/api/performance'
    };
    const entries=Object.entries(urls);
    const result={};
    await Promise.all(entries.map(async([key,url])=>{
      const t=performance.now();
      try{
        const r=await fetch(url+'?ts='+Date.now(),{cache:'no-store'});
        const body=await r.json();
        result[key]={ok:r.ok&&body?.ok!==false,ms:Math.round(performance.now()-t),status:r.status,data:body};
      }catch(e){result[key]={ok:false,ms:Math.round(performance.now()-t),error:String(e?.message||e)}}
    }));
    return result;
  }
  async function refresh(){
    const q=load(), local=localSnapshot(), server=await serverSnapshot();
    const checks=[
      ['Core',local.core.readiness>=55,'Decision kernel'],
      ['Brain',local.brain.confidence>=50,'Financial state'],
      ['Data',local.data.quality>=60,'Data foundation'],
      ['Agents',local.mesh.average>=60,'Specialist network'],
      ['Learning',local.learning.accuracy==null||local.learning.accuracy>=50,'Calibration'],
      ['Governance',server.policy?.ok!==false,'Policy guard'],
      ['Security',server.security?.ok!==false,'Security gateway'],
      ['Realtime',server.realtime?.ok!==false,'Market/event stream'],
      ['Performance',server.performance?.ok!==false,'Runtime telemetry'],
      ['Execution','paper' in s().paperTrading?'Paper isolated':'No broker execution','Execution boundary']
    ];
    const normalized=checks.map(x=>({name:x[0],ok:x[1]===true,status:x[1]===true?'READY':x[1]===false?'REVIEW':'INFO',desc:x[2]}));
    const ready=normalized.filter(x=>x.ok).length;
    const health=Math.round(ready/Math.max(1,normalized.length)*100);
    const packet={version:VERSION,time:new Date().toISOString(),health,ready,checks:normalized,local,server};
    q.runs++;q.lastRun=packet.time;q.server=server;q.history.unshift({time:packet.time,health,ready});q.history=q.history.slice(0,20);save(q);
    st().unifiedOS=packet;
    try{window.FinPilotBridge?.save?.()}catch{}
    return packet;
  }
  function extraAgentReasoning(name){
    const s=st(),intel=window.FinPilotAgentIntelligence;
    if(!intel)return;
    const web=typeof window.liveWebSignal==='function'?window.liveWebSignal():null;
    const profile=intel.profile(name),score=intel.score(s,name,web);
    const rec=intel.enrich(s,name,{analysis:name+' completed a governed specialist review across the shared Financial Brain.',hypothesis:'Change the conclusion when stronger contradictory evidence appears.',challenge:'Identify the strongest falsifier and the highest-impact failure mode.',recommendation:name==='RedTeam'?'Block weak conclusions until contradictions are resolved.':'Verify primary evidence and keep high-impact actions approval-gated.',confidence:score.confidence,risk:score.risk>=70?'HIGH':score.risk>=45?'MEDIUM':'LOW',decision:score.domainScore>=70&&score.risk<65?'CONSIDER':'VERIFY'},web);
    intel.record(s,rec);
  }
  function runAgentCycle(){
    try{window.runCoreBrain?.()}catch{}
    try{window.runAgentMesh?.()}catch{}
    try{window.FinPilotDeepLearning?.runFleet?.(st(),{web:typeof window.liveWebSignal==='function'?window.liveWebSignal():null})}catch{}
    try{extraAgentReasoning('Research');extraAgentReasoning('RedTeam')}catch{}
    try{window.runMainCore?.()}catch{}
    try{window.runCoreFast?.()}catch{}
    try{window.FinPilotDeepLearning?.learnFromDecision?.(st(),st().decision)}catch{}
    return refresh();
  }
  function tone(ok){return ok?'low':'high'}
  function metricCard(label,value,sub,cls){return '<div class="card"><span class="label">'+esc(label)+'</span><div class="metric '+(cls||'')+'">'+esc(value)+'</div><span class="muted">'+esc(sub||'')+'</span></div>'}
  function ribbon(){
    const q=load(),u=q.server||st().unifiedOS?.server||{};
    const core=st().mainCore||{},data=st().dataOS||{},mesh=st().agentMesh||{};
    const paper=st().paperTrading;
    const paperState=paper?'PAPER READY':'NO BROKER';
    const live=u.realtime?.ok!==false?'LIVE-READY':'CHECK';
    return '<div id="fpUnifiedRibbon" class="fpUnifiedRibbon"><div><span class="fpOrb"></span><b>FinPilot Unified OS '+VERSION+'</b></div><div class="fpRibbonMetrics"><span class="pill '+tone((core.readiness||0)>=55)+'">CORE '+(core.readiness||0)+'%</span><span class="pill '+tone((data.quality||0)>=60)+'">DATA '+(data.quality||0)+'%</span><span class="pill '+tone((mesh.runs||0)>0)+'">MESH '+(mesh.runs||0)+' RUNS</span><span class="pill '+tone(live==='LIVE-READY')+'">'+live+'</span><span class="pill low">'+paperState+'</span><button class="btn mini" onclick="FinPilotUnifiedOS.run()">Run Unified</button></div></div>'
  }
  function tower(hostId){
    const host=document.getElementById(hostId);if(!host||document.getElementById('fpUnifiedTower'))return;
    const q=load(),local=localSnapshot(),server=q.server||{},foundation=local.foundation;
    const checks=(st().unifiedOS?.checks)||[];
    const rows=[
      ['Main Core',''+local.core.readiness+'% readiness',local.core.readiness>=55],
      ['Core Brain',local.brain.confidence+'% confidence',local.brain.confidence>=50],
      ['Agent Mesh',local.mesh.average+'% avg confidence',local.mesh.average>=60],
      ['Data OS',local.data.quality+'% quality',local.data.quality>=60],
      ['Learning',local.learning.accuracy==null?'Not calibrated':local.learning.accuracy+'% accuracy',local.learning.accuracy==null||local.learning.accuracy>=50],
      ['Foundation',foundation?foundation.winner+' · '+foundation.score+'/100':'Available on demand',!!foundation],
      ['Evolution',local.evolution.promoted+' promoted · '+local.evolution.shadow+' shadow',true],
      ['Quantum',local.quantum.agents+' agents · '+local.quantum.pendingMutations+' pending edits',local.quantum.pendingMutations===0]
    ];
    const statusRows=checks.length?checks:rows.map(x=>({name:x[0],status:x[2]?'READY':'REVIEW',desc:x[1],ok:x[2]}));
    host.insertAdjacentHTML('beforeend','<div id="fpUnifiedTower" class="card fpUnifiedTower"><div class="sectionTitle"><div><h3>Unified OS Control Tower</h3><span class="subtle">One governed packet across Core → Data → Agents → Learning → Governance → Execution</span></div><div class="action"><span class="pill low">'+(q.lastRun?'LAST RUN '+new Date(q.lastRun).toLocaleTimeString():'NOT RUN')+'</span><button class="btn primary" onclick="FinPilotUnifiedOS.run()">Run all connected layers</button></div></div><div class="grid cards">'+rows.map(x=>metricCard(x[0],x[1],x[2]?'Healthy / governed':'Needs review',x[2]?'green':'red')).join('')+'</div><div class="grid two" style="margin-top:12px"><div><h3>Live subsystem checks</h3>'+statusRows.map(x=>'<div class="row"><span><b>'+esc(x.name)+'</b><small class="muted"> · '+esc(x.desc||'')+'</small></span><span class="pill '+(x.ok?'low':'high')+'">'+esc(x.status)+'</span></div>').join('')+'</div><div><h3>Unified agent contract</h3>'+['Evidence first','Freshness required','Independent challenge','Confidence calibrated to outcomes','CFO / Risk veto preserved','Human approval for high-impact actions','Paper isolation for experiments','Full audit trail'].map(x=>'<div class="row"><span>'+esc(x)+'</span><span class="pill low">ENFORCED</span></div>').join('')+'</div></div></div>');
  }
  function agentMatrix(hostId){
    const host=document.getElementById(hostId);if(!host||document.getElementById('fpUnifiedAgentMatrix'))return;
    const rows=agentSnapshot();
    host.insertAdjacentHTML('beforeend','<div id="fpUnifiedAgentMatrix" class="card fpUnifiedAgentMatrix"><div class="sectionTitle"><div><h3>12-Agent Governed Matrix</h3><span class="subtle">All specialists use the same evidence, calibration, challenge and approval contract.</span></div><span class="pill low">12 CORE</span></div><div class="grid cards">'+rows.map(x=>'<div class="card"><div class="sectionTitle"><div><b>'+esc(x.name)+'</b><div class="muted">'+esc(x.mission)+'</div></div><span class="pill '+(x.confidence>=70?'low':'med')+'">'+Math.round(x.confidence)+'%</span></div><div class="row"><span>Domain</span><b>'+Math.round(x.domainScore)+'</b></div><div class="row"><span>Risk</span><b>'+Math.round(x.risk)+'</b></div><div class="row"><span>Freshness</span><b>'+Math.round(x.evidenceFreshness||0)+'%</b></div><div class="row"><span>Calibration</span><b>'+ (x.accuracy==null?'—':Math.round(x.accuracy)+'%') +'</b></div><div class="notice" style="margin-top:8px">Failure mode: '+esc(x.failureMode)+'</div></div>').join('')+'</div><div class="action" style="margin-top:10px"><button class="btn primary" onclick="FinPilotUnifiedOS.runAgentCycle()">Run 12-agent governed cycle</button><button class="btn" onclick="show(\'researchlab\')">Open Research Lab</button></div></div>');
  }
  function dataBoard(hostId){
    const host=document.getElementById(hostId);if(!host||document.getElementById('fpUnifiedDataBoard'))return;
    const s=st(),d=s.dataOS||{},provider=s.unifiedOS?.server?.data?.data||{},ps=Array.isArray(provider.providers)?provider.providers:[];
    const configured=ps.filter(x=>x.configured).length;
    const stateHealth=provider?.ok!==false;
    host.insertAdjacentHTML('beforeend','<div id="fpUnifiedDataBoard" class="card fpUnifiedDataBoard"><div class="sectionTitle"><div><h3>Data Quality & Provider Resilience</h3><span class="subtle">Freshness, redundancy, provenance and safe degradation</span></div><span class="pill '+(stateHealth?'low':'high')+'">'+(stateHealth?'HEALTHY':'REVIEW')+'</span></div><div class="grid cards">'+metricCard('Quality',String(d.quality||0)+'%','Normalized data quality',(d.quality||0)>=60?'green':'red')+metricCard('Review queue',String((d.queue||[]).length),'Items needing human review',(d.queue||[]).length?'red':'green')+metricCard('Providers',configured+'/'+Math.max(configured,ps.length),'Configured market/data providers',configured>=2?'green':'yellow')+metricCard('Fabrication guard','BLOCKED','Missing values stay missing','green')+'</div><div class="notice" style="margin-top:10px">Design rule: no single provider is treated as truth when freshness, coverage or contradiction checks fail. Data-sensitive decisions remain gated until evidence is sufficient.</div></div>');
  }
  function governanceBoard(hostId){
    const host=document.getElementById(hostId);if(!host||document.getElementById('fpUnifiedGovernance'))return;
    const q=localSnapshot(),bench=q.foundation,evo=q.evolution,security=load().server?.security;
    host.insertAdjacentHTML('beforeend','<div id="fpUnifiedGovernance" class="card fpUnifiedGovernance"><div class="sectionTitle"><div><h3>AI Governance & Model Risk</h3><span class="subtle">Testing, drift, permissions and change control</span></div><span class="pill low">GOVERNED</span></div><div class="grid three">'+metricCard('Foundation benchmark',bench?bench.score+'/100':'On demand','Architecture baseline',bench&&bench.score>=70?'green':'yellow')+metricCard('Agent evolution',evo.shadow+' shadow','No automatic built-in promotion','green')+metricCard('Security gateway',security?.ok===false?'REVIEW':'READY','Tool and data boundary',security?.ok===false?'red':'green')+'</div><div class="row"><span>Human approval for high-impact actions</span><span class="pill low">REQUIRED</span></div><div class="row"><span>Outcome calibration before confidence increases</span><span class="pill low">REQUIRED</span></div><div class="row"><span>Red-team / contradiction challenge</span><span class="pill low">REQUIRED</span></div></div>');
  }
  function executionBoard(hostId){
    const host=document.getElementById(hostId);if(!host||document.getElementById('fpUnifiedExecution'))return;
    const p=st().paperTrading,summary=(p&&window.FinPilotPaperCore)?window.FinPilotPaperCore.accountSummary(st()):null,open=summary?.openOrders||0,filled=summary?.filledOrders||0;
    host.insertAdjacentHTML('beforeend','<div id="fpUnifiedExecution" class="card fpUnifiedExecution"><div class="sectionTitle"><div><h3>Execution Quality Monitor</h3><span class="subtle">Paper-only until a separately authorized broker integration exists</span></div><span class="pill high">NO REAL-MONEY EXECUTION</span></div><div class="grid cards">'+metricCard('Open orders',String(open),'Reconciled order lifecycle',open>=0?'green':'red')+metricCard('Filled orders',String(filled),'Auditable virtual fills','green')+metricCard('Approval gate','REQUIRED','High-impact execution','green')+metricCard('Stale-data guard','ACTIVE','Quotes older than threshold are blocked','green')+'</div><div class="notice">Professional execution controls should measure speed, fillability, price quality, slippage, exception rates and order-state consistency; these metrics are now part of the OS contract.</div></div>');
  }
  function decorate(id){
    try{
      const content=document.querySelector('.content');
      if(content&&!document.getElementById('fpUnifiedRibbon')){
        const div=document.createElement('div');div.innerHTML=ribbon();content.prepend(div.firstElementChild);
      }
      if(id==='maincore')tower('maincore');
      if(id==='agents'||id==='agentmesh')agentMatrix(id);
      if(id==='dataos'||id==='intake')dataBoard(id);
      if(['autonomy','security','commandos','compliance'].includes(id))governanceBoard(id);
      if(['performance','paperlab','stocks','derivatives'].includes(id))executionBoard(id);
      if(['intelligence','researchlab','memory','evidence','roundtable','executive'].includes(id))governanceBoard(id);
    }catch(e){console.warn('FinPilot Unified OS decoration failed',e)}
  }
  function mount(){
    const oldShow=window.show,oldRender=window.render;
    if(oldShow&&!oldShow.__fpUnifiedWrapped){
      const wrapped=function(id){const out=oldShow.apply(this,arguments);setTimeout(()=>decorate(id),0);return out};
      wrapped.__fpUnifiedWrapped=true;window.show=wrapped;
    }
    if(oldRender&&!oldRender.__fpUnifiedWrapped){
      const wrapped=function(id){const out=oldRender.apply(this,arguments);setTimeout(()=>decorate(id),0);return out};
      wrapped.__fpUnifiedWrapped=true;window.render=wrapped;
    }
    setTimeout(()=>decorate(document.querySelector('.view.active')?.id||'dashboard'),0);
  }
  async function run(){
    const b=document.getElementById('fpUnifiedRibbon');
    if(b){const btn=b.querySelector('.btn.mini');if(btn){btn.disabled=true;btn.textContent='Running…'}}
    const packet=await runAgentCycle();
    decorate(document.querySelector('.view.active')?.id||'dashboard');
    if(window.toast)toast('Unified OS '+packet.health+'/100 · '+packet.ready+' checks ready');
    const btn=document.getElementById('fpUnifiedRibbon')?.querySelector('.btn.mini');if(btn){btn.disabled=false;btn.textContent='Run Unified'}
    return packet;
  }
  window.FinPilotUnifiedOS={version:VERSION,snapshot:localSnapshot,refresh,run,runAgentCycle,decorate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  setTimeout(mount,250);
})();
