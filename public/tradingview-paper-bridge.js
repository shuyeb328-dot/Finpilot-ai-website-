/* TradingView companion for FinPilot&#39;s simulated trading workspace.
   Charts are display-only: the widget does not expose a quote feed or place orders. */
(function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function normalizeSymbol(value){
    const raw=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
    if(!/^[A-Z0-9._:-]{1,24}$/.test(raw))return '';
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
    return ticker;
  }
  let alertInboxTimer=null;
  let alertInboxRefreshFn=null;
  function mount(){
    const host=document.getElementById('paperlab');
    if(!host)return;
    if(host.querySelector('#fpTradingViewBridge')){host.dataset.fpTvBridgeMounted='1';if(alertInboxRefreshFn)alertInboxRefreshFn();return;}
    host.dataset.fpTvBridgeMounted='1';
    const section=document.createElement('section');
    section.id='fpTradingViewBridge';section.className='card';section.style.cssText='margin:14px 0;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface)';
    section.innerHTML='<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><div><div class="eyebrow">Market chart companion</div><h3 style="margin:5px 0">TradingView + Paper Arena</h3><p class="muted" style="margin:0;line-height:1.5">Inspect a chart, then send the symbol to FinPilot analysis. Paper orders still require a verified FinPilot quote and risk checks.</p></div><span class="pill">SIMULATION ONLY</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0"><input id="fpTvSymbol" aria-label="Chart symbol" value="NASDAQ:AAPL" maxlength="24" placeholder="e.g. NASDAQ:AAPL or BINANCE:BTCUSDT" style="flex:1;min-width:180px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text)"><select id="fpTvMarket" aria-label="Market type" style="padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text)"><option value="AUTO">Auto / US</option><option value="INDIA">India (NSE)</option><option value="CRYPTO">Crypto (Binance)</option><option value="US">US equities</option></select><button id="fpTvLoad" class="btn primary" type="button">Load chart</button><button id="fpTvAnalyze" class="btn" type="button">Analyze in FinPilot</button><button id="fpTvPaper" class="btn good" type="button">Open in Paper Arena</button><a id="fpTvOpen" class="btn" target="_blank" rel="noopener noreferrer">Open TradingView ↗</a></div><div id="fpTvFrame" style="min-height:340px;border-radius:10px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center"><div class="muted" style="padding:24px;text-align:center">Choose a symbol and tap <b>Load chart</b>. The embedded chart may be unavailable in some in-app browsers.</div></div><div class="notice" style="margin-top:12px"><b>Connection boundary:</b> TradingView&#39;s embedded chart is visual only. It does not send live prices, alerts, account data, or orders to FinPilot. FinPilot paper execution uses its own market-data verification and risk gates; no real broker orders are sent.</div><div id="fpTvAlertInbox" class="card" style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface)"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><h4 style="margin:0">TradingView Alert Inbox</h4><span id="fpTvAlertStatus" class="pill">Checking setup…</span></div><p class="muted" style="margin:8px 0">Receive TradingView alert messages into FinPilot for review. Alerts are signals only; FinPilot never submits an order from a webhook.</p><div id="fpTvWebhookHint" class="notice" style="margin:8px 0" aria-live="polite">Checking secure webhook configuration…</div><div style="margin:8px 0"><div class="muted" style="margin-bottom:5px">Webhook URL</div><code id="fpTvWebhookUrl" style="overflow-wrap:anywhere">/api/tradingview/webhook</code></div><label for="fpTvAlertTemplate" class="muted" style="display:block;margin:10px 0 5px">TradingView alert message template (replace the secret placeholder)</label><textarea id="fpTvAlertTemplate" rows="7" readonly spellcheck="false" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text);font:12px ui-monospace,monospace;resize:vertical"></textarea><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button id="fpTvCopyAlertTemplate" class="btn" type="button">Copy alert template</button><button id="fpTvRefreshAlerts" class="btn" type="button">Refresh alerts</button></div><div style="margin-top:12px"><div class="muted" style="margin-bottom:7px">Recent incoming alerts</div><div id="fpTvAlertList" aria-live="polite"><div class="muted">No alert inbox loaded yet.</div></div></div><p class="muted" style="font-size:12px;margin:10px 0 0">Any price included in an alert is informational only. Paper orders still require a separate fresh, matching, provider-verified FinPilot quote and risk checks. Real-money execution is disabled.</p></div>';
    const input=section.querySelector('#fpTvSymbol'),market=section.querySelector('#fpTvMarket'),frame=section.querySelector('#fpTvFrame'),open=section.querySelector('#fpTvOpen');
    const alertStatus=section.querySelector('#fpTvAlertStatus'),alertHint=section.querySelector('#fpTvWebhookHint'),alertList=section.querySelector('#fpTvAlertList'),webhookUrlEl=section.querySelector('#fpTvWebhookUrl'),alertTemplateEl=section.querySelector('#fpTvAlertTemplate');
    const alertTemplate=JSON.stringify({secret:'REPLACE_WITH_TRADINGVIEW_WEBHOOK_SECRET',alert_id:'{{ticker}}-{{interval}}-{{timenow}}',ticker:'{{exchange}}:{{ticker}}',action:'BUY',timeframe:'{{interval}}',time:'{{timenow}}',price:'{{close}}'},null,2);
    if(alertTemplateEl)alertTemplateEl.value=alertTemplate;
    if(webhookUrlEl)webhookUrlEl.textContent=(window.location?.origin||'')+'/api/tradingview/webhook';
    async function refreshAlertInbox(){
      if(typeof fetch!=='function'||!alertStatus||!alertHint||!alertList)return;
      try{
        const responses=await Promise.all([
          fetch('/api/tradingview/status',{cache:'no-store',credentials:'same-origin'}),
          fetch('/api/tradingview/alerts?limit=8',{cache:'no-store',credentials:'same-origin'})
        ]);
        if(responses.some(r=>!r.ok))throw new Error('Alert status request failed');
        const setup=await responses[0].json(),payload=await responses[1].json();
        alertStatus.textContent=setup.acceptingWebhooks?'RECEIVER READY':setup.configurationState==='INVALID_SECRET_LENGTH'?'SECRET TOO SHORT':'SETUP REQUIRED';
        alertStatus.className='pill '+(setup.acceptingWebhooks?'low':'med');
        if(!setup.acceptingWebhooks){
          alertHint.innerHTML='<b>Webhook is safely disabled.</b><p style="margin:6px 0 0">In Render, add <code>TRADINGVIEW_WEBHOOK_SECRET</code> with a private random value of at least 32 characters, then use that same value in the TradingView alert message instead of the placeholder. Do not post the secret publicly. Save the variable and redeploy before testing.</p>';
        }else{
          alertHint.innerHTML='<b>Webhook receiver is ready.</b><p style="margin:6px 0 0">In TradingView, set the Webhook URL to the address above and paste the JSON template into the alert message after replacing the secret placeholder. Incoming alerts are saved for review only.</p>';
        }
        const rows=Array.isArray(payload.alerts)?payload.alerts:[];
        if(!setup.acceptingWebhooks){
          alertList.innerHTML='<div class="muted">No alerts can be received until the webhook secret is configured on Render.</div>';
          return;
        }
        if(!rows.length){
          alertList.innerHTML='<div class="muted">No TradingView alerts received yet. Send a test alert after setup.</div>';
          return;
        }
        alertList.innerHTML=rows.map((a,i)=>'<div class="card" style="padding:10px;margin:7px 0;border:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>'+esc(a.symbol)+'</b><span class="pill">'+esc(a.action)+'</span></div><div class="muted" style="margin:5px 0">'+esc(a.timeframe||'UNKNOWN')+' · '+esc(a.receivedAt||'')+' · Review required</div><div class="muted">Reported alert price: '+(Number.isFinite(Number(a.reportedPrice))&&Number(a.reportedPrice)>0?esc(a.reportedPrice):'not supplied')+' (unverified)</div><button class="btn" type="button" data-fp-tv-review="'+i+'" style="margin-top:8px">Review in Paper Arena</button></div>').join('');
        const reviewButtons=alertList.querySelectorAll('[data-fp-tv-review]');
        reviewButtons.forEach(button=>button.addEventListener('click',()=>{
          const alert=rows[Number(button.getAttribute('data-fp-tv-review'))];if(!alert)return;
          const raw=paperSymbol(alert.symbol);if(!raw)return;
          const ticket=document.getElementById('paperSymbol');
          if(!ticket){alertHint.textContent='Paper Arena ticket is not ready. The alert was not executed.';return;}
          ticket.value=raw;ticket.dispatchEvent(new Event('input',{bubbles:true}));ticket.dispatchEvent(new Event('change',{bubbles:true}));
          const status=document.getElementById('paperMarketStatus');
          if(status)status.textContent='Checking verified market data for '+raw+'… No order submitted.';
          if(typeof window.refreshPaper==='function')Promise.resolve(window.refreshPaper()).catch(()=>{if(status)status.textContent='Quote verification failed. No order was submitted.';});
          alertHint.textContent='Signal selected for manual review. FinPilot must verify a fresh quote and risk gates. No order was submitted.';
        }));
      }catch{
        alertStatus.textContent='STATUS UNAVAILABLE';alertStatus.className='pill med';
        alertHint.textContent='The alert inbox cannot reach its status endpoint right now. Existing chart and paper controls remain available; no order was submitted.';
      }
    }
    alertInboxRefreshFn=refreshAlertInbox;
    section.querySelector('#fpTvRefreshAlerts').addEventListener('click',refreshAlertInbox);
    section.querySelector('#fpTvCopyAlertTemplate').addEventListener('click',async()=>{
      if(!alertTemplateEl)return;
      try{
        if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(alertTemplate);if(alertHint)alertHint.textContent='Template copied. Replace the secret placeholder before enabling the TradingView alert.';}
        else{alertTemplateEl.focus();alertTemplateEl.select();if(alertHint)alertHint.textContent='Template selected. Copy it and replace the secret placeholder before enabling the TradingView alert.';}
      }catch{alertTemplateEl.focus();alertTemplateEl.select();if(alertHint)alertHint.textContent='Template selected. Copy it manually and replace the secret placeholder.';}
    });
    refreshAlertInbox();
    if(alertInboxTimer===null&&typeof fetch==='function')alertInboxTimer=setInterval(()=>{if(alertInboxRefreshFn)alertInboxRefreshFn();},30000);

    function symbol(){return tvSymbol(input.value,market.value)}
    function loadChart(){
      const s=symbol();if(!s){frame.textContent='Enter a valid symbol.';return}
      open.href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(s);
      frame.innerHTML='<iframe title="TradingView chart for '+esc(s)+'" src="https://www.tradingview.com/widgetembed/?frameElementId=fp-tv-widget&symbol='+encodeURIComponent(s)+'&interval=60&hidesidetoolbar=1&symboledit=1&saveimage=0&toolbarbg=f1f3f6&theme=light&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&locale=en" style="width:100%;height:340px;border:0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
    }
    section.querySelector('#fpTvLoad').addEventListener('click',loadChart);
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