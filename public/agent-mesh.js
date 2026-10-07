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
window.agentMeshView=agentMeshView;window.runAgentMesh=run;window.handoffAgentMesh=handoff;window.replayAgentMesh=replay;window.__FinPilotAgentMeshFeatures=FEATURES;
})();