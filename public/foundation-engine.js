/* FinPilot Foundation Engine 1.0
   Structural benchmark for the decision/agent operating system.
   48 candidates = 6 architectures x 8 governance profiles.
   The benchmark is deterministic, auditable and advisory: it cannot mutate
   security, compliance or execution policy by itself.
*/
(function(){
  const VERSION='FOUNDATION-1.0';
  const KEY='finpilot_foundation_v1';

  const architectures=[
    {id:'event_mesh',name:'Event Mesh',traits:{safety:8,evidence:9,adaptability:10,latency:9,auditability:8,modularity:9,explainability:7}},
    {id:'layered_pipeline',name:'Layered Pipeline',traits:{safety:9,evidence:9,adaptability:7,latency:7,auditability:9,modularity:8,explainability:9}},
    {id:'blackboard',name:'Blackboard Intelligence',traits:{safety:7,evidence:10,adaptability:9,latency:6,auditability:7,modularity:8,explainability:8}},
    {id:'hierarchical',name:'Hierarchical Council',traits:{safety:10,evidence:8,adaptability:7,latency:6,auditability:10,modularity:7,explainability:10}},
    {id:'swarm',name:'Specialist Swarm',traits:{safety:6,evidence:8,adaptability:10,latency:5,auditability:6,modularity:10,explainability:6}},
    {id:'hybrid_mesh',name:'Governed Hybrid Mesh',traits:{safety:10,evidence:10,adaptability:10,latency:8,auditability:10,modularity:10,explainability:9}}
  ];
  const policies=[
    {id:'approval_first',name:'Approval First',bonus:{safety:4,auditability:3,explainability:2,latency:-1}},
    {id:'evidence_first',name:'Evidence First',bonus:{evidence:5,explainability:2,adaptability:1}},
    {id:'risk_first',name:'Risk First',bonus:{safety:5,auditability:2,latency:-1}},
    {id:'cfo_veto',name:'CFO Veto',bonus:{safety:4,auditability:4,explainability:3,latency:-1}},
    {id:'dual_control',name:'Dual Control',bonus:{safety:5,auditability:5,explainability:2,latency:-2}},
    {id:'adaptive_review',name:'Adaptive Review',bonus:{adaptability:5,evidence:2,latency:1}},
    {id:'zero_trust',name:'Zero Trust',bonus:{safety:5,auditability:5,evidence:2,latency:-2}},
    {id:'balanced_governance',name:'Balanced Governance',bonus:{safety:3,evidence:3,adaptability:3,auditability:3,modularity:3,explainability:3}}
  ];
  const weights={safety:.20,evidence:.16,adaptability:.16,latency:.10,auditability:.14,modularity:.12,explainability:.12};

  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
  function candidate(architecture,policy){
    const raw={};
    for(const k of Object.keys(weights)){
      raw[k]=clamp((architecture.traits[k]||0)+(policy.bonus[k]||0),0,15);
    }
    const score=Object.entries(weights).reduce((sum,[k,w])=>sum+(raw[k]/15)*100*w,0);
    const penalties=(raw.latency<5?3:0)+(raw.safety<8?8:0)+(raw.auditability<8?5:0);
    return {
      id:architecture.id+'__'+policy.id,
      architecture:architecture.name,
      policy:policy.name,
      scores:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Number(v.toFixed(1))])),
      score:Number(clamp(score-penalties).toFixed(2)),
      foundation:architecture.id==='hybrid_mesh'&&['dual_control','zero_trust','balanced_governance'].includes(policy.id)
        ? 'Preferred production family'
        : 'Benchmark candidate'
    };
  }
  function benchmark(){
    const candidates=[];
    for(const a of architectures)for(const p of policies)candidates.push(candidate(a,p));
    candidates.sort((a,b)=>b.score-a.score||b.scores.safety-a.scores.safety||b.scores.auditability-a.scores.auditability);
    return {
      version:VERSION,ranAt:new Date().toISOString(),candidateCount:candidates.length,
      criteria:Object.keys(weights),weights,top:candidates.slice(0,10),candidates,
      winner:candidates[0],
      recommendation:'Use the winning foundation as the structural baseline; preserve human approval, CFO veto, evidence freshness, audit logs and bounded self-optimization as non-negotiable controls.'
    };
  }
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}}
  function save(report){try{localStorage.setItem(KEY,JSON.stringify(report))}catch{}}
  function runBenchmark(){const r=benchmark();save(r);return r}
  function getReport(){return load()||runBenchmark()}

  function quantumSearchSignal(query,web){
    const q=String(query||'').trim();
    const lower=q.toLowerCase();
    const intents=[
      ['market',['stock','share','nifty','sensex','crypto','btc','eth','market','price','option','future']],
      ['company',['company','business','revenue','profit','deal','merger','acquisition','irfc','railway']],
      ['risk',['risk','safe','downside','loss','debt','default','fraud','warning']],
      ['portfolio',['portfolio','allocation','diversification','investment','invest']],
      ['macro',['inflation','rate','rbi','fed','economy','macro','gold']],
      ['research',['why','compare','analysis','research','target','valuation']]
    ];
    const matched=intents.filter(([,words])=>words.some(w=>lower.includes(w))).map(([id])=>id);
    const intent=matched[0]||'research';
    const evidenceCount=Number(web?.count||0);
    const freshness=web?.stance?'LIVE':'LOCAL';
    const signalConfidence=clamp(58+Math.min(20,evidenceCount*3)+(web?.confidence?Math.min(12,Number(web.confidence)*.12):0)+(freshness==='LIVE'?5:0));
    return {
      query:q||'current financial state',
      intent,matchedIntents:matched.length?matched:['research'],
      evidenceCount,stance:web?.stance||'Mixed',freshness,
      confidence:Number(signalConfidence.toFixed(1)),
      route:['Quantum Search','Research/Evidence','Specialist Agents','Round Table','CEO','CFO','Judge'],
      guard:'Search evidence informs the decision but never bypasses CFO veto, compliance or human approval.'
    };
  }

  function mountStatus(){
    if(document.getElementById('foundation-status'))return;
    const r=getReport();
    const el=document.createElement('div');el.id='foundation-status';
    el.style.cssText='position:fixed;left:10px;bottom:10px;z-index:70;font:10px system-ui;color:#667085;background:rgba(255,255,255,.9);border:1px solid #e5e7eb;border-radius:999px;padding:5px 8px;backdrop-filter:blur(8px)';
    el.textContent='Foundation '+r.winner.id+' · '+r.winner.score+'/100 · '+r.candidateCount+' tested';
    document.body.appendChild(el);
  }

  window.FinPilotFoundation={version:VERSION,architectures,policies,benchmark,runBenchmark,getReport,quantumSearchSignal,mountStatus};
  window.addEventListener('load',mountStatus);setTimeout(mountStatus,200);
})();