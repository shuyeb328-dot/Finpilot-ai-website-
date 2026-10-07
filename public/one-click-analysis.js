/* FinPilot one-click stock intelligence orchestration.
   Search -> evidence -> Financial Brain -> all agents -> CEO/CFO/Judge -> paper council.
   This is decision support only. It never places a real trade. */
(function(){
  function loadEvolutionEngine(){
    if(window.FinPilotEvolution||document.getElementById('finpilotEvolutionScript'))return;
    const s=document.createElement('script');s.id='finpilotEvolutionScript';s.src='/agent-evolution.js';s.defer=true;document.head.appendChild(s);
  }
  loadEvolutionEngine();
  function loadQuantumControlPlane(){
    if(window.FinPilotQuantum||document.getElementById('finpilotQuantumScript'))return;
    const s=document.createElement('script');s.id='finpilotQuantumScript';s.src='/quantum-ai.js';s.defer=true;document.head.appendChild(s);
  }
  loadQuantumControlPlane();
  let rawDoSearch = null;
  let running = false;

  function escLocal(v){
    return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function buildAgentCycle(){
    refreshBrain();
    const findings=state.findings||[];
    const alerts=[];
    findings.filter(f=>f.severity==='HIGH').forEach(f=>alerts.push({
      title:f.title,reason:f.detail,priority:'HIGH',status:'Pending',source:'Financial Brain',findingId:f.domain
    }));
    const surplus=state.income-state.spending;
    if(surplus>0)alerts.push({
      title:'Protect monthly surplus',
      reason:`${money(surplus)} free cash is available before allocation.`,
      priority:'MEDIUM',status:'Pending',source:'CFO Agent'
    });
    const enabled=AGENTS.map(a=>a[0]).concat((state.agents||[]).filter(a=>a.enabled).map(a=>a.name));
    enabled.forEach(name=>state.agentRuns.unshift({
      agent:name,time:new Date().toISOString(),
      finding:`${name} reviewed ${findings.length} structured findings.`,outcome:'PENDING'
    }));
    state.agentRuns=state.agentRuns.slice(0,100);
    state.actions=alerts;
    state.lastAgent=new Date().toISOString();
    state.memory.push({
      title:'One-click agent fleet cycle',
      text:`${enabled.length} agents reviewed ${findings.length} structured findings.`,
      time:new Date().toLocaleTimeString()
    });
    return {findings,enabled,alerts};
  }

  function buildPaperCouncil(query,web){
    if(!window.FinPilotPaperCore)return null;
    try{
      const p=syncPaperAgents();
      const stance=web?.stance||'Mixed';
      const market={
        symbol:String(query||'STOCK').trim().toUpperCase().slice(0,24),
        price:100,
        momentum:stance==='Positive'?25:stance==='Cautious'?-25:0,
        quality:50,
        valuation:50,
        risk:stance==='Cautious'?72:50,
        evidence:Math.min(90,60+(web?.count||0)*4)
      };
      const round=FinPilotPaperCore.roundTable(state,market);
      p.lastMarket=market;p.lastRound=round;
      return round;
    }catch(e){return null}
  }

  function renderOneClickPanel(q,report){
    const box=document.getElementById('searchResults');
    if(!box)return;
    const e=report.executive||{};
    const web=report.webSignal||{};
    const paper=report.paper;
    const risk=Number(report.risk||0);
    const riskClass=risk>=70?'high':risk>=45?'med':'low';
    const paperLabel=paper?paper.final:'NOT RUN';
    const html=`
      <div id="oneClickResult" class="card" style="margin-bottom:14px;border:2px solid #315efb;background:linear-gradient(180deg,#f8faff,#fff)">
        <div class="sectionTitle">
          <div><span class="eyebrow">FinPilot One-Click Intelligence</span><h3 style="font-size:18px;margin-top:5px">Full decision stack · ${escLocal(q)}</h3></div>
          <span class="pill low">COMPLETE</span>
        </div>
        <div class="grid cards" style="margin-bottom:12px">
          <div class="card"><span class="muted">Web evidence</span><div class="metric">${web.count||0}</div><span class="muted">${escLocal(web.provider||'web')} · ${escLocal(web.stance||'Mixed')}</span></div>
          <div class="card"><span class="muted">Decision risk</span><div class="metric ${riskClass==='high'?'red':riskClass==='med'?'yellow':'green'}">${risk}</div><span class="muted">${escLocal(report.evidenceFreshness||'CHECK')}</span></div>
          <div class="card"><span class="muted">Agent fleet</span><div class="metric">${report.agentCount}</div><span class="muted">specialists completed</span></div>
          <div class="card"><span class="muted">Paper council</span><div class="metric" style="font-size:18px">${escLocal(paperLabel)}</div><span class="muted">virtual only</span></div>
        </div>
        <div class="grid three">
          <div class="decision"><span class="pill low">CEO · OPPORTUNITY</span><p>${escLocal(e.ceo||'No CEO view')}</p><b>${e.ceoConfidence||0}% confidence</b></div>
          <div class="decision"><span class="pill med">CFO · SAFETY</span><p>${escLocal(e.cfo||'No CFO view')}</p><b>${e.cfoConfidence||0}% confidence</b></div>
          <div class="decision"><span class="pill">⚖ JUDGE · FINAL</span><h2>${escLocal(e.judge||report.decision||'VERIFY')}</h2><b>${report.confidence||0}% confidence</b></div>
        </div>
        <div class="notice" style="margin-top:12px"><b>All-in-one pipeline:</b> Internet evidence → Financial Brain → ${report.agentCount} agents → 7-voice Round Table → CEO → CFO → Judge → Action Center → isolated paper council. No real order was placed.</div>
      </div>`;
    const old=document.getElementById('oneClickResult');
    if(old)old.remove();
    box.insertAdjacentHTML('afterbegin',html);
  }

  async function runFullStockAnalysis(query){
    query=String(query||'').trim();
    if(!query||running)return;
    running=true;
    const box=document.getElementById('searchResults');
    if(box)box.insertAdjacentHTML('afterbegin','<div id="oneClickProgress" class="notice" style="margin-bottom:14px"><b>Running full analysis…</b> Search → evidence → agents → CEO/CFO/Judge → paper council</div>');
    try{
      await rawDoSearch(query);
      const cycle=buildAgentCycle();
      const web=liveWebSignal();
      const core=FinPilotDecisionCore.computeExecutiveDecision(state,cycle.findings,web,money,sourceAge);
      const decision={
        decision:core.decision,summary:core.summary,risk:core.risk,confidence:core.confidence,
        findings:cycle.findings.map(f=>f.domain),voices:core.voices,
        evidenceIds:state.evidence.map(e=>e.id),evidenceFreshness:core.evidenceFreshness,
        webSignal:core.webSignal,executive:core.executive,time:new Date().toISOString()
      };
      state.decision=decision;
      state.decisionHistory.unshift(decision);
      state.decisionHistory=state.decisionHistory.slice(0,50);
      const paper=buildPaperCouncil(query,web);
      state.memory.push({title:'One-click full stock analysis',text:`${query}: ${decision.decision}`,time:new Date().toLocaleTimeString()});
      save();
      const report={...decision,agentCount:cycle.enabled.length,paper};
      renderOneClickPanel(query,report);
      const progress=document.getElementById('oneClickProgress');if(progress)progress.remove();
      toast('1-click full analysis complete · all decision layers updated');
    }catch(e){
      const progress=document.getElementById('oneClickProgress');
      if(progress)progress.innerHTML='<b>Analysis stopped.</b> '+escLocal(e?.message||'Unknown error');
      toast('Full analysis failed');
    }finally{running=false}
  }

  function mountSearchActions(){
    const searchForm=document.querySelector('.search');
    if(searchForm&&!document.getElementById('oneClickTop')){
      const b=document.createElement('button');
      b.id='oneClickTop';b.className='btn primary';b.type='button';b.textContent='⚡ Run All';
      b.title='Run the complete FinPilot decision stack for the current search';
      b.onclick=()=>runFullStockAnalysis(document.getElementById('globalSearch')?.value||document.getElementById('searchQuery')?.value||'');
      searchForm.appendChild(b);
    }
  }

  function mountSearchCard(q){
    const box=document.getElementById('searchResults');
    if(!box||document.getElementById('oneClickLauncher'))return;
    const d=document.createElement('div');
    d.id='oneClickLauncher';d.className='decision';
    d.style.marginBottom='14px';
    d.innerHTML='<div class="sectionTitle"><div><span class="eyebrow">Decision automation</span><h3>Run the entire analysis in one click</h3></div><span class="pill low">SEARCH READY</span></div><p class="muted">Uses the live search evidence you just fetched, refreshes the Financial Brain, runs the full agent fleet, reconciles CEO + CFO + Judge, updates Action Center, and runs the isolated paper council.</p><div class="action"><button class="btn primary" type="button">⚡ 1-Click Full Analysis</button><button class="btn" type="button">Open Evidence Ledger</button></div>';
    d.querySelector('.btn.primary').onclick=()=>runFullStockAnalysis(q);
    d.querySelectorAll('.btn')[1].onclick=()=>show('evidence');
    box.prepend(d);
  }


  function installProductionDiagnostics(){
    if(window.__finpilotDiagnosticsInstalled)return;
    window.__finpilotDiagnosticsInstalled=true;
    const showErr=(title,detail)=>{
      let el=document.getElementById('fpBootGuard');
      if(!el){
        el=document.createElement('div');el.id='fpBootGuard';
        el.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#fff;border:1px solid #e4e8ef;border-radius:12px;padding:12px;box-shadow:0 16px 50px rgba(15,23,42,.18);font:13px system-ui;color:#172033';
        document.body.appendChild(el);
      }
      el.style.display='block';
      el.innerHTML='<b style="color:#c23d4f">'+escLocal(title)+'</b><div style="margin-top:5px;color:#6b7688">'+escLocal(detail)+'</div>';
    };
    window.addEventListener('error',e=>showErr('FinPilot frontend error',e.message||'Script failure'));
    window.addEventListener('unhandledrejection',e=>showErr('FinPilot async error',e.reason?.message||String(e.reason||'Unhandled rejection')));
    fetch('/api/health',{cache:'no-store'}).then(async r=>{
      const d=await r.json();
      const s=document.getElementById('engineStatus'),detail=document.getElementById('engineDetail');
      if(s){s.textContent=d.ok?'ONLINE':'OFFLINE';s.style.color=d.ok?'#138a5b':'#c23d4f'}
      if(detail)detail.textContent=d.ok?'Gateway connected · '+new Date().toLocaleTimeString():'Gateway unavailable · local engine only';
    }).catch(e=>{
      const s=document.getElementById('engineStatus'),detail=document.getElementById('engineDetail');
      if(s){s.textContent='OFFLINE';s.style.color='#c23d4f'}
      if(detail)detail.textContent='Gateway unavailable · '+e.message;
    });
  }

  function install(){
    if(!rawDoSearch && typeof window.doSearch==='function'){
      rawDoSearch=window.doSearch;
      window.doSearch=async function(q){
        await rawDoSearch(q);
        mountSearchCard(q);
      };
    }
    mountSearchActions();
  }
  window.runFullStockAnalysis=runFullStockAnalysis;
  window.addEventListener('load',()=>{install();installProductionDiagnostics();});
  setTimeout(()=>{install();installProductionDiagnostics();},0);
  setTimeout(install,100);
})();
