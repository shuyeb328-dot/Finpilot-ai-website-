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
    return s.split(':').pop().replace(/\.(NS|BO)$/,'');
  }
  function mount(){
    const host=document.getElementById('paperlab');
    if(!host)return;
    if(host.querySelector('#fpTradingViewBridge')){host.dataset.fpTvBridgeMounted='1';return;}
    host.dataset.fpTvBridgeMounted='1';
    const section=document.createElement('section');
    section.id='fpTradingViewBridge';section.className='card';section.style.cssText='margin:14px 0;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface)';
    section.innerHTML='<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><div><div class="eyebrow">Market chart companion</div><h3 style="margin:5px 0">TradingView + Paper Arena</h3><p class="muted" style="margin:0;line-height:1.5">Inspect a chart, then send the symbol to FinPilot analysis. Paper orders still require a verified FinPilot quote and risk checks.</p></div><span class="pill">SIMULATION ONLY</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0"><input id="fpTvSymbol" aria-label="Chart symbol" value="NASDAQ:AAPL" maxlength="24" placeholder="e.g. NASDAQ:AAPL or BINANCE:BTCUSDT" style="flex:1;min-width:180px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text)"><select id="fpTvMarket" aria-label="Market type" style="padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--text)"><option value="AUTO">Auto / US</option><option value="INDIA">India (NSE)</option><option value="CRYPTO">Crypto (Binance)</option><option value="US">US equities</option></select><button id="fpTvLoad" class="btn primary" type="button">Load chart</button><button id="fpTvAnalyze" class="btn" type="button">Analyze in FinPilot</button><button id="fpTvPaper" class="btn good" type="button">Open in Paper Arena</button><a id="fpTvOpen" class="btn" target="_blank" rel="noopener noreferrer">Open TradingView ↗</a></div><div id="fpTvFrame" style="min-height:340px;border-radius:10px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center"><div class="muted" style="padding:24px;text-align:center">Choose a symbol and tap <b>Load chart</b>. The embedded chart may be unavailable in some in-app browsers.</div></div><div class="notice" style="margin-top:12px"><b>Connection boundary:</b> TradingView&#39;s embedded chart is visual only. It does not send live prices, alerts, account data, or orders to FinPilot. FinPilot paper execution uses its own market-data verification and risk gates; no real broker orders are sent.</div>';
    const input=section.querySelector('#fpTvSymbol'),market=section.querySelector('#fpTvMarket'),frame=section.querySelector('#fpTvFrame'),open=section.querySelector('#fpTvOpen');
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