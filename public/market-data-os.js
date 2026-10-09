(()=>{'use strict';
const S=['BTC','ETH','SOL','BNB','XRP'],st={ticker:'BTC',ticks:[]};
let fallbackTimer=null,streamOpen=false,fallbackBusy=false;
const $=id=>document.getElementById(id);
const money=v=>v==null||!isFinite(v)?'—':'$'+Number(v).toLocaleString(undefined,{maximumFractionDigits:Number(v)<10?4:2});
const pct=v=>v==null?'—':(v>=0?'+':'')+Number(v).toFixed(2)+'%';
const tm=v=>{try{return new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{return'—'}};
function panel(){
 let e=$('live-market-os');if(e)return e;
 e=document.createElement('section');e.id='live-market-os';e.className='card liveMarketOS';
 e.innerHTML='<div class="liveMarketHead"><div><div class="eyebrow">LIVE MARKET DATA OS</div><h3>Real-time market intelligence</h3><p class="muted">Live public market data → event bus → Risk / Quant / CFO / CEO core.</p></div><div class="liveMarketControls"><select id="liveMarketTicker">'+S.map(x=>'<option>'+x+'</option>').join('')+'</select><span id="liveMarketStatus" class="pill">CONNECTING</span></div></div><div class="liveMarketGrid"><div><span class="muted">LIVE PRICE</span><b id="liveMarketPrice">—</b><strong id="liveMarketChange">—</strong><small id="liveMarketMeta">Waiting…</small></div><div><span class="muted">24H HIGH</span><b id="liveMarketHigh">—</b></div><div><span class="muted">24H LOW</span><b id="liveMarketLow">—</b><small id="liveMarketSource">—</small></div><div><span class="muted">FRESHNESS</span><b id="liveMarketFresh">—</b><small>Server stream</small></div></div><div class="liveMarketTape" id="liveMarketTape"></div><div class="liveMarketFoot"><span id="liveMarketCloud">Cloud archive: collector ready</span><span>Execution disabled · approval required</span></div>';
 const h=document.querySelector('#dashboard .content')||document.querySelector('#dashboard')||document.querySelector('.content');if(h)h.prepend(e);
 $('liveMarketTicker').value=st.ticker;$('liveMarketTicker').onchange=x=>start(x.target.value);return e;
}
function classifyFreshness(d){
 const type=String(d.dataFreshness||d.sourceTimestampType||d.timestampType||'').toUpperCase();
 if(type.includes('END_OF_DAY')||type.includes('EOD')||type.includes('HISTORICAL'))return 'END-OF-DAY';
 if(d.executionEligibilityReason==='UNOFFICIAL_YAHOO_SOURCE_ANALYSIS_ONLY')return 'UNVERIFIED';
 if(d.live===true)return 'LIVE';
 const stamp=d.time||d.asOf||d.timestamp;
 const ms=stamp?Date.parse(stamp):NaN;
 if(Number.isFinite(ms)){
  const age=Date.now()-ms;
  if(age>=0&&age<=90000)return 'LIVE';
  if(age>90000&&age<=15*60*1000)return 'DELAYED';
 }
 if(type.includes('DELAY'))return 'DELAYED';
 return 'STALE';
}
function freshnessText(label){
 return label==='END-OF-DAY'?'END-OF-DAY · ANALYSIS ONLY':label==='DELAYED'?'DELAYED · ANALYSIS ONLY':label==='UNVERIFIED'?'UNVERIFIED · ANALYSIS ONLY':label==='STALE'?'STALE · DO NOT TRADE':'LIVE · VERIFIED';
}
function draw(d){
 const e=panel(); if(!e)return;
 const set=(sel,value)=>{const n=e.querySelector(sel);if(n)n.textContent=value;};
 const setClass=(sel,value)=>{const n=e.querySelector(sel);if(n)n.className=value;};
 const p=+d.price,c=+d.changePct;
 set('#liveMarketPrice',money(p));set('#liveMarketChange',pct(c));setClass('#liveMarketChange',c>=0?'green':'red');
 set('#liveMarketHigh',money(+d.high));set('#liveMarketLow',money(+d.low));set('#liveMarketSource',d.source||'Binance public market data');
 const freshness=d.freshness||classifyFreshness(d);set('#liveMarketFresh',freshness);set('#liveMarketMeta','Updated '+tm(d.time));
 const q=$('liveMarketStatus');if(q){q.textContent=freshnessText(freshness);q.className=freshness==='LIVE'?'pill low':'pill';}
 st.ticks.unshift({p:p,c:c,t:d.time});st.ticks=st.ticks.slice(0,8);
 const tape=$('liveMarketTape');if(tape)tape.innerHTML=st.ticks.map(x=>'<span><b>'+money(x.p)+'</b> <em class="'+(x.c>=0?'green':'red')+'">'+pct(x.c)+'</em> <small>'+tm(x.t)+'</small></span>').join('');
 const cloud=$('liveMarketCloud');if(cloud)cloud.textContent=d.cloudStored?'Cloud archive: STORED':'Cloud archive: collector ready';
}
function start(t){
 st.ticker=S.includes(t)?t:'BTC';
 if(window.fpES)try{window.fpES.close()}catch{}
 window.fpES=null;
 streamOpen=false;
 stopFallback();
 panel();
 window.fpES=new EventSource('/api/market-data-stream?ticker='+encodeURIComponent(st.ticker)+'&interval=1m');
 window.fpES.addEventListener('open',()=>{streamOpen=true;stopFallback();});
 window.fpES.addEventListener('market',ev=>{
  streamOpen=true;stopFallback();
  try{
   const d=JSON.parse(ev.data);
   const live=Boolean(d.verified&&d.status==='LIVE'&&Number.isFinite(Number(d.price))&&Number(d.price)>0);
   if(live){
    draw({ticker:d.ticker,price:d.price,changePct:d.changePct,high:d.high,low:d.low,source:d.provider||'Verified market provider',time:d.asOf||d.receivedAt,live:true,cloudStored:Boolean(d.cloudStored)});
   }else{
    const n=$('liveMarketStatus');if(n)n.textContent=d.status==='STALE'?'STALE · ANALYSIS ONLY':'DATA UNAVAILABLE';
    const f=$('liveMarketFresh');if(f)f.textContent=d.status==='STALE'?'STALE':'UNAVAILABLE';
    const m=$('liveMarketMeta');if(m)m.textContent=d.error||'Waiting for a fresh, verified quote';
   }
  }catch{
   const n=$('liveMarketStatus');if(n)n.textContent='DEGRADED';
  }
 });
 window.fpES.onerror=()=>{
  streamOpen=false;
  const n=$('liveMarketStatus');if(n)n.textContent='RECONNECTING';
  startFallback();
 };
}
function dashboardActive(){return !!document.querySelector('#dashboard.view.active')}
async function fallbackPoll(){
 fallbackTimer=null;
 if(streamOpen||!dashboardActive())return;
 if(fallbackBusy)return;
 fallbackBusy=true;
 try{
  const r=await fetch('/api/stock-report?ticker='+encodeURIComponent(st.ticker)+'&interval=1h&multi=0',{cache:'no-store'});
  const d=await r.json();
  if(d?.ok&&d.report){
   const x=d.report,price=Number(x.price),asOf=x.asOf||null;
   const fresh=Boolean(x.live===true&&x.executionEligible!==false&&asOf&&Number.isFinite(Date.parse(asOf))&&Date.now()-Date.parse(asOf)<=90000);
   if(Number.isFinite(price)&&price>0){
    const sourceType=String(x.sourceTimestampType||x.timestampType||'').toUpperCase();
    const dataFreshness=String(x.dataFreshness||'').toUpperCase();
    const freshness=dataFreshness.includes('END_OF_DAY')||dataFreshness==='EOD'||sourceType.includes('HISTORICAL_EOD')?'END-OF-DAY':fresh?'LIVE':classifyFreshness({live:false,time:asOf,sourceTimestampType:sourceType,dataFreshness,executionEligibilityReason:x.executionEligibilityReason});
    draw({ticker:x.ticker,price,changePct:Number(x.changePct||0),high:x.dayHigh||x.high,low:x.dayLow||x.low,source:x.provider||'FinPilot market adapter',time:asOf||'Unknown timestamp',live:fresh,freshness,sourceTimestampType:sourceType,dataFreshness,executionEligible:x.executionEligible,executionEligibilityReason:x.executionEligibilityReason,cloudStored:false});
   }
  }
 }catch{}
 finally{
  fallbackBusy=false;
  if(!streamOpen&&dashboardActive()&&fallbackTimer===null)fallbackTimer=setTimeout(fallbackPoll,12000);
 }
}
function startFallback(){if(fallbackTimer===null&&!streamOpen&&!fallbackBusy)fallbackTimer=setTimeout(fallbackPoll,0)}
function stopFallback(){if(fallbackTimer!==null){clearTimeout(fallbackTimer);fallbackTimer=null}}
function ensure(){
 const active=!!document.querySelector('#dashboard.view.active');
 if(active){
  panel();
  if(!window.fpES)start(st.ticker);
  else if(!streamOpen)startFallback();
  else stopFallback();
 }else{
  if(window.fpES){try{window.fpES.close()}catch{};window.fpES=null}
  streamOpen=false;
  stopFallback();
 }
}
const c=document.createElement('style');c.textContent='.liveMarketOS{margin-bottom:14px;background:linear-gradient(145deg,#091323,#101d34);color:#eef4ff;border-color:#263957}.liveMarketOS .muted,.liveMarketOS small{color:#9eabc0}.liveMarketHead{display:flex;justify-content:space-between;gap:16px}.liveMarketHead h3{margin:4px 0}.liveMarketControls{display:flex;gap:8px}.liveMarketControls select{background:#0d1729;color:#eef4ff;border:1px solid #263957;border-radius:8px;padding:8px}.liveMarketGrid{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:10px;margin-top:14px}.liveMarketGrid>div{padding:13px;border:1px solid #263957;border-radius:10px;background:#ffffff08}.liveMarketGrid b{display:block;font-size:20px;margin-top:5px}.liveMarketGrid strong{display:block;margin-top:5px}.liveMarketTape{display:flex;gap:8px;overflow:auto;padding-top:10px}.liveMarketTape span{min-width:130px;padding:9px;background:#ffffff08;border-radius:8px;border:1px solid #263957}.liveMarketTape em{font-style:normal;margin-left:5px;font-size:11px}.liveMarketTape small{display:block;margin-top:4px}.liveMarketFoot{display:flex;justify-content:space-between;margin-top:11px;padding-top:10px;border-top:1px solid #263957;font-size:10px;color:#8f9db2}@media(max-width:700px){.liveMarketHead{display:block}.liveMarketGrid{grid-template-columns:1fr 1fr}.liveMarketFoot{display:block}}';document.head.appendChild(c);
window.FinPilotLiveMarket={start:start,ensure:ensure,state:st};setInterval(ensure,1200);
})();