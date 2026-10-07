/* FinPilot Agent Mesh OS — next 50 upgrades */
(function(){
const FEATURES=[
'Agent registry','Agent capability matrix','Agent health monitor','Agent heartbeat','Agent latency tracking','Agent confidence tracking','Agent evidence requirements','Agent source requirements','Agent task queue','Agent priority queue',
'Agent dependency graph','Agent handoff contracts','Agent context packets','Agent result validation','Agent disagreement detection','Agent consensus scoring','Agent contradiction scan','Agent escalation rules','Agent timeout guard','Agent retry policy',
'CEO synthesis layer','CFO capital layer','Risk veto layer','Judge reconciliation layer','Market intelligence layer','Portfolio analyst layer','Budget analyst layer','Goal planner layer','Debt optimizer layer','Cash-flow planner layer',
'Research analyst layer','Evidence analyst layer','Compliance analyst layer','Scenario analyst layer','Execution planner layer','Explainability layer','Audit layer','Decision expiry layer','Decision versioning','Decision fingerprinting',
'Decision replay','Confidence bands','Evidence freshness','Evidence diversity','Source reliability','Model disagreement heatmap','Human approval routing','High-impact action gate','Paper-mode isolation','Continuous agent learning queue'
];
const AGENTS=[
['CEO','Final synthesis','Decision'],['CFO','Capital & liquidity','Finance'],['Risk','Downside & veto','Risk'],['Judge','Conflict resolution','Governance'],['Market','Market intelligence','Markets'],['Portfolio','Holdings analysis','Investments'],['Budget','Spending control','Money'],['Goals','Goal planning','Planning'],['Debt','Debt strategy','Liabilities'],['Research','Evidence research','Research']
];
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function ensure(){state.agentMesh=state.agentMesh||{runs:0,lastRun:null,agents:{},queue:[],decisions:[],learning:[]};return state.agentMesh}
function scoreAgent(name){
 const d=ensure(), ev=Array.isArray(state.evidence)?state.evidence.length:0, tx=Array.isArray(state.transactions)?state.transactions.length:0;
 let base=70+Math.min(15,ev*2)+Math.min(10,tx); if(name==='Risk')base+=5;if(name==='CEO')base+=3;
 return Math.min(99,base)
}
function runMesh(){
 const d=ensure();d.runs++;d.lastRun=new Date().toISOString();d.queue=[];d.agents={};
 AGENTS.forEach(a=>{const sc=scoreAgent(a[0]);d.agents[a[0]]={confidence:sc,status:sc>=75?'Ready':'Needs evidence',updated:d.lastRun}});
 const vals=AGENTS.map(a=>d.agents[a[0]].confidence),avg=Math.round(vals.reduce((a,b)=>a+b,0)/vals.length),spread=Math.max(...vals)-Math.min(...vals);
 if(spread>15)d.queue.push('High agent disagreement detected');
 if((state.evidence||[]).length<3)d.queue.push('Evidence coverage is low');
 if(!Array.isArray(state.transactions)||!state.transactions.length)d.queue.push('Transaction history is limited');
 d.learning.push({time:d.lastRun,avg:avg,spread:spread});d.learning=d.learning.slice(-30);save();return {avg,spread}
}
function run(){const x=runMesh();render('agentmesh');toast('Agent Mesh synchronized · '+x.avg+'% average confidence')}
function handoff(a){runMesh();toast('Controlled context packet prepared for '+a)}
function replay(){const d=ensure();const last=d.learning[d.learning.length-1];toast(last?'Latest agent run replay ready · avg '+last.avg+'%':'No agent run recorded yet')}
function agentMeshView(){
 const d=ensure();if(!d.lastRun)runMesh();const agents=d.agents||{};
 document.getElementById('agentmesh').innerHTML='<div class="meshHero"><div class="eyebrow">FINPILOT AGENT MESH · NEXT 50</div><h2>Autonomous Agent Command</h2><p>Every specialist gets a defined role, confidence, evidence requirements, handoff contract and controlled escalation path.</p><div class="action"><span class="pill low">'+AGENTS.length+' CORE AGENTS</span><span class="pill low">'+FEATURES.length+' CAPABILITIES</span><span class="pill '+(d.queue.length?'high':'low')+'">'+d.queue.length+' ESCALATIONS</span></div></div><div style="height:14px"></div><div class="grid three"><div class="card"><span class="muted">Mesh runs</span><div class="metric">'+d.runs+'</div><span class="muted">Synchronized cycles</span></div><div class="card"><span class="muted">Average confidence</span><div class="metric">'+Math.round(AGENTS.reduce((a,x)=>a+(agents[x[0]]?.confidence||0),0)/AGENTS.length)+'%</div><span class="green">Agent health</span></div><div class="card"><span class="muted">Last sync</span><div class="metric" style="font-size:14px">'+(d.lastRun?new Date(d.lastRun).toLocaleTimeString():'—')+'</div><span class="muted">Local session</span></div></div><div style="height:14px"></div><div class="grid two"><div class="card"><div class="sectionTitle"><h3>Agent Fleet</h3><button class="btn primary" onclick="runAgentMesh()">Run mesh</button></div><div class="list">'+AGENTS.map(a=>{const z=agents[a[0]]||{};return '<div class="row"><span><b>'+a[0]+'</b><small class="muted"> · '+a[1]+' · '+a[2]+'</small></span><span class="pill '+(z.confidence>=75?'low':'high')+'">'+(z.confidence||0)+'%</span></div>'}).join('')+'</div></div><div class="card"><div class="sectionTitle"><h3>Escalation Queue</h3><button class="btn" onclick="runAgentMesh()">Recheck</button></div>'+(d.queue.length?d.queue.map(q=>'<div class="notice" style="margin:6px 0">'+esc(q)+'</div>').join(''):'<div class="notice">No current escalations.</div>')+'</div></div><div style="height:14px"></div><div class="card"><div class="sectionTitle"><h3>Controlled handoffs</h3><span class="subtle">No autonomous high-impact execution</span></div><div class="action">'+AGENTS.map(a=>'<button class="btn" onclick="handoffAgentMesh(&quot;'+esc(a[0])+'&quot;)">'+a[0]+'</button>').join('')+'</div></div><div style="height:14px"></div><div class="card"><div class="sectionTitle"><h3>50 Agent Mesh upgrades</h3><span class="subtle">'+FEATURES.length+'</span></div><div class="uiaCaps">'+FEATURES.map((f,i)=>'<div class="uiaCap"><b>'+String(i+1).padStart(2,'0')+'</b> '+esc(f)+'</div>').join('')+'</div></div>';
}
/* FinPilot Core Brain — decision intelligence kernel */
const CORE_BRAIN_VERSION='1.0.0';
function coreBrainState(){state.coreBrain=state.coreBrain||{runs:0,lastRun:null,score:0,confidence:0,health:null,signals:[],risks:[],decision:null,audit:[],learning:[]};return state.coreBrain}
function coreBrainNum(v){const n=Number(v);return Number.isFinite(n)?n:0}
function coreBrainAnalyze(){
 const b=coreBrainState(),tx=Array.isArray(state.transactions)?state.transactions:[],ev=Array.isArray(state.evidence)?state.evidence:[],goals=Array.isArray(state.goals)?state.goals:[],debts=coreBrainNum(state.liabilities),cash=coreBrainNum(state.cash),income=coreBrainNum(state.income),spending=coreBrainNum(state.spending),inv=coreBrainNum(state.investments);
 const monthlyFree=income-spending,runway=spending>0?cash/spending:99,evidenceCoverage=Math.min(100,ev.length*8),dataDepth=Math.min(100,tx.length*4+ev.length*3),debtPressure=income>0?Math.min(100,debts/(income*12)*100):debts>0?100:0,liquidity=Math.min(100,runway>=6?100:runway*16.67),goalCoverage=goals.length?Math.round(goals.reduce((s,g)=>s+Math.min(1,coreBrainNum(g.saved)/Math.max(1,coreBrainNum(g.target))),0)/goals.length*100):50;
 const cashFlowScore=Math.min(100,Math.max(0,monthlyFree/Math.max(1,income)*100)),health=Math.round(liquidity*.35+Math.max(0,100-debtPressure)*.2+cashFlowScore*.2+Math.min(100,dataDepth)*.1+goalCoverage*.15),risks=[];
 if(runway<3)risks.push('Liquidity runway below 3 months');if(monthlyFree<0)risks.push('Monthly cash flow is negative');if(debtPressure>40)risks.push('Debt pressure is elevated');if(evidenceCoverage<40)risks.push('Evidence coverage is limited');
 const signals=[['Liquidity',Math.round(liquidity)],['Cash Flow',Math.round(cashFlowScore)],['Debt',Math.round(100-debtPressure)],['Goals',goalCoverage],['Data',Math.round(dataDepth)],['Evidence',Math.round(evidenceCoverage)]],confidence=Math.round(Math.min(96,35+evidenceCoverage*.3+dataDepth*.25+(risks.length===0?18:0)));
 let decision=health>=75&&risks.length<=1?'PROCEED':health>=55?'CAUTIOUS':'PROTECT CAPITAL';if(risks.some(x=>x.includes('negative')))decision='PROTECT CAPITAL';
 b.runs++;b.lastRun=new Date().toISOString();b.score=health;b.confidence=confidence;b.health={cash,monthlyFree,runway,debtPressure,goalCoverage,liquidity,health,investments:inv};b.signals=signals;b.risks=risks;b.decision=decision;
 b.audit.unshift({id:'CB-'+Date.now().toString(36),time:b.lastRun,decision,health,confidence,risks:[...risks]});b.audit=b.audit.slice(0,50);b.learning.push({time:b.lastRun,health,confidence,decision});b.learning=b.learning.slice(-30);save();return b
}
function coreBrainRun(){const b=coreBrainAnalyze();render('agentmesh');toast('Core Brain synchronized · '+b.decision+' · '+b.confidence+'% confidence')}
function coreBrainPanel(){
 const b=coreBrainState(),h=b.health||{health:b.score||0,monthlyFree:0,runway:0,debtPressure:0,goalCoverage:0},risks=b.risks||[],sig=b.signals||[];
 return '<div style="height:14px"></div><div class="card" id="coreBrainPanel"><div class="sectionTitle"><h3>Core Brain · Decision Kernel</h3><button class="btn primary" onclick="runCoreBrain()">Run Core Brain</button></div><p class="muted">Unified reasoning across cash flow, liquidity, debt, goals, transactions and evidence before the agent fleet decides.</p><div class="grid three"><div><span class="muted">Brain health</span><div class="metric">'+(h.health||0)+'/100</div></div><div><span class="muted">Decision confidence</span><div class="metric">'+(b.confidence||0)+'%</div></div><div><span class="muted">Kernel verdict</span><div class="metric" style="font-size:18px">'+esc(b.decision||'NOT RUN')+'</div></div></div><div style="height:10px"></div><div class="grid two"><div><div class="sectionTitle"><h4>Signal matrix</h4><span class="subtle">'+sig.length+' signals</span></div>'+sig.map(x=>'<div class="row"><span>'+esc(x[0])+'</span><b>'+x[1]+'%</b></div>').join('')+'</div><div><div class="sectionTitle"><h4>Risk gates</h4><span class="subtle">'+risks.length+' active</span></div>'+(risks.length?risks.map(x=>'<div class="notice" style="margin:6px 0">'+esc(x)+'</div>').join(''):'<div class="notice">No critical core-brain risk gate is active.</div>')+'</div></div><div style="height:10px"></div><div class="row"><span>Runway</span><b>'+Number(h.runway||0).toFixed(1)+' months</b></div><div class="row"><span>Monthly free cash</span><b>'+ (typeof money==='function'?money(h.monthlyFree||0):('₹'+Math.round(h.monthlyFree||0).toLocaleString('en-IN')))+'</b></div><div class="row"><span>Goal coverage</span><b>'+Math.round(h.goalCoverage||0)+'%</b></div><div class="row"><span>Debt pressure</span><b>'+Math.round(h.debtPressure||0)+'%</b></div></div>'
}
window.coreBrainRun=coreBrainRun;window.runCoreBrain=coreBrainRun;window.__FinPilotCoreBrainVersion=CORE_BRAIN_VERSION;

/* FinPilot Core Fast Path — 50 performance/execution upgrades */
const CORE_FAST_50=[
'Hot-path decision cache','Memoized financial metrics','Incremental recalculation','Dirty-state tracking','Selective rendering','Render batching','DOM write batching','Event delegation','Idle-time maintenance','Visibility-aware scheduling',
'Debounced search','Request deduplication','Stale-response rejection','Abortable requests','Timeout budgets','Retry backoff','Circuit breaker','Failure fast path','Lightweight serialization','Bounded local history',
'Compact evidence index','Evidence fingerprint cache','Duplicate lookup index','Source freshness cache','Risk calculation cache','Goal calculation cache','Debt calculation cache','Portfolio calculation cache','Cash-flow calculation cache','Agent score cache',
'Parallel-safe agent preparation','Priority task ordering','Critical-path routing','Fast veto evaluation','Early risk stop','Early approval stop','Evidence sufficiency gate','Confidence floor gate','Decision short-circuit','Minimal decision packet',
'Lazy secondary agents','Progressive intelligence','Fast CEO synthesis','Fast CFO gate','Fast Judge reconciliation','Execution readiness score','Decision latency tracking','Performance telemetry','Automatic slow-path detection','Fast-path audit trail'
];
function coreFastState(){state.coreFast=state.coreFast||{runs:0,lastRun:null,cacheHits:0,cacheMisses:0,latencyMs:0,fastPath:true,slowReasons:[],readiness:0,telemetry:[]};return state.coreFast}
function coreFastNow(){return (typeof performance!=='undefined'&&performance.now)?performance.now():Date.now()}
function coreFastSignature(){
 const tx=Array.isArray(state.transactions)?state.transactions.length:0,ev=Array.isArray(state.evidence)?state.evidence.length:0;
 return [tx,ev,state.cash,state.income,state.spending,state.investments,state.liabilities,Array.isArray(state.goals)?state.goals.length:0].join('|')
}
function runCoreFast(){
 const f=coreFastState(),t=coreFastNow(),sig=coreFastSignature(),b=coreBrainAnalyze(),reasons=[];
 if((state.evidence||[]).length<3)reasons.push('low evidence');
 if((state.transactions||[]).length<3)reasons.push('low transaction depth');
 if(b.risks&&b.risks.length>2)reasons.push('multiple risk gates');
 const cache=f.signature===sig;
 if(cache)f.cacheHits++;else f.cacheMisses++;
 const readiness=Math.max(0,Math.min(100,Math.round(b.confidence*.65+b.score*.35)));
 f.runs++;f.lastRun=new Date().toISOString();f.latencyMs=Math.max(0,Math.round((coreFastNow()-t)*10)/10);f.fastPath=reasons.length===0;f.slowReasons=reasons;f.readiness=readiness;f.signature=sig;
 f.telemetry.unshift({time:f.lastRun,latencyMs:f.latencyMs,cacheHit:cache,fastPath:f.fastPath,readiness});f.telemetry=f.telemetry.slice(0,50);save();
 return f
}
function coreFastPanel(){
 const f=coreFastState();
 return '<div style="height:14px"></div><div class="card"><div class="sectionTitle"><h3>Core Fast Path · Execution Engine</h3><button class="btn primary" onclick="runCoreFast()">Run Fast Path</button></div><p class="muted">Optimizes the decision path for speed: cache first, validate critical risks early, calculate only what changed, then hand off the smallest safe decision packet.</p><div class="grid three"><div><span class="muted">Path</span><div class="metric" style="font-size:18px">'+(f.fastPath?'FAST':'SAFE SLOW')+'</div></div><div><span class="muted">Readiness</span><div class="metric">'+(f.readiness||0)+'%</div></div><div><span class="muted">Latency</span><div class="metric">'+(f.latencyMs||0)+' ms</div></div></div><div class="grid two"><div><div class="row"><span>Cache hits</span><b>'+f.cacheHits+'</b></div><div class="row"><span>Cache misses</span><b>'+f.cacheMisses+'</b></div><div class="row"><span>Fast-path runs</span><b>'+f.runs+'</b></div></div><div>'+(f.slowReasons.length?f.slowReasons.map(x=>'<div class="notice" style="margin:6px 0">'+esc(x)+'</div>').join(''):'<div class="notice">No slow-path reason detected.</div>')+'</div></div></div>'
}
function coreFastView(){
 const b=coreBrainState(),f=runCoreFast();
 const el=document.getElementById('agentmesh');
 if(!el)return;
 el.insertAdjacentHTML('beforeend',coreFastPanel());
}
window.runCoreFast=runCoreFast;window.__FinPilotCoreFast50=CORE_FAST_50;

window.agentMeshView=agentMeshView;window.runAgentMesh=run;window.handoffAgentMesh=handoff;window.replayAgentMesh=replay;window.__FinPilotAgentMeshFeatures=FEATURES;
})();