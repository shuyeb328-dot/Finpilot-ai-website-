/* FinPilot Agent Evolution Engine V1
   Benchmark -> shadow candidate -> promotion gate -> rollback.
   This engine never changes a live built-in agent automatically and never places trades.
*/
(function(){
  const KEY='finpilot_agent_evolution_v1';
  const BUILTINS=['CFO','Debt','Goals','Risk','Investment','Markets','Tax','Security','Business','Assets','Research','RedTeam'];
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')||{versions:[],benchmarks:[],events:[],active:{}}}catch{return {versions:[],benchmarks:[],events:[],active:{}}}};
  const save=x=>localStorage.setItem(KEY,JSON.stringify(x));
  function benchmark(agent, candidate, cases){
    const qs=Array.isArray(cases)&&cases.length?cases:[
      {name:'Safety',expected:'protect capital',risk:20},
      {name:'Evidence',expected:'verify evidence',risk:35},
      {name:'Decision',expected:'state uncertainty',risk:50}
    ];
    const base=clamp(candidate?.quality??70), risk=clamp(candidate?.riskDiscipline??75);
    const coverage=clamp(candidate?.evidenceCoverage??70);
    const scores=qs.map((c,i)=>clamp(base*.4+risk*.35+coverage*.25-(Number(c.risk)||0)*.05+i));
    const score=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    const b={id:'bench-'+Date.now(),agent:String(agent),candidate:candidate||{},cases:qs.length,score,passed:score>=70,scores,createdAt:new Date().toISOString()};
    const s=load();s.benchmarks.unshift(b);s.benchmarks=s.benchmarks.slice(0,100);save(s);return b;
  }
  function propose(agent, changes){
    const s=load(), id='ver-'+Date.now(), prior=s.active[agent]||'builtin';
    const v={id,agent:String(agent),changes:changes||{},status:'SHADOW',prior,createdAt:new Date().toISOString()};
    s.versions.unshift(v);s.versions=s.versions.slice(0,100);s.events.unshift({type:'SHADOW',agent,version:id,at:v.createdAt});save(s);return v;
  }
  function promote(id, benchmarkId){
    const s=load(),v=s.versions.find(x=>x.id===id),b=s.benchmarks.find(x=>x.id===benchmarkId);
    if(!v)throw new Error('Candidate not found'); if(!b)throw new Error('Benchmark required');
    if(b.agent!==v.agent)throw new Error('Benchmark agent mismatch');
    if(!b.passed)throw new Error('Promotion gate failed');
    if(BUILTINS.includes(v.agent)){v.status='APPROVED_PROPOSAL';}
    else {v.status='PROMOTED';s.active[v.agent]=v.id;}
    s.events.unshift({type:v.status,agent:v.agent,version:id,benchmark:benchmarkId,at:new Date().toISOString()});save(s);return v;
  }
  function rollback(agent){
    const s=load(),id=s.active[agent]; if(!id)return {ok:false,reason:'No promoted candidate'};
    const v=s.versions.find(x=>x.id===id); delete s.active[agent];
    if(v)v.status='ROLLED_BACK';
    s.events.unshift({type:'ROLLBACK',agent,version:id,at:new Date().toISOString()});save(s);
    return {ok:true,agent,version:id};
  }
  function report(agent){
    const s=load();return {agent,active:s.active[agent]||null,versions:s.versions.filter(x=>x.agent===agent).slice(0,10),benchmarks:s.benchmarks.filter(x=>x.agent===agent).slice(0,10)};
  }
  function snapshot(){const s=load();return {version:'EVO-1.0',promoted:Object.keys(s.active).length,shadow:s.versions.filter(x=>x.status==='SHADOW').length,benchmarks:s.benchmarks.length,events:s.events.length}}
  window.FinPilotEvolution={benchmark,propose,promote,rollback,report,snapshot};
})();
