/* FinPilot Quantum AI V5 — premium interaction layer.
   No external image dependency: visual cards use lightweight inline SVG/data art.
*/
(function(){
  const STYLE_ID='finpilot-v5-style', ROOT_ID='finpilot-v5-root';
  const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const css=`
    :root{--q5-bg:#f6f8fc;--q5-ink:#101828;--q5-muted:#667085;--q5-line:#e6eaf0;--q5-blue:#2563eb;--q5-card:rgba(255,255,255,.88);--q5-shadow:0 20px 60px rgba(16,24,40,.10)}
    #${ROOT_ID}{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #q5-launch{position:fixed;right:18px;bottom:18px;z-index:950;border:0;border-radius:999px;padding:12px 17px;background:#101828;color:#fff;font-weight:750;box-shadow:0 12px 30px rgba(16,24,40,.22);cursor:pointer;transition:.2s}
    #q5-launch:hover{transform:translateY(-2px);box-shadow:0 16px 36px rgba(16,24,40,.28)}
    .q5-back{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.46);backdrop-filter:blur(12px);display:flex;align-items:flex-start;justify-content:center;padding:7vh 18px 24px}
    .q5-shell{width:min(1040px,100%);max-height:86vh;overflow:auto;background:var(--q5-card);border:1px solid rgba(255,255,255,.7);border-radius:26px;box-shadow:0 35px 100px rgba(15,23,42,.28);animation:q5in .24s ease}
    @keyframes q5in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
    .q5-top{padding:28px 30px 18px;display:flex;justify-content:space-between;gap:20px}
    .q5-brand{font-size:11px;font-weight:850;letter-spacing:.14em;color:var(--q5-blue)}
    .q5-title{font-size:32px;letter-spacing:-.04em;margin:5px 0;color:var(--q5-ink)}
    .q5-sub{color:var(--q5-muted);margin:0;max-width:690px}
    .q5-close{border:1px solid var(--q5-line);background:#fff;border-radius:10px;padding:9px 12px;cursor:pointer;height:max-content}
    .q5-search{margin:0 30px 20px;display:flex;align-items:center;border:1px solid #d7deea;background:#fff;border-radius:16px;padding:5px 7px 5px 17px;box-shadow:0 8px 30px rgba(16,24,40,.07)}
    .q5-search input{flex:1;border:0;outline:0;font-size:17px;padding:12px;background:transparent;color:var(--q5-ink)}
    .q5-key{font-size:11px;color:#7b8493;background:#f4f6f8;border:1px solid #e5e7eb;border-radius:7px;padding:5px 7px;margin-right:7px}
    .q5-go{border:0;background:#101828;color:#fff;border-radius:11px;padding:11px 16px;font-weight:750;cursor:pointer}
    .q5-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;padding:0 30px 30px}
    .q5-card{border:1px solid var(--q5-line);border-radius:18px;background:#fff;padding:18px}
    .q5-card h3{margin:0 0 5px;font-size:15px}.q5-muted{color:var(--q5-muted);font-size:13px}
    .q5-visual{height:180px;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#eef4ff,#f8fafc);margin:12px 0}
    .q5-visual svg{width:100%;height:100%}
    .q5-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
    .q5-chip{border:1px solid #e1e6ef;background:#f8fafc;border-radius:999px;padding:7px 10px;font-size:12px;cursor:pointer}
    .q5-stat{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #eef1f5}.q5-stat:last-child{border-bottom:0}
    .q5-stat b{font-size:14px}.q5-stat span{color:var(--q5-muted);font-size:12px}
    @media(max-width:720px){.q5-grid{grid-template-columns:1fr;padding:0 16px 18px}.q5-top{padding:20px 18px 14px}.q5-title{font-size:25px}.q5-search{margin:0 16px 16px}.q5-shell{border-radius:20px;max-height:92vh}.q5-key{display:none}}
  `;
  function style(){if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=css;document.head.appendChild(s)}
  function visual(){return '<svg viewBox="0 0 900 300" preserveAspectRatio="none" aria-label="Quantum finance intelligence visualization"><defs><linearGradient id="qg" x1="0" x2="1"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><path d="M0 235 C110 210 135 245 220 190 S365 210 450 135 S595 170 670 90 S790 110 900 45" fill="none" stroke="url(#qg)" stroke-width="5"/><path d="M0 260 C150 250 230 225 340 240 S570 205 690 220 S800 180 900 185" fill="none" stroke="#cbd5e1" stroke-width="2"/><circle cx="670" cy="90" r="8" fill="#fff" stroke="#2563eb" stroke-width="4"/><circle cx="900" cy="45" r="9" fill="#fff" stroke="#7c3aed" stroke-width="4"/><g fill="#64748b" font-family="system-ui" font-size="16"><text x="30" y="35">LIVE INTELLIGENCE</text><text x="30" y="62">Evidence → agents → decision</text></g></svg>'}
  function run(q){
    q=String(q||'').trim();if(!q)return;
    if(typeof window.runFullStockAnalysis==='function'){close();window.runFullStockAnalysis(q);return}
    const input=document.getElementById('globalSearch')||document.getElementById('searchQuery');if(input){input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));}
    if(typeof window.doSearch==='function')window.doSearch(q);
    close();
  }
  function close(){document.getElementById(ROOT_ID)?.remove()}
  function open(){
    style();close();
    const root=document.createElement('div');root.id=ROOT_ID;
    root.innerHTML='<div class="q5-back" id="q5back"><section class="q5-shell" role="dialog" aria-label="FinPilot Quantum Search">'+
      '<div class="q5-top"><div><div class="q5-brand">FINPILOT · QUANTUM AI V5</div><h1 class="q5-title">Search your financial world.</h1><p class="q5-sub">One smooth command surface for market evidence, agents, research, Round Table decisions and governed actions.</p></div><button class="q5-close" id="q5close">Close</button></div>'+
      '<div class="q5-search"><input id="q5input" autocomplete="off" placeholder="Search a stock, crypto, company, market or financial question…" aria-label="Financial search"><span class="q5-key">⌘ K</span><button class="q5-go" id="q5go">Search</button></div>'+
      '<div class="q5-grid"><div class="q5-card"><h3>Quantum Intelligence</h3><div class="q5-muted">A visual command center connecting live evidence to your agent network.</div><div class="q5-visual">'+visual()+'</div><div class="q5-chips">'+['IRFC','BTC','NIFTY 50','Gold','US markets','Real estate','Options','Company analysis'].map(x=>'<button class="q5-chip" data-q="'+esc(x)+'">'+esc(x)+'</button>').join('')+'</div></div>'+
      '<div class="q5-card"><h3>Control stack</h3><div class="q5-stat"><b>Live Search</b><span>Evidence</span></div><div class="q5-stat"><b>Agent Fleet</b><span>Specialists</span></div><div class="q5-stat"><b>Round Table</b><span>Debate</span></div><div class="q5-stat"><b>CEO + CFO + Judge</b><span>Decision</span></div><div class="q5-stat"><b>Paper Arena</b><span>Virtual testing</span></div><div class="q5-stat"><b>Action Center</b><span>Approval gates</span></div><p class="q5-muted" style="margin-top:14px">Designed for fast mobile interaction and a clean desktop command experience.</p></div></div></section></div>';
    document.body.appendChild(root);
    const inp=document.getElementById('q5input');inp.focus();
    document.getElementById('q5close').onclick=close;
    document.getElementById('q5back').onclick=e=>{if(e.target.id==='q5back')close()};
    document.getElementById('q5go').onclick=()=>run(inp.value);
    inp.onkeydown=e=>{if(e.key==='Enter')run(inp.value);if(e.key==='Escape')close()};
    root.querySelectorAll('.q5-chip').forEach(b=>b.onclick=()=>run(b.dataset.q));
  }
  function mount(){
    if(document.getElementById('q5-launch'))return;
    style();const b=document.createElement('button');b.id='q5-launch';b.textContent='⌕ Quantum Search';b.onclick=open;document.body.appendChild(b);
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open()}});
  }
  window.FinPilotQuantumV5={open,close,version:'5.0'};window.addEventListener('load',mount);setTimeout(mount,120);
})();