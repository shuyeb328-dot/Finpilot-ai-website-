/* FinPilot Free AI Tier UI — transparent allowance + upgrade path. */
(function(){
  const KEY='finpilot_user_id_v1';
  let id=localStorage.getItem(KEY);
  if(!id){id=(crypto.randomUUID?crypto.randomUUID():'fp_'+Date.now()+'_'+Math.random().toString(36).slice(2));localStorage.setItem(KEY,id)}
  function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  async function refresh(){
    try{
      const r=await fetch('/api/ai-plan',{headers:{'x-finpilot-user':id}}),x=await r.json();
      let el=document.getElementById('finpilotAiTier');
      if(!el){el=document.createElement('div');el.id='finpilotAiTier';el.style.cssText='position:fixed;right:14px;bottom:14px;z-index:80;max-width:330px;padding:13px 15px;border:1px solid #dbe3f0;border-radius:14px;background:rgba(255,255,255,.96);box-shadow:0 12px 32px rgba(20,31,55,.14);backdrop-filter:blur(8px);font-size:12px;line-height:1.45';document.body.appendChild(el)}
      const pct=x.limit?Math.round(x.used/x.limit*100):0;
      el.innerHTML='<b style="font-size:13px">FinPilot AI · FREE</b><div style="margin-top:5px;color:#657186">'+esc(x.remaining)+' AI reasoning runs remaining today</div><div style="height:5px;background:#eef2f7;border-radius:99px;margin:8px 0"><div style="height:5px;width:'+Math.min(100,pct)+'%;background:#315efb;border-radius:99px"></div></div><div style="color:#657186">'+(x.aiConfigured?'AI gateway connected':'Core engine active; AI gateway not connected')+'</div><div style="margin-top:7px;color:#315efb;font-weight:700">Upgrade path: '+esc(x.upgrade?.name||'AI Pro')+'</div>';
    }catch(e){}
  }
  window.FinPilotAITier={refresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh);else refresh();
})();
(function(){
  function patchGlobalPowerOneClick(){
    const root=document.getElementById("fpPowerOneClick");
    if(!root)return;
    const title=root.querySelector("h3");
    const text=(title?.textContent||"").toUpperCase();
    const india=/\.NS\b|\.BO\b|\^NSE|\^BSE|\bNIFTY\b|\bBANKNIFTY\b|\bFINNIFTY\b|\bSENSEX\b/.test(text);
    if(india)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let n;
    while((n=walker.nextNode())){if(n.nodeValue.includes("₹"))n.nodeValue=n.nodeValue.replaceAll("₹","$");}
  }
  const obs=new MutationObserver(patchGlobalPowerOneClick);
  function start(){patchGlobalPowerOneClick();obs.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
