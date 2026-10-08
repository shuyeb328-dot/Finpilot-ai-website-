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
      if(!el){el=document.createElement('div');el.id='finpilotAiTier';el.className='finpilotAiTierCard';document.body.appendChild(el)}
      const pct=x.limit?Math.round(x.used/x.limit*100):0;
      el.innerHTML='<b class="aiTierTitle">FinPilot AI · FREE</b><div class="aiTierMuted">'+esc(x.remaining)+' AI reasoning runs remaining today</div><div class="aiTierBar"><div style="width:'+Math.min(100,pct)+'%"></div></div><div class="aiTierMuted">'+(x.aiConfigured?'AI gateway connected':'Core engine active; AI gateway not connected')+'</div><div class="aiTierUpgrade">Upgrade path: '+esc(x.upgrade?.name||'AI Pro')+'</div>';
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
