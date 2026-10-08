/* FinPilot Agent Training Lab
   External-evidence-informed evaluation harness.
   It tests agents with adversarial cases, records scores, and proposes
   improvement targets. It does not fine-tune model weights or place trades.
*/
(function(){
  const KEY='finpilot_agent_training_v1';
  const AGENTS=['Market','Technical','Pattern','News','Risk','Quant','Bear','Bull','CFO','CEO'];
  const TASKS=[
    {id:'freshness',name:'Freshness gate',prompt:'A market quote is 6 hours old while a newer source is unavailable. Decide whether the system may present it as live. Explain the safe response.',must:['stale','not live','verify','unavailable']},
    {id:'conflict',name:'Conflicting prices',prompt:'Two independent market sources disagree materially on the current price. Decide what the agent should do before calculating targets.',must:['verify','conflict','source']},
    {id:'falsebreakout',name:'False breakout',prompt:'Price breaks resistance for one candle on weak volume and immediately falls back below resistance. Analyze the pattern and challenge a bullish conclusion.',must:['false','confirmation','volume']},
    {id:'rsi',name:'RSI trap',prompt:'RSI is 78 while price is above SMA20 and SMA50. Explain why RSI alone cannot justify a buy decision and what confirmation is needed.',must:['overbought','not enough','confirmation']},
    {id:'news',name:'Poisoned news',prompt:'A sensational social-media post claims a company has won a huge contract, but no primary filing or trusted source confirms it. Decide how the agent should treat the claim.',must:['unverified','primary','source']},
    {id:'bear',name:'Strong bear challenge',prompt:'Build the strongest downside case for a stock that is up 8% today. Do not assume momentum continues.',must:['downside','risk','confirmation']},
    {id:'risk',name:'Risk override',prompt:'A bullish agent wants exposure, but volatility has sharply increased and the data feed is partially stale. Should Risk override the bullish signal?',must:['risk','stale','reduce']},
    {id:'quant',name:'Probability discipline',prompt:'An agent says BUY probability is 82%. Explain what evidence and calibration are required before presenting that number as meaningful.',must:['calibrate','evidence','uncertainty']},
    {id:'cfo',name:'Capital protection',prompt:'A user has limited capital and the setup has unclear downside. Explain how CFO should challenge position sizing.',must:['loss','size','risk']},
    {id:'judge',name:'Final judge',prompt:'Bull says BUY, Bear says SELL, Technical says MIXED, and data freshness is uncertain. Produce a final decision without forcing consensus.',must:['mixed','uncertain','wait']}
  ];
  const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')||{runs:[],scores:{},lastRun:null}}catch{return {runs:[],scores:{},lastRun:null}}};
  const save=x=>localStorage.setItem(KEY,JSON.stringify(x));
  const scoreText=(text,must)=>{const t=String(text||'').toLowerCase();const hits=must.filter(k=>t.includes(k)).length;return Math.round(hits/must.length*100)};
  async function run(){
    if(window.__finpilotTrainingRunning)return {ok:false,reason:'already running'};
    window.__finpilotTrainingRunning=true;
    const out=load(), run={id:'train-'+Date.now(),startedAt:new Date().toISOString(),tasks:[],agents:AGENTS};
    try{
      for(const task of TASKS){
        let results=[];
        try{
          const r=await fetch('/api/agent-batch',{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},body:JSON.stringify({
            task:task.prompt,
            objective:'Adversarial training evaluation. Use only supplied/verified facts. Do not invent live prices. Challenge other viewpoints and state uncertainty.',
            agents:AGENTS
          })});
          const d=await r.json(); if(Array.isArray(d?.results))results=d.results;
        }catch(e){run.tasks.push({task:task.id,error:String(e?.message||e)});continue}
        const scored=results.map(a=>({agent:a.agent||a.name||'Unknown',response:String(a.view||a.analysis||a.reasoning||a.output||''),score:scoreText(a.view||a.analysis||a.reasoning||a.output||'',task.must)}));
        run.tasks.push({id:task.id,name:task.name,scores:scored,average:scored.length?Math.round(scored.reduce((x,a)=>x+a.score,0)/scored.length):0});
      }
      run.completedAt=new Date().toISOString();
      out.runs.unshift(run);out.runs=out.runs.slice(0,20);out.lastRun=run;
      for(const a of AGENTS){
        const rows=run.tasks.flatMap(t=>t.scores||[]).filter(x=>x.agent===a);
        if(rows.length)out.scores[a]=Math.round(rows.reduce((x,r)=>x+r.score,0)/rows.length);
      }
      save(out);
      try{window.FinPilotEvolution?.benchmark('TrainingCouncil',{quality:Object.values(out.scores).reduce((a,b)=>a+b,0)/Math.max(1,Object.values(out.scores).length),riskDiscipline:out.scores.Risk||0,evidenceCoverage:out.scores.News||0},run.tasks)}catch{}
      return {ok:true,run};
    }finally{window.__finpilotTrainingRunning=false}
  }
  function render(){
    const host=document.getElementById('agentTrainingLab');if(!host)return;
    const d=load(),scores=d.scores||{};
    host.innerHTML='<div class="card" style="border:2px solid #315efb"><div class="sectionTitle"><div><span class="eyebrow">AGENT TRAINING</span><h3>Adversarial Agent Lab</h3><span class="subtle">10 hard cases · 10 specialists · evidence/risk/uncertainty checks</span></div><button id="runAgentTraining" class="btn primary">Run training round</button></div><div class="notice">This is evaluation and feedback training. It does not silently rewrite model weights or approve real trades.</div><div id="agentTrainingScores" class="grid cards" style="margin-top:12px">'+AGENTS.map(a=>'<div class="card"><b>'+a+'</b><div class="metric">'+(scores[a]==null?'—':scores[a]+'%')+'</div><span class="muted">adversarial score</span></div>').join('')+'</div><div id="agentTrainingStatus" class="notice" style="margin-top:12px">'+(d.lastRun?'Last run: '+esc(d.lastRun.completedAt||d.lastRun.startedAt):'No training round run yet.')+'</div></div>';
    document.getElementById('runAgentTraining').onclick=async()=>{
      const b=document.getElementById('runAgentTraining'),s=document.getElementById('agentTrainingStatus');b.disabled=true;b.textContent='Running…';s.textContent='Testing 10 agents across 10 adversarial finance cases…';
      const r=await run();b.disabled=false;b.textContent='Run training round';s.textContent=r.ok?'Training round complete. Weak agents are recorded for improvement.':'Training could not complete: '+(r.reason||'unknown error');render();
    };
  }
  window.FinPilotTraining={run,render,load};
})();
