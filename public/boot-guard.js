/* FinPilot production boot guard — keeps failures visible instead of showing a dead/blank console. */
(function(){
  const started=Date.now();
  function box(){
    let el=document.getElementById('fpBootGuard');
    if(!el){
      el=document.createElement('div'); el.id='fpBootGuard';
      el.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;display:none;background:#fff;border:1px solid #e4e8ef;border-radius:12px;padding:12px;box-shadow:0 16px 50px rgba(15,23,42,.18);font:13px system-ui;color:#172033';
      document.body.appendChild(el);
    }
    return el;
  }
  function show(title,detail){
    const el=box(); el.style.display='block';
    el.innerHTML='<b style="color:#c23d4f">'+title+'</b><div style="margin-top:5px;color:#6b7688">'+String(detail||'Unknown frontend error').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))+'</div><div style="margin-top:8px"><button onclick="this.parentElement.parentElement.style.display=\'none\'" style="border:1px solid #d8dee8;background:#fff;border-radius:8px;padding:7px 10px">Dismiss</button></div>';
  }
  window.addEventListener('error',e=>show('FinPilot frontend error',e.message||'Script failed to load'));
  window.addEventListener('unhandledrejection',e=>show('FinPilot async error',e.reason?.message||String(e.reason||'Unhandled promise rejection')));
  window.FinPilotBootGuard={
    started,
    async health(){
      const t=Date.now();
      try{
        const r=await fetch('/api/health',{cache:'no-store'});
        const d=await r.json();
        return {...d,latencyMs:Date.now()-t,reachable:r.ok};
      }catch(e){
        const d={ok:false,reachable:false,error:e.message,latencyMs:Date.now()-t};
        show('FinPilot gateway unreachable',e.message);
        return d;
      }
    }
  };
  window.addEventListener('DOMContentLoaded',()=>{
    window.FinPilotBootGuard.health().then(d=>{
      const s=document.getElementById('engineStatus'),detail=document.getElementById('engineDetail');
      if(s){s.textContent=d.ok?'ONLINE':'OFFLINE';s.style.color=d.ok?'#138a5b':'#c23d4f'}
      if(detail)detail.textContent=d.ok?'Gateway '+d.latencyMs+'ms · local decision engine ready':'Gateway unavailable · local decision engine still available';
    });
  });
})();