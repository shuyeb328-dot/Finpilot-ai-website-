/* FinPilot Quantum AI Control Plane
   Master orchestrator for the existing finance agents.
   It coordinates agents; proposed agent mutations are sandboxed and require approval.
*/
(function(){
  const VERSION='QAI-5.0';
  const KEY='finpilot_quantum_control_v1';
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const builtins=[
    ['CFO','Capital, cash flow and financial safety'],['Debt','Debt strategy and interest burden'],
    ['Goals','Goal probability and planning'],['Risk','Downside, stress and risk gates'],
    ['Investment','Portfolio and valuation'],['Markets','Market intelligence and price context'],
    ['Tax','Tax efficiency and compliance research'],['Security','Fraud, privacy and operational security'],
    ['Business','Business and deal analysis'],['Assets','Asset allocation and balance sheet'],
    ['Research','Evidence discovery and adaptive research'],['RedTeam','Adversarial challenge and failure hunting']
  ];
  function load(){
    try{return JSON.parse(localStorage.getItem(KEY)||'null')||{runs:[],mutations:[],messages:[],policies:{highRiskApproval:true,maxParallel:8},version:VERSION}}
    catch{return {runs:[],mutations:[],messages:[],policies:{highRiskApproval:true,maxParallel:8},version:VERSION}}
  }
  function save(q){localStorage.setItem(KEY,JSON.stringify(q))}
  function appState(){
    try{return JSON.parse(localStorage.getItem('finpilot_web_v2300')||localStorage.getItem('finpilot_web_v1800')||'null')||{}}
    catch{return {}}
  }
  function agents(){
    const s=appState(), custom=Array.isArray(s.agents)?s.agents:[];
    return builtins.map((x,i)=>({id:'builtin-'+i,name:x[0],role:x[1],kind:'core',enabled:true}))
      .concat(custom.map(x=>({id:x.id,name:x.name,role:x.role||x.objective||'Custom specialist',kind:'custom',enabled:x.enabled!==false})));
  }
  function scoreAgent(a,s){
    const runs=(s.agentRuns||[]).filter(x=>x.agent===a.name);
    const avg=runs.length?runs.reduce((n,x)=>n+Number(x.confidence||65),0)/runs.length:65;
    return Math.round(Math.max(0,Math.min(100,avg)));
  }
  function plan(goal){
    const q=load(),s=appState(),as=agents();
    const text=String(goal||'').trim()||'Analyze the current financial situation and produce the safest high-value decision.';
    const selected=as.filter(a=>a.enabled).slice(0,Math.max(1,Number(q.policies.maxParallel)||8));
    const route=selected.map(a=>({agent:a.name,role:a.role,task:'Evaluate the goal from your domain',score:scoreAgent(a,s)}));
    const risk=/trade|buy|sell|invest|payment|transfer|withdraw|debt/i.test(text)?'HIGH':'MEDIUM';
    const run={id:'qrun-'+Date.now(),goal:text,risk,status:risk==='HIGH'&&q.policies.highRiskApproval?'AWAITING_APPROVAL':'PLANNED',route,createdAt:new Date().toISOString()};
    q.runs.unshift(run);q.runs=q.runs.slice(0,50);save(q);return run;
  }
  function broadcast(run){
    const q=load(),msgs=[];
    for(const r of run.route){
      msgs.push({id:'msg-'+Date.now()+'-'+r.agent,from:'QUANTUM',to:r.agent,type:'DELEGATE',content:run.goal,createdAt:new Date().toISOString()});
    }
    q.messages.unshift(...msgs);q.messages=q.messages.slice(0,200);save(q);return msgs;
  }
  function proposeMutation(agent,field,value,reason){
    const q=load(),target=agents().find(a=>a.name===agent);
    if(!target)throw new Error('Agent not found');
    const m={id:'mut-'+Date.now(),agent,field,oldValue:field==='role'?target.role:'',newValue:String(value||''),reason:String(reason||'Quantum optimization'),status:'PROPOSED',createdAt:new Date().toISOString()};
    q.mutations.unshift(m);q.mutations=q.mutations.slice(0,100);save(q);return m;
  }
  function approveMutation(id){
    const q=load(),m=q.mutations.find(x=>x.id===id);if(!m)throw new Error('Mutation not found');
    m.status='APPROVED';m.approvedAt=new Date().toISOString();save(q);
    // Only custom agents can be changed automatically. Built-ins receive an immutable proposal.
    if(!m.agent.startsWith('builtin-') && m.agent!=='CFO' && m.agent!=='Debt'){
      try{
        const s=appState();const a=(s.agents||[]).find(x=>x.name===m.agent);
        if(a&&m.field==='role')a.role=m.newValue;
        if(a&&m.field==='objective')a.objective=m.newValue;
        if(a){localStorage.setItem('finpilot_web_v2300',JSON.stringify(s));m.status='APPLIED'}
      }catch{}
    }
    save(q);return m;
  }
  function snapshot(){
    const q=load(),s=appState(),as=agents();
    return {version:VERSION,agents:as.length,enabled:as.filter(a=>a.enabled).length,
      agentScores:as.map(a=>({name:a.name,score:scoreAgent(a,s)})),
      quantumRuns:q.runs.length,pendingMutations:q.mutations.filter(x=>x.status==='PROPOSED').length,
      messages:q.messages.length,decision:s.decision?.decision||'No decision yet',
      evidence:(s.evidence||[]).length,paperOrders:(s.paperTrading?.orders||[]).length,
      researchRuns:(s.researchRuns||[]).length};
  }
  function render(){
    let el=document.getElementById('quantum-ai');if(!el){el=document.createElement('div');el.id='quantum-ai';document.body.appendChild(el)}
    const q=load(),snap=snapshot(),s=appState(),recent=q.runs[0],mut=q.mutations.filter(x=>x.status==='PROPOSED').slice(0,5);
    el.innerHTML='<div id="qai-panel" style="position:fixed;inset:0;z-index:1000;background:rgba(8,15,30,.52);display:flex;justify-content:flex-end">'+
      '<section style="width:min(760px,100%);height:100%;overflow:auto;background:#fff;box-shadow:-20px 0 60px rgba(0,0,0,.25);padding:20px;font:14px system-ui;color:#172033">'+
      '<div style="display:flex;justify-content:space-between;align-items:start"><div><div style="font-size:11px;letter-spacing:.12em;font-weight:800;color:#315efb">QUANTUM AI CONTROL PLANE · '+VERSION+'</div><h1 style="margin:5px 0">Master Intelligence</h1><p style="color:#6b7688">One control layer linked to every FinPilot specialist, evidence source, research engine, paper arena and decision gate.</p></div><button id="qclose" class="btn">Close</button></div>'+
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:15px 0">'+
      [['Agents',snap.agents],['Active',snap.enabled],['Evidence',snap.evidence],['Pending edits',snap.pendingMutations]].map(x=>'<div style="border:1px solid #e4e8ef;border-radius:10px;padding:12px"><small style="color:#6b7688">'+x[0]+'</small><div style="font-size:22px;font-weight:800">'+x[1]+'</div></div>').join('')+'</div>'+
      '<div style="border:1px solid #d8e0ef;border-radius:12px;padding:15px;margin-bottom:12px"><b>Quantum command</b><div style="display:flex;gap:8px;margin-top:10px"><input id="qgoal" style="flex:1;padding:10px;border:1px solid #d8dee8;border-radius:8px" placeholder="Example: Analyze IRFC and determine the safest action"><button id="qplan" class="btn primary">Plan</button><button id="qrun" class="btn good">Plan + Delegate</button></div><div id="qout" style="margin-top:10px"></div></div>'+
      '<div style="border:1px solid #d8e0ef;border-radius:12px;padding:15px;margin-bottom:12px"><b>Agent network</b><p style="color:#6b7688;margin:5px 0 10px">Quantum can delegate work to all enabled agents and compare their outputs before the CEO/CFO/Judge layer.</p><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px">'+snap.agentScores.map(a=>'<div style="padding:9px;border:1px solid #edf0f4;border-radius:8px"><b>'+esc(a.name)+'</b><span style="float:right">'+a.score+'%</span></div>').join('')+'</div></div>'+
      '<div style="border:1px solid #d8e0ef;border-radius:12px;padding:15px;margin-bottom:12px"><b>Self-improvement / agent modification</b><p style="color:#6b7688;margin:5px 0 10px">Quantum proposes changes to agent roles/objectives. High-impact changes stay behind an approval gate.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><select id="qagent" style="padding:10px;border:1px solid #d8dee8;border-radius:8px">'+snap.agentScores.map(a=>'<option>'+esc(a.name)+'</option>').join('')+'</select><select id="qfield" style="padding:10px;border:1px solid #d8dee8;border-radius:8px"><option value="objective">objective</option><option value="role">role</option></select></div><input id="qvalue" style="width:100%;margin-top:8px;padding:10px;border:1px solid #d8dee8;border-radius:8px" placeholder="New objective or role"><button id="qmutate" class="btn primary" style="margin-top:8px">Propose modification</button></div>'+
      '<div style="border:1px solid #ead8aa;background:#fffaf0;border-radius:12px;padding:15px"><b>Approval queue</b><div id="qmutations" style="margin-top:8px">'+(mut.length?mut.map(m=>'<div style="padding:10px 0;border-bottom:1px solid #f0e1bc"><b>'+esc(m.agent)+'</b> · '+esc(m.field)+' → '+esc(m.newValue)+'<div style="color:#6b7688">'+esc(m.reason)+'</div><button class="btn good qapprove" data-id="'+m.id+'" style="margin-top:6px">Approve</button></div>').join(''):'<span style="color:#6b7688">No pending agent modifications.</span>')+'</div></div>'+
      '<div style="margin-top:12px;color:#6b7688;font-size:11px">Decision support only. Quantum never bypasses FinPilot approval gates or places real trades. Existing Paper Arena remains virtual.</div>'+
      '</section></div>';
    document.getElementById('qclose').onclick=()=>el.remove();
    document.getElementById('qplan').onclick=()=>{const r=plan(document.getElementById('qgoal').value);document.getElementById('qout').innerHTML='<b>Plan created:</b> '+esc(r.status)+' · '+r.route.length+' agents selected.';};
    document.getElementById('qrun').onclick=()=>{const r=plan(document.getElementById('qgoal').value);broadcast(r);document.getElementById('qout').innerHTML='<b>Delegated:</b> '+r.route.map(x=>esc(x.agent)).join(' · ')+'<br><span style="color:#6b7688">Next: reconcile responses through Round Table → CEO → CFO → Judge.</span>';};
    document.getElementById('qmutate').onclick=()=>{try{const m=proposeMutation(document.getElementById('qagent').value,document.getElementById('qfield').value,document.getElementById('qvalue').value,'Proposed by Quantum Control Plane');document.getElementById('qout').innerHTML='<b>Mutation queued:</b> '+esc(m.agent)+' · approval required';setTimeout(render,200)}catch(e){document.getElementById('qout').textContent=e.message}};
    document.querySelectorAll('.qapprove').forEach(b=>b.onclick=()=>{approveMutation(b.dataset.id);render()});
  }
  function mount(){
    if(!window.FinPilotQuantumV5&&!document.getElementById('quantumV5Script')){
      const s=document.createElement('script');s.id='quantumV5Script';s.src='/quantum-v5-ui.js';s.defer=true;document.head.appendChild(s)
    }
    if(document.getElementById('quantum-launcher'))return;
    const b=document.createElement('button');b.id='quantum-launcher';b.className='btn primary';b.textContent='◈ Quantum AI';
    b.style.cssText='position:fixed;right:14px;bottom:14px;z-index:90;box-shadow:0 10px 30px rgba(49,94,251,.25)';
    b.onclick=render;document.body.appendChild(b);
  }
  window.FinPilotQuantum={version:VERSION,plan,broadcast,proposeMutation,approveMutation,snapshot,render};
  window.addEventListener('load',mount);setTimeout(mount,50);
})();