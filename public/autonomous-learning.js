/* FinPilot Autonomous Learning UI 2.0 */
(function(){
'use strict';
let cache=null,poll=null;
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(path,options){
  const r=await fetch(path,{cache:'no-store',...(options||{})});
  const d=await r.json();
  if(!r.ok)throw new Error(d?.error||d?.message||('HTTP '+r.status));
  return d;
}
function fmtAge(v){if(!v)return '—';const m=Math.max(0,(Date.now()-Date.parse(v))/60000);return m<1?'now':m<60?Math.round(m)+'m ago':Math.round(m/60)+'h ago'}
function panel(){
  const old=document.getElementById('fpAutoLearning');if(old)old.remove();
  const root=document.createElement('div');root.id='fpAutoLearning';root.innerHTML='<div class="fpALShade"><section class="fpALPanel"><header class="fpALHead"><div><span class="eyebrow">FINPILOT AUTONOMOUS LEARNING OS 2.0</span><h2>Idle-Agent Auto Research</h2><p>Free agents research their highest-value knowledge gaps. Evidence is collected, cleaned and scored before a learning candidate is created.</p></div><button id="fpALClose" class="btn">Close</button></header><div id="fpALBody"><div class="fpALLoading">Loading learning state…</div></div></section></div>';
  document.body.appendChild(root);
  document.getElementById('fpALClose').onclick=()=>root.remove();
  refresh();
}
function bodyHtml(s){
  const agents=Object.entries(s?.agents||{});
  const stats=s?.stats||{};
  const recent=s?.recentCandidates||[];
  const q=s?.recentTrainingCases||[];
  return '<div class="fpALStats">'+[
    ['Mode',s?.enabled?'AUTO':'OFF'],
    ['Cycles',s?.cycle||0],
    ['Queries',stats.queries||0],
    ['Evidence',stats.evidenceCollected||0],
    ['Accepted',stats.evidenceAccepted||0],
    ['Primary',stats.primarySources||0],
    ['Domains',stats.sourceDomains||0],
    ['Training queue',s?.queueCount||0]
  ].map(x=>'<div><span>'+x[0]+'</span><b>'+esc(x[1])+'</b></div>').join('')+'</div>'+
  '<div class="fpALToolbar"><span class="fpALPill '+(s?.running?'run':'idle')+'">'+esc(s?.running?('RESEARCHING · '+s.activeAgent):'IDLE-SLOT AUTORESEARCH')+'</span><span class="fpALMuted">Last cycle: '+fmtAge(s?.lastCycleAt)+' · Next: '+(s?.nextRunAt?new Date(s.nextRunAt).toLocaleTimeString(): '—')+'</span><button id="fpALCycle" class="btn primary">Run one cycle</button><button id="fpALEnable" class="btn">'+(s?.enabled?'Pause auto':'Enable auto')+'</button></div>'+
  '<div class="fpALGrid"><div class="fpALCard"><div class="fpALTitle">12-agent idle research status</div><div class="fpALAgents">'+agents.map(([id,a])=>'<div><b>'+esc(id)+'</b><span class="'+String(a.status||'IDLE').toLowerCase()+'">'+esc(a.status||'IDLE')+'</span><small>'+(a.lastQuality==null?'No run':(a.lastQuality+'% quality · '+esc(a.lastTopic||'')))+'</small></div>').join('')+'</div></div>'+
  '<div class="fpALCard"><div class="fpALTitle">Recent knowledge candidates</div>'+(recent.length?recent.slice(0,8).map(c=>'<div class="fpALRow"><b>'+esc(c.agent)+' · '+esc(c.topic)+'</b><span>'+esc(c.status)+'</span><small>'+esc(c.evidenceCount||0)+' sources · '+esc(c.primaryCount||0)+' primary · '+esc(c.sourceDiversity||0)+' domains · '+esc(c.freshnessScore||0)+'% fresh · '+esc(c.qualityScore||0)+'% quality</small></div>').join(''):'<div class="fpALMuted">No candidates yet.</div>')+'<div class="fpALTitle" style="margin-top:14px">Training cases waiting for validation</div>'+(q.length?q.slice(0,6).map(x=>'<div class="fpALRow"><b>'+esc(x.agent)+' · '+esc(x.topic)+'</b><span>QUEUED</span><small>'+esc(x.prompt)+'</small></div>').join(''):'<div class="fpALMuted">Queue is clear.</div>')+'</div></div>'+
  '<div class="fpALNote"><b>Governance gate:</b> new web data never rewrites production behavior directly. The pipeline is Search → collect → deduplicate → source tier → freshness → quality score → candidate → training validation → benchmark → shadow/canary → promotion.</div>';
}
async function refresh(){
  try{cache=await api('/api/autonomous-learning/status');const b=document.getElementById('fpALBody');if(b)b.innerHTML=bodyHtml(cache);wire()}catch(e){const b=document.getElementById('fpALBody');if(b)b.innerHTML='<div class="fpALMuted">Autonomous Learning status unavailable: '+esc(e.message)+'</div>'}
}
function wire(){
  const cycle=document.getElementById('fpALCycle');if(cycle)cycle.onclick=async()=>{cycle.disabled=true;try{await api('/api/autonomous-learning/cycle',{method:'POST'});toast?.('Autonomous research cycle started');}catch(e){toast?.(e.message)}finally{cycle.disabled=false;refresh()}};
  const enable=document.getElementById('fpALEnable');if(enable)enable.onclick=async()=>{enable.disabled=true;try{await api('/api/autonomous-learning/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!cache?.enabled})});}catch(e){toast?.(e.message)}finally{enable.disabled=false;refresh()}};
}
function mount(){
  if(document.getElementById('fpAutoLearningLauncher'))return;
  const b=document.createElement('button');b.id='fpAutoLearningLauncher';b.className='btn';b.textContent='◉ Auto Learning';b.style.cssText='position:fixed;right:14px;bottom:62px;z-index:90';b.onclick=panel;document.body.appendChild(b);
  if(!poll)poll=setInterval(()=>{if(document.getElementById('fpAutoLearning'))refresh()},15000);
}
const st=document.createElement('style');st.textContent='.fpALShade{position:fixed;inset:0;z-index:10001;background:rgba(2,8,20,.76);display:grid;place-items:center;padding:14px}.fpALPanel{width:min(1250px,100%);max-height:94vh;overflow:auto;background:#071426;color:#e9f2ff;border:1px solid #1d4069;border-radius:20px;padding:20px;box-shadow:0 30px 120px rgba(0,0,0,.55);font:14px system-ui}.fpALHead{display:flex;justify-content:space-between;gap:16px}.fpALHead h2{margin:5px 0}.fpALHead p{color:#91a7c5;margin:4px 0 0;max-width:840px}.fpALStats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:14px 0}.fpALStats div,.fpALCard{border:1px solid #173757;background:#0a1a2e;border-radius:12px;padding:12px}.fpALStats span{display:block;color:#7f96b5;font-size:10px;text-transform:uppercase}.fpALStats b{font-size:18px}.fpALToolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 0}.fpALPill{padding:5px 9px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid #214e72}.fpALPill.run{color:#7fe6bd;background:#0d3025}.fpALPill.idle{color:#f6c85f;background:#2c230d}.fpALMuted{color:#8ea4bf}.fpALGrid{display:grid;grid-template-columns:1fr 1.05fr;gap:12px}.fpALTitle{font-weight:800;margin-bottom:10px}.fpALAgents{display:grid;grid-template-columns:1fr 1fr;gap:7px}.fpALAgents>div{border:1px solid #16324e;border-radius:8px;padding:8px;display:grid;grid-template-columns:1fr auto;gap:4px}.fpALAgents span{font-size:9px;font-weight:800}.fpALAgents span.researching{color:#7fe6bd}.fpALAgents span.idle{color:#8ea4bf}.fpALAgents small{grid-column:1/-1;color:#7f96b5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fpALRow{display:grid;grid-template-columns:1fr auto;gap:5px;padding:8px 0;border-bottom:1px solid #16324e}.fpALRow span{color:#f6c85f;font-size:10px}.fpALRow small{grid-column:1/-1;color:#8ea4bf;line-height:1.4}.fpALNote{margin-top:12px;border:1px solid #1c426a;border-radius:9px;background:#091a2d;padding:10px;color:#91a7c5;line-height:1.5}@media(max-width:850px){.fpALStats{grid-template-columns:1fr 1fr}.fpALGrid{grid-template-columns:1fr}.fpALAgents{grid-template-columns:1fr}.fpALPanel{padding:14px}}';
document.head.appendChild(st);
window.FinPilotAutonomousLearning={version:'2.0',panel,refresh,getState:()=>cache};
window.addEventListener('load',mount);setTimeout(mount,180);
})();