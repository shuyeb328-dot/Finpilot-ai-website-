/* TradingView companion for FinPilot&#39;s simulated trading workspace.
   Charts are display-only: the widget does not expose a quote feed or place orders. */
(function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function normalizeSymbol(value){
    const raw=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
    if(!/^[A-Z0-9._:!+-]{1,40}$/.test(raw))return '';
    return raw;
  }
  function tvSymbol(value,market){
    const s=normalizeSymbol(value);if(!s)return '';
    const m=String(market||'AUTO').toUpperCase();
    if(s.includes(':'))return s;
    // Respect explicit listing suffixes; .BO is BSE and .NS is NSE.
    if(/\.BO$/.test(s))return 'BSE:'+s.replace(/\.BO$/,'');
    if(/\.NS$/.test(s))return 'NSE:'+s.replace(/\.NS$/,'');
    if(m==='CRYPTO'||/USDT$/.test(s))return 'BINANCE:'+(s.endsWith('USDT')?s:s+'USDT');
    if(m==='INDIA'||m==='NSE')return 'NSE:'+s;
    if(m==='BSE')return 'BSE:'+s;
    if(m==='US')return 'NASDAQ:'+s;
    return 'NASDAQ:'+s;
  }
  function analysisSymbol(value,market){
    const s=tvSymbol(value,market);if(!s)return '';
    const colon=s.indexOf(':');if(colon<0)return s;
    const venue=s.slice(0,colon).toUpperCase(),ticker=s.slice(colon+1);
    if(venue==='BINANCE')return ticker; // Preserve the quote asset: BTCUSDT is not BTC.
    if(ticker.endsWith('!'))return s; // Continuous futures require their venue-qualified identity.
    if(venue==='NSE')return ticker+'.NS';
    if(venue==='BSE')return ticker+'.BO';
    return ticker;
  }
  function widgetUrl(symbol){
    const s=tvSymbol(symbol,'AUTO');
    return s?'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(s):'';
  }
  function paperSymbol(value){
    const s=normalizeSymbol(value);if(!s)return '';
    const colon=s.indexOf(':');
    if(colon<0)return s; // Keep explicit .NS/.BO listing suffixes supplied by the user.
    const venue=s.slice(0,colon).toUpperCase(),ticker=s.slice(colon+1);
    if(venue==='NSE')return ticker+'.NS';
    if(venue==='BSE')return ticker+'.BO';
    if(ticker.endsWith('!'))return s; // Never strip venue from continuous futures symbols.
    return ticker;
  }
  function mount(){
    const host=document.getElementById('paperlab');
    if(!host)return;
    if(host.querySelector('#fpTradingViewBridge')){host.dataset.fpTvBridgeMounted='1';return;}
    host.dataset.fpTvBridgeMounted='1';
    const section=document.createElement('section');
    section.id='fpTradingViewBridge';section.className='card';section.style.cssText='margin:14px 0;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface)';
    section.innerHTML='<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><div><div class="eyebrow">Market chart companion</div><h3 style="margin:5px 0">TradingView + Paper Arena</h3><p class="muted" style="margin:0;line-height:1.5">Inspect a chart, then send the symbol to FinPilot analysis. Paper orders still require a verified FinPilot quote and risk checks.</p></div><span class="pill">SIMULATION ONLY</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0"><input id="fpTvSymbol" aria-label="Chart symbol" value="NASDAQ:AAPL" maxlength="40" placeholder="e.g. NASDAQ:AAPL or CME_MINI:ES1!" style="flex:1;min-width:180px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text)"><select id="fpTvMarket" aria-label="Market type" style="padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text)"><option value="AUTO">Auto / US</option><option value="INDIA">India (NSE)</option><option value="CRYPTO">Crypto (Binance)</option><option value="US">US equities</option></select><button id="fpTvLoad" class="btn primary" type="button">Load chart</button><button id="fpTvAnalyze" class="btn" type="button">Analyze in FinPilot</button><button id="fpTvPaper" class="btn good" type="button">Open in Paper Arena</button><a id="fpTvOpen" class="btn" target="_blank" rel="noopener noreferrer">Open TradingView ↗</a></div><div id="fpTvFrame" style="min-height:340px;border-radius:10px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center"><div class="muted" style="padding:24px;text-align:center">Choose a symbol and tap <b>Load chart</b>. The embedded chart may be unavailable in some in-app browsers.</div></div><section id="fpTvAlertInbox" style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)"><div class="eyebrow">OPTIONAL WEBHOOK INTEGRATION</div><h4 style="margin:5px 0">TradingView Alert Inbox</h4><p class="muted" style="margin:0 0 10px;line-height:1.5">Receive strategy alerts as unverified signals. This inbox never submits orders. Configure FINPILOT_TRADINGVIEW_WEBHOOK_TOKEN in Render before connecting an alert.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="fpTvAlertToken" type="password" autocomplete="off" spellcheck="false" aria-label="FinPilot webhook shared secret" placeholder="Paste Render webhook secret" style="flex:1;min-width:220px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text)"><button id="fpTvAlertLoad" class="btn" type="button">Load alert inbox</button></div><div id="fpTvAlertStatus" class="muted" role="status" aria-live="polite" style="margin-top:9px">Webhook not checked. Secret is kept in this page only and is not saved.</div><pre id="fpTvAlerts" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;padding:10px;border-radius:8px;background:var(--surface);font-size:12px">No alerts loaded. Incoming alerts stay signal-only until you verify the quote and review risk.</pre><details><summary style="cursor:pointer">Example TradingView JSON alert message</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">{"token":"PASTE_RENDER_SHARED_SECRET","ticker":"{{ticker}}","action":"{{strategy.order.action}}","price":"{{close}}","timestamp":"{{timenow}}","interval":"{{interval}}","strategy":"FinPilot"}</pre><p class="muted" style="line-height:1.5">TradingView webhook availability depends on your plan and alert settings. Do not include broker credentials or personal account details.</p></details></section><div class="notice" style="margin-top:12px"><b>Connection boundary:</b> The embedded TradingView chart is visual only and does not supply a live quote feed. A separate authenticated webhook can deliver strategy alerts when configured; alerts remain unverified and never place orders. FinPilot requires its own verified market quote and risk checks before a paper order can be submitted.</div>';
    const input=section.querySelector('#fpTvSymbol'),market=section.querySelector('#fpTvMarket'),frame=section.querySelector('#fpTvFrame'),open=section.querySelector('#fpTvOpen'),alertToken=section.querySelector('#fpTvAlertToken'),alertStatus=section.querySelector('#fpTvAlertStatus'),alertList=section.querySelector('#fpTvAlerts');
    async function loadAlertInbox(){
      const token=String(alertToken?.value||'').trim();
      if(!token){if(alertStatus)alertStatus.textContent='Paste the secret configured in Render first. No order was submitted.';return}
      if(alertStatus)alertStatus.textContent='Checking authenticated alert inbox…';
      try{
        const response=await fetch('/api/tradingview-alerts',{method:'GET',headers:{'Accept':'application/json','X-FinPilot-Webhook-Token':token},cache:'no-store',credentials:'same-origin'});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.ok){
          const message=data.message||(data.error==='TRADINGVIEW_WEBHOOK_NOT_CONFIGURED'?'Webhook inbox is disabled. Configure FINPILOT_TRADINGVIEW_WEBHOOK_TOKEN in Render.':response.status===401?'Secret rejected. Check the exact Render value.':'Alert inbox unavailable ('+String(data.error||response.status)+').');
          if(alertStatus)alertStatus.textContent=message+' No order was submitted.';
          if(alertList)alertList.textContent='';
          return;
        }
        if(alertStatus)alertStatus.textContent='Authenticated · '+data.count+' signal(s) · memory-only queue · no orders submitted.';
        if(alertList)alertList.textContent=!data.items?.length
          ?'No alerts received yet. Incoming alerts stay unverified until FinPilot refreshes and verifies market data.'
          :data.items.map(a=>String(a.receivedAt||'')+' · '+String(a.symbol||'')+' · '+String(a.action||'')+' · '+String(a.status||'RECEIVED_UNVERIFIED')+' · no order submitted').join('\\n');
      }catch{
        if(alertStatus)alertStatus.textContent='Could not reach the alert inbox. Check the site connection; no order was submitted.';
      }
    }
    function symbol(){return tvSymbol(input.value,market.value)}
    function loadChart(){
      const s=symbol();if(!s){frame.textContent='Enter a valid symbol.';return}
      open.href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(s);
      frame.innerHTML='<iframe title="TradingView chart for '+esc(s)+'" src="https://www.tradingview.com/widgetembed/?frameElementId=fp-tv-widget&symbol='+encodeURIComponent(s)+'&interval=60&hidesidetoolbar=1&symboledit=1&saveimage=0&toolbarbg=f1f3f6&theme=light&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&locale=en" style="width:100%;height:340px;border:0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
    }
    section.querySelector('#fpTvLoad').addEventListener('click',loadChart);
    section.querySelector('#fpTvAlertLoad').addEventListener('click',loadAlertInbox);
    section.querySelector('#fpTvAnalyze').addEventListener('click',()=>{
      const s=symbol();if(!s)return;
      const raw=analysisSymbol(s,market.value);
      if(!raw)return;
      const q=document.getElementById('globalSearch')||document.getElementById('searchQuery');
      if(q){q.value=raw;q.dispatchEvent(new Event('input',{bubbles:true}));}
      if(typeof window.runFullStockAnalysis==='function')window.runFullStockAnalysis(raw);
      else if(typeof window.finpilotLaunch==='function')window.finpilotLaunch(raw);
      else {const search=document.querySelector('[data-view="search"]');search?.click();window.setTimeout(()=>window.doSearch?.(raw),100);}
    });
    section.querySelector('#fpTvPaper').addEventListener('click',()=>{
      const raw=paperSymbol(symbol());
      if(!raw){frame.textContent='Enter a valid symbol before selecting it in the paper ticket.';return;}
      const ticket=document.getElementById('paperSymbol');
      if(!ticket){frame.textContent='The Paper Arena order ticket is not ready yet. Wait for the paper desk to finish loading, then try again.';return;}
      ticket.value=raw;
      ticket.dispatchEvent(new Event('input',{bubbles:true}));
      ticket.dispatchEvent(new Event('change',{bubbles:true}));
      const status=document.getElementById('paperMarketStatus');
      if(status)status.textContent='Checking verified market data for '+raw+'…';
      // Refreshing a quote is read-only with respect to orders; no order is submitted here.
      if(typeof window.refreshPaper==='function'){
        try{Promise.resolve(window.refreshPaper()).catch(()=>{const current=document.getElementById('paperMarketStatus');if(current)current.textContent='Quote verification failed. No order was submitted.';});}
        catch{if(status)status.textContent='Quote verification failed. No order was submitted.';}
      }else if(status)status.textContent='Symbol selected. Tap Refresh market to verify its quote. No order was submitted.';
    });
    market.addEventListener('change',()=>{if(input.value.trim())loadChart()});
    input.addEventListener('keydown',e=>{if(e.key==='Enter')loadChart()});
    host.prepend(section);
  }
  function start(){
    const tryMount=()=>{const host=document.getElementById('paperlab');if(host&&host.childElementCount>0)mount();};
    tryMount();
    const observer=new MutationObserver(tryMount);
    observer.observe(document.body,{childList:true,subtree:true});
    let tries=0;const timer=setInterval(()=>{tryMount();if(document.getElementById('fpTradingViewBridge')||++tries>120)clearInterval(timer)},500);
  }
  window.FinPilotTradingViewBridge={normalizeSymbol,tvSymbol,analysisSymbol,widgetUrl,paperSymbol,mount};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();