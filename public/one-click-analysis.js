/* FinPilot one-click stock intelligence orchestration.
   Search -> evidence -> Financial Brain -> all agents -> CEO/CFO/Judge -> paper council.
   This is decision support only. It never places a real trade. */
(function(){
  function loadEvolutionEngine(){
    if(window.FinPilotEvolution||document.getElementById('finpilotEvolutionScript'))return;
    const s=document.createElement('script');s.id='finpilotEvolutionScript';s.src='/agent-evolution.js';s.defer=true;document.head.appendChild(s);
  }
  loadEvolutionEngine();
  function loadQuantumControlPlane(){
    if(window.FinPilotQuantum||document.getElementById('finpilotQuantumScript'))return;
    const s=document.createElement('script');s.id='finpilotQuantumScript';s.src='/quantum-ai.js';s.defer=true;document.head.appendChild(s);
  }
  loadQuantumControlPlane();
  let rawDoSearch = null;
  let running = false;
  let activeRunId = 0;

  const withTimeout=(promise,ms,label)=>{
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out after '+Math.round(ms/1000)+'s')),ms);})
    ]).finally(()=>clearTimeout(timer));
  };

  async function fetchJsonBounded(url,options={},ms=12000,label='Request'){
    const controller=new AbortController();
    let timer;
    const operation=(async()=>{
      const response=await fetch(url,{...options,signal:controller.signal});
      let data;
      try{data=await response.json();}
      catch(e){throw new Error(label+' returned invalid JSON');}
      if(!response.ok)throw new Error(data?.error||label+' failed (HTTP '+response.status+')');
      return data;
    })();
    try{
      return await Promise.race([
        operation,
        new Promise((_,reject)=>{timer=setTimeout(()=>{
          controller.abort();
          reject(new Error(label+' timed out after '+Math.round(ms/1000)+'s'));
        },ms);})
      ]);
    }finally{
      clearTimeout(timer);
      controller.abort();
    }
  }

  function updateAnalysisStatus(message,mode='running'){
    let el=document.getElementById('fpPipelineStatus');
    if(!el){
      el=document.createElement('div');
      el.id='fpPipelineStatus';
      el.className='notice';
      el.setAttribute('role','status');
      el.setAttribute('aria-live','polite');
      el.style.cssText='margin:12px 0;padding:12px;border-radius:10px;display:block;';
      const host=document.querySelector('.searchCommand');
      const results=document.getElementById('searchResults');
      if(host&&results)host.insertBefore(el,results);
      else document.body.insertBefore(el,document.body.firstChild);
    }
    el.style.display='block';
    el.dataset.state=mode;
    const heading=mode==='complete'?'Analysis complete':mode==='error'?'Analysis stopped':mode==='busy'?'Analysis already running':'FinPilot analysis';
    el.innerHTML='<b>'+escLocal(heading)+'</b><div style="margin-top:4px">'+escLocal(message)+'</div>';
    const top=document.getElementById('fpRunStatus');
    if(top)top.innerHTML='<b>'+escLocal(heading)+'</b><br><span>'+escLocal(message)+'</span>';
  }

  function escLocal(v){
    return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function buildAgentCycle(){
    refreshBrain();
    const findings=state.findings||[];
    const alerts=[];
    findings.filter(f=>f.severity==='HIGH').forEach(f=>alerts.push({
      title:f.title,reason:f.detail,priority:'HIGH',status:'Pending',source:'Financial Brain',findingId:f.domain
    }));
    const surplus=state.income-state.spending;
    if(surplus>0)alerts.push({
      title:'Protect monthly surplus',
      reason:`${money(surplus)} free cash is available before allocation.`,
      priority:'MEDIUM',status:'Pending',source:'CFO Agent'
    });
    const enabled=AGENTS.map(a=>a[0]).concat((state.agents||[]).filter(a=>a.enabled).map(a=>a.name));
    enabled.forEach(name=>state.agentRuns.unshift({
      agent:name,time:new Date().toISOString(),
      finding:`${name} reviewed ${findings.length} structured findings.`,outcome:'PENDING'
    }));
    state.agentRuns=state.agentRuns.slice(0,100);
    state.actions=alerts;
    state.lastAgent=new Date().toISOString();
    state.memory.push({
      title:'One-click agent fleet cycle',
      text:`${enabled.length} agents reviewed ${findings.length} structured findings.`,
      time:new Date().toLocaleTimeString()
    });
    return {findings,enabled,alerts};
  }

  function buildPaperCouncil(query,web){
    if(!window.FinPilotPaperCore)return null;
    // Never feed a fabricated price into the paper council. Web search evidence
    // is not a quote and must not be converted into a market price.
    const quote=web?.marketQuote;
    const requested=String(query||'').trim().toUpperCase();
    if(!quote||quote.verified!==true||!Number.isFinite(Number(quote.price))||Number(quote.price)<=0||
       String(quote.ticker||'').trim().toUpperCase()!==requested)return null;
    try{
      const p=syncPaperAgents();
      const market={
        symbol:requested,
        price:Number(quote.price),
        momentum:Number.isFinite(Number(quote.momentum))?Number(quote.momentum):0,
        quality:50,
        valuation:50,
        risk:50,
        evidence:Math.min(90,60+(web?.count||0)*4)
      };
      const round=FinPilotPaperCore.roundTable(state,market);
      p.lastMarket=market;p.lastRound=round;
      return round;
    }catch(e){return null}
  }

  function scenarioSafe(report){
    const d=report||{},m=d.marketReport||null,price=Number(m?.price),ticker=String(m?.ticker||m?.symbol||'').trim().toUpperCase();
    const requested=String(d.candidate?.ticker||d.ticker||'').trim().toUpperCase();
    const liveQuote=Boolean(m&&Number.isFinite(price)&&price>0&&(!requested||!ticker||ticker===requested)&&m.live===true&&m.asOf&&Number.isFinite(Date.parse(m.asOf))&&(Date.now()-Date.parse(m.asOf))<=120000);
    if(!liveQuote){
      return {version:'market-data-gate-v1',upgradeCount:0,amount:1000,horizon:30,action:'NO TRADE — VERIFY LIVE MARKET DATA',riskBand:'UNVERIFIED',approved:false,buyProbability:null,sellProbability:null,holdProbability:null,upsidePct:null,downsidePct:null,estimatedProfit:null,estimatedLoss:null,riskReward:null,expectedValue:null,inputs:{marketDataVerified:false},plan:{requestedAmount:1000,recommendedAmount:0,approval:'BLOCKED',riskBudget:0,capitalAtRisk:0,targetProfit:0,stopLoss:0,maximumLoss:0,positionCap:0,gateReasons:['No fresh, matching live market quote'],actionReason:'Market-dependent probabilities and P/L are blocked until a fresh quote for the selected ticker is verified.'},probabilityBasis:'Not calculated: fresh matching live quote unavailable.',disclaimer:'No trade plan: verify ticker, exchange, currency and quote timestamp first.'};
    }
    try{const engine=window.FinpilotMoneyEngine;if(engine&&typeof engine.analyze==='function'){const x=engine.analyze(report,1000,30);if(x&&Number.isFinite(Number(x.buyProbability))&&x.plan)return x;}}catch(e){}
    const risk=Math.max(0,Math.min(100,Number(d.risk??50))),conf=Math.max(0,Math.min(100,Number(d.confidence??50)));
    const buy=Math.max(5,Math.min(85,50+(conf-risk)*.22)),sell=Math.max(5,Math.min(85,30+(risk-conf)*.18)),hold=Math.max(5,100-buy-sell),total=buy+sell+hold,b=buy/total*100,s=sell/total*100,h=hold/total*100;
    const up=Math.max(2,Math.min(18,3.5+conf*.06)),down=Math.max(2,Math.min(18,2.5+risk*.08)),reward=1000*up/100,loss=1000*down/100;
    return {version:'fallback',upgradeCount:50,amount:1000,horizon:30,action:b>=s+8&&up/down>=1.25?'BUY BIAS':s>=b+8?'SELL / AVOID':'HOLD / WAIT',riskBand:risk>=70?'HIGH':risk>=45?'MEDIUM':'LOW',approved:false,buyProbability:Number(b.toFixed(2)),sellProbability:Number(s.toFixed(2)),holdProbability:Number(h.toFixed(2)),upsidePct:Number(up.toFixed(2)),downsidePct:Number(down.toFixed(2)),estimatedProfit:Number(reward.toFixed(2)),estimatedLoss:Number(loss.toFixed(2)),riskReward:Number((up/down).toFixed(2)),expectedValue:Number(((b/100)*reward-(s/100)*loss).toFixed(2)),inputs:{risk,confidence:conf,ceo:conf,cfo:conf,judge:conf,evidence:50,market:50},plan:{requestedAmount:1000,recommendedAmount:0,approval:'BLOCKED',riskBudget:Math.round(1000*Math.max(0,Math.min(4.5,1.5+(100-risk)*.035))/100),capitalAtRisk:0,targetPct:Number(up.toFixed(2)),stopPct:-Number(down.toFixed(2)),trailingStopPct:Number((down*.65).toFixed(2)),targetProfit:0,stopLoss:0,maximumLoss:0,breakEvenPct:.25,breakEvenCost:2.5,riskReward:Number((up/down).toFixed(2)),expectedValue:0,stress7:Number((down*1.35).toFixed(2)),stress30:Number((down*1.75).toFixed(2)),stress90:Number((down*2.25).toFixed(2)),positionCap:0,gateReasons:['Scenario engine fallback'],actionReason:'Primary scenario engine was unavailable; no capital allocation is approved.'},probabilityBasis:'Fallback safety calculation because the primary scenario engine was unavailable.',disclaimer:'Fallback scenario only. No trade is approved.'};
  }

  function buildChartAnalysis(market,money,candidate){
    if(!market)return {available:false,message:'Live price-series data was not returned for this candidate.'};
    const positive=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
    const candles=Array.isArray(market.candles)?market.candles.filter(x=>{
      if(!x)return false;
      const o=Number(x.open),h=Number(x.high),l=Number(x.low),c=Number(x.close);
      return [o,h,l,c].every(v=>Number.isFinite(v)&&v>0)&&h>=Math.max(o,c,l)&&l<=Math.min(o,c,h);
    }).map(x=>({...x,open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number.isFinite(Number(x.volume))?Number(x.volume):0})).slice(-80):[];
    const s20=positive(market.sma20),s50=positive(market.sma50),price=positive(market.price);
    const highs=candles.slice(-24).map(x=>x.high),lows=candles.slice(-24).map(x=>x.low);
    const computedResistance=highs.length?Math.max(...highs):null;
    const computedSupport=lows.length?Math.min(...lows):null;
    const resistance=positive(market.recentHigh)??positive(market.resistance)??computedResistance;
    const support=positive(market.recentLow)??positive(market.support)??computedSupport;
    const target=positive(money?.upsidePct)&&price!==null?price*(1+Number(money.upsidePct)/100):resistance;
    const stop=positive(money?.downsidePct)&&price!==null?price*(1-Number(money.downsidePct)/100):support;
    const baseTrend=price!==null&&s20!==null&&price>=s20&&(s50===null||price>=s50)?'BULLISH TREND':'DEFENSIVE / MIXED';
    const trend=market.live===true?baseTrend:'HISTORICAL / DELAYED · '+baseTrend;
    return {available:candles.length>1,realtimeAvailable:Boolean(market.live),candles,price,sma20:s20,sma50:s50,support,resistance,target,stop,rsi:positive(market.rsi),trend,ticker:market.ticker||market.symbol||candidate?.ticker,name:market.name||candidate?.name,provider:market.provider,asOf:market.asOf,market:String(market.market||candidate?.market||'').toUpperCase(),currency:String(market.currency||(String(market.market||'').toUpperCase()==='CRYPTO'?'USD':'INR')).toUpperCase()};
  }
  function chartSvg(a){
    const validCandles=Array.isArray(a?.candles)?a.candles.filter(r=>{
      if(!r)return false;
      const o=Number(r.open),h=Number(r.high),l=Number(r.low),c=Number(r.close);
      return [o,h,l,c].every(v=>Number.isFinite(v)&&v>0)&&h>=Math.max(o,c,l)&&l<=Math.min(o,c,h);
    }):[];
    // Prefer a local SVG from the returned candles, including EOD/delayed series.
    // This avoids rendering an empty chart when the third-party widget is blocked.
    if(validCandles.length<2){
      const ticker=String(a?.ticker||'').toUpperCase().replace(/[^A-Z0-9._-]/g,'').replace(/\.(?:NS|BO)$/,'');
      if(!ticker)return '<div class="notice">No chart series or verified symbol was returned. FinPilot will not invent candles.</div>';
      const crypto=String(a?.market||'').toUpperCase()==='CRYPTO';
      const tvSymbol=crypto?'BINANCE:'+ticker.replace(/USDT$/,'')+'USDT':'NSE:'+ticker;
      const marketLabel=crypto?'crypto spot':'stock';
      return '<div class="tv-fallback-wrap"><div class="notice" style="margin-bottom:8px"><b>No local candle series available.</b> FinPilot is requesting the official TradingView '+marketLabel+' chart. Live forecast eligibility remains separately gated by quote freshness.</div><div class="tv-chart" data-tv-symbol="'+escLocal(tvSymbol)+'"></div><div class="muted" style="font-size:10px;margin-top:5px">External chart fallback · verify quote freshness before acting.</div></div>';
    }
    const rows=validCandles.slice(-80),w=760,h=260,pad=28;
    const vals=rows.flatMap(x=>[Number(x.low),Number(x.high)]).concat([a?.sma20,a?.sma50,a?.support,a?.resistance, a?.price]).map(Number).filter(v=>Number.isFinite(v)&&v>0);
    let lo=Math.min(...vals),hi=Math.max(...vals);
    if(!(hi>lo)){lo=Math.max(.00000001,lo*.99);hi=hi*1.01;}
    const x=i=>pad+(w-2*pad)*(i/Math.max(1,rows.length-1));
    const y=v=>h-pad-(h-2*pad)*((v-lo)/(hi-lo));
    const path=rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(Number(r.close)).toFixed(1)).join(' ');
    const line=(v,dash,label)=>Number.isFinite(Number(v))&&Number(v)>0?'<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+y(Number(v)).toFixed(1)+'" y2="'+y(Number(v)).toFixed(1)+'" stroke="'+(dash?'#94a3b8':'#cbd5e1')+'" stroke-width="1" stroke-dasharray="'+(dash?'5 4':'2 3')+'"/><text x="'+(w-pad-2)+'" y="'+(y(Number(v))-4).toFixed(1)+'" text-anchor="end" fill="#64748b" font-size="11">'+escLocal(label||Number(v).toFixed(2))+'</text>':'';
    const live=a?.realtimeAvailable===true;
    const asOf=escLocal(a?.asOf||'timestamp unavailable');
    const chartLabel=live?'Verified live price series':'Historical / delayed price series';
    return '<div style="overflow:auto"><div class="muted" style="font-size:11px;margin:2px 0 6px">'+chartLabel+' · Source time: '+asOf+'</div><svg viewBox="0 0 '+w+' '+h+'" style="width:100%;min-width:620px;height:260px;background:#f8fafc;border-radius:10px" role="img" aria-label="'+chartLabel+'">'+line(a?.support,true,'Support '+Number(a?.support).toFixed(2))+line(a?.resistance,true,'Resistance '+Number(a?.resistance).toFixed(2))+'<path d="'+path+'" fill="none" stroke="#315efb" stroke-width="3"/>'+line(a?.sma20,false,'SMA20 '+Number(a?.sma20).toFixed(2))+line(a?.sma50,false,'SMA50 '+Number(a?.sma50).toFixed(2))+'</svg></div>';
  }
  function mountTradingViewFallbacks(){
    document.querySelectorAll('.tv-chart[data-tv-symbol]').forEach(el=>{
      if(el.dataset.mounted==='1'||el.dataset.mounted==='loading')return;
      const symbol=el.dataset.tvSymbol;
      el.dataset.mounted='loading';
      el.innerHTML='<div class="tradingview-widget-container" style="height:360px;width:100%;border-radius:10px;overflow:hidden;background:#fff"><div class="tradingview-widget-container__widget" style="height:328px;width:100%"></div><div class="tradingview-widget-copyright" style="height:32px;padding:5px 8px;font-size:10px"><a href="https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/" target="_blank" rel="noopener noreferrer">Advanced Chart</a> by TradingView</div></div>';
      const widget=el.firstElementChild;
      const widgetBody=widget?.querySelector('.tradingview-widget-container__widget');
      const showFallback=message=>{
        if(el.dataset.mounted==='fallback')return;
        el.dataset.mounted='fallback';
        el.innerHTML='<div class="notice" role="status"><b>Interactive chart unavailable.</b> '+escLocal(message)+' The analysis still uses only the returned market data; no candles have been fabricated.</div><p><a href="https://www.tradingview.com/chart/'+ '?symbol='+encodeURIComponent(symbol)+'" target="_blank" rel="noopener noreferrer">Open '+escLocal(symbol)+' on TradingView ↗</a></p>';
      };
      const script=document.createElement('script');
      script.type='text/javascript';
      script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.async=true;
      script.textContent=JSON.stringify({autosize:true,symbol,interval:'60',timezone:'exchange',theme:'light',style:'1',locale:'en',allow_symbol_change:true,calendar:false,withdateranges:true,hide_side_toolbar:true,hide_top_toolbar:false,hide_volume:false,save_image:false,support_host:'https://www.tradingview.com'});
      script.onerror=()=>showFallback('The TradingView script was blocked or failed to load.');
      widget?.appendChild(script);
      setTimeout(()=>{
        if(el.dataset.mounted==='loading'&&!widgetBody?.querySelector('iframe')){
          showFallback('The widget did not create a chart frame in time.');
        }else if(el.dataset.mounted==='loading'){
          el.dataset.mounted='1';
        }
      },12000);
    });
  }
  function publishEquitySnapshot(market){
    if(!market||!Number.isFinite(Number(market.price)))return;
    const host=document.querySelector('#dashboard .content')||document.querySelector('#dashboard')||document.querySelector('.content');
    if(!host)return;
    let box=document.getElementById('live-equity-snapshot');
    if(!box){
      box=document.createElement('section');box.id='live-equity-snapshot';box.className='card';
      box.style.cssText='margin-bottom:14px;background:linear-gradient(145deg,#071426,#0e2340);color:#edf5ff;border-color:#1d4674';
      host.prepend(box);
    }
    const p=Number(market.price),ch=Number(market.changePct),hi=Number(market.dayHigh),lo=Number(market.dayLow),rsi=Number(market.rsi);
    const crypto=String(market.market||'').toUpperCase()==='CRYPTO';
    const currency=String(market.currency||(crypto?'USD':'INR')).toUpperCase();
    const currencyMark=currency==='USD'?'$':currency==='INR'?'₹':currency+' ';
    const priceText=v=>Number.isFinite(v)?currencyMark+Number(v).toLocaleString(currency==='INR'?'en-IN':'en-US',{maximumFractionDigits:currency==='USD'&&Math.abs(v)<1?6:2}):'—';
    const cls=ch>=0?'#2de0a5':'#ff7b8b';
    box.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#91a7c5;font-weight:800">LATEST MARKET DATA</div><h3 style="margin:5px 0 3px">'+escLocal(market.name||market.ticker)+' · '+escLocal(market.ticker||'')+'</h3><div style="font-size:11px;color:#91a7c5">'+escLocal(market.exchange||(crypto?'Crypto market':'Exchange'))+' · '+escLocal(currency)+' · '+escLocal(market.provider||'market adapter')+'</div></div><span class="pill '+(market.live?'low':'med')+'">'+(market.live?'LIVE DATA':'NON-LIVE DATA')+'</span></div><div class="grid four" style="margin-top:12px;grid-template-columns:repeat(4,minmax(0,1fr))"><div><span style="color:#91a7c5;font-size:11px">PRICE</span><div style="font-size:24px;font-weight:800">'+priceText(p)+'</div><div style="color:'+cls+';font-weight:800">'+(ch>=0?'+':'')+ch.toFixed(2)+'%</div></div><div><span style="color:#91a7c5;font-size:11px">DAY HIGH</span><div style="font-size:19px;font-weight:750;margin-top:5px">'+priceText(hi)+'</div></div><div><span style="color:#91a7c5;font-size:11px">DAY LOW</span><div style="font-size:19px;font-weight:750;margin-top:5px">'+priceText(lo)+'</div></div><div><span style="color:#91a7c5;font-size:11px">RSI</span><div style="font-size:19px;font-weight:750;margin-top:5px">'+(Number.isFinite(rsi)?rsi.toFixed(1):'—')+'</div></div></div><div style="margin-top:10px;color:#a9b8cc;font-size:10px">Updated '+escLocal(market.asOf||'now')+' · recent/delayed market data · verify broker/exchange quote before acting.</div>';
    state.lastMarketReport={ticker:market.ticker,name:market.name,price:p,changePct:ch,dayHigh:hi,dayLow:lo,rsi,provider:market.provider,asOf:market.asOf};
    save();
  }
  function injectMarketChartStyles(){
    if(document.getElementById('fp-market-chart-styles'))return;
    const s=document.createElement('style');s.id='fp-market-chart-styles';s.textContent='.tv-chart{min-height:360px;border-radius:10px;overflow:hidden;background:#fff}.tradingview-widget-container{font-family:Inter,system-ui,sans-serif}@media(max-width:640px){#live-equity-snapshot .grid.four{grid-template-columns:1fr 1fr!important}.tv-chart{min-height:330px}}';document.head.appendChild(s);
  }
  function detectChartPattern(ca){
    const candles=Array.isArray(ca?.candles)?ca.candles.filter(x=>Number.isFinite(Number(x?.close))):[];
    if(candles.length<8)return {name:"Pattern not clear",confidence:35,reason:"Not enough verified candles."};
    const cls=candles.map(x=>Number(x.close)), highs=candles.map(x=>Number(x.high??x.close)), lows=candles.map(x=>Number(x.low??x.close));
    const n=cls.length,last=cls[n-1],prev=cls[n-2],h20=Math.max(...highs.slice(-20)),l20=Math.min(...lows.slice(-20));
    const first=cls[Math.max(0,n-10)],slope=((last-first)/Math.max(1,first))*100,range=Math.max(.01,h20-l20),pos=(last-l20)/range;
    const body=Math.abs(last-prev)/Math.max(.01,prev),higherHigh=highs[n-1]>=Math.max(...highs.slice(-5,-1)),lowerLow=lows[n-1]<=Math.min(...lows.slice(-5,-1));
    let name="Sideways / mixed",confidence=52,reason="Price is moving without a strong breakout.";
    if(higherHigh&&slope>2&&pos>.65){name="Uptrend / breakout attempt";confidence=72;reason="Recent highs are rising and price is near the upper part of its recent range."}
    else if(lowerLow&&slope<-2&&pos<.35){name="Downtrend / breakdown attempt";confidence=72;reason="Recent lows are falling and price is near the lower part of its recent range."}
    else if(pos>.72&&body<.008){name="Resistance test";confidence=64;reason="Price is testing the upper range with a relatively small recent move."}
    else if(pos<.28&&body<.008){name="Support test";confidence=64;reason="Price is testing the lower range with a relatively small recent move."}
    else if(Math.abs(slope)<1.5&&range/Math.max(.01,last)<.08){name="Tight range / possible breakout";confidence=61;reason="Volatility is compressed and price is near a range boundary."}
    return {name,confidence,reason,slope};
  }

  function renderOneClickPanel(q,report){
    const box=document.getElementById('searchResults');
    if(!box)return;
    const e=report.executive||{};
    const web=report.webSignal||{};
    const paper=report.paper;
    const money=scenarioSafe(report);
    const scenarioDays=Math.max(1,Math.min(365,Number(money?.horizon)||30));
    const scenarioQuote=report.marketReport||null;
    const scenarioTicker=String(scenarioQuote?.ticker||scenarioQuote?.symbol||'').trim().toUpperCase();
    const requestedTicker=String(report.candidate?.ticker||report.ticker||'').trim().toUpperCase();
    const scenarioQuoteValid=Boolean(scenarioQuote&&scenarioQuote.live===true&&Number(scenarioQuote.price)>0&&scenarioQuote.asOf&&Number.isFinite(Date.parse(scenarioQuote.asOf))&&(Date.now()-Date.parse(scenarioQuote.asOf))<=120000&&(!requestedTicker||!scenarioTicker||requestedTicker===scenarioTicker));
    const scenarioStartedAt=new Date();
    const scenarioReviewAt=new Date(scenarioStartedAt.getTime()+scenarioDays*86400000);
    const formatScenarioDate=date=>date.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
    const scenarioTimingLabel=scenarioQuoteValid?('Illustrative '+scenarioDays+'-day window · review by '+formatScenarioDate(scenarioReviewAt)+' IST'):'Unavailable until a fresh, matching live quote is verified';
    const candidate=report.candidate||null;
    const v8=window.FinPilotV8?.analyze(report,money,{amount:1000})||null;
    const risk=Number(report.risk||0);
    const chartCurrency=String(report.chartAnalysis?.currency||'INR').toUpperCase();
    const chartCurrencyMark=chartCurrency==='USD'?'$':chartCurrency==='INR'?'₹':chartCurrency+' ';
    const chartPrice=value=>Number(value)>0?chartCurrencyMark+Number(value).toLocaleString(chartCurrency==='INR'?'en-IN':'en-US',{maximumFractionDigits:chartCurrency==='USD'&&Math.abs(Number(value))<1?6:2}):'N/A';
    const riskClass=risk>=70?'high':risk>=45?'med':'low';
    const paperLabel=paper?paper.final:'NOT RUN';
    const html=`
      <div id="oneClickResult" class="card" style="margin-bottom:14px;border:2px solid #315efb;background:linear-gradient(180deg,#f8faff,#fff)">
        <div class="sectionTitle">
          <div><span class="eyebrow">Simple One-Click Analysis</span><h3 style="font-size:18px;margin-top:5px">Complete analysis · ${escLocal(q)}</h3></div>
          <span class="pill low">COMPLETE</span>
        </div>
        <div class="card" style="margin-bottom:12px;border:1px solid #315efb;background:#eef5ff">
          <div class="sectionTitle"><div><span class="eyebrow">MATCHED STOCK</span><h3 style="font-size:20px;margin-top:5px">${candidate?escLocal(candidate.name):'No stock identified yet'}</h3><span class="muted">${candidate?escLocal(candidate.ticker)+' · '+escLocal(candidate.method):'Search results did not contain a resolvable stock symbol.'}</span></div><span class="pill ${candidate&&candidate.confidence>=70?'low':'med'}">${candidate?candidate.confidence+'% CONFIDENCE':'CHECK'}</span></div>
          ${candidate?`<div class="grid three"><div class="card"><span class="muted">Match score</span><div class="metric">${candidate.score}/100</div></div><div class="card"><span class="muted">News mentions</span><div class="metric">${candidate.evidenceMentions||0}</div></div><div class="card"><span class="muted">Positive / negative</span><div class="metric">+${candidate.positive||0} / −${candidate.negative||0}</div></div></div><div class="notice" style="margin-top:10px"><b>Why this stock:</b> ${escLocal(candidate.reason||'Highest evidence-weighted candidate found in the current search results.')}<br><span class="muted">${escLocal(candidate.disclaimer||'Evidence-ranked candidate; not a guaranteed trade.')}</span></div>`:'<div class="notice">Try a query containing a stock symbol or a broad request such as “pick best stock for today trading”. FinPilot will rank identifiable candidates instead of returning an unnamed CHECK result.</div>'}
        </div>
        <div class="card" style="margin-bottom:12px;border:1px solid #cbd7ee;background:#fff">
          <div class="sectionTitle"><div><span class="eyebrow">${report.chartAnalysis?.realtimeAvailable?'PRICE CHART':'PRICE CHART'}</span><h3 style="font-size:18px;margin-top:5px">${escLocal(report.chartAnalysis?.name||report.candidate?.name||q)} · ${escLocal(report.chartAnalysis?.ticker||report.candidate?.ticker||'')}</h3></div><span class="pill ${report.chartAnalysis?.realtimeAvailable?'low':'med'}">${report.chartAnalysis?.realtimeAvailable?'LIVE SERIES':(report.chartAnalysis?.available?'HISTORICAL SERIES':'EXTERNAL CHART')}</span></div>
          ${chartSvg(report.chartAnalysis)}
          <div class="grid cards" style="margin-top:10px">
            <div class="card"><span class="muted">${report.marketForecastEligible===true&&scenarioQuoteValid?'Verified live price':(report.chartAnalysis?.realtimeAvailable?'Live quote · plan blocked':'Latest reported price · non-live/EOD')}</span><div class="metric">${chartPrice(report.chartAnalysis?.price)}</div></div>
            <div class="card"><span class="muted">RSI</span><div class="metric">${Number(report.chartAnalysis?.rsi||0).toFixed(1)}</div></div>
            <div class="card"><span class="muted">SMA20 / SMA50</span><div class="metric" style="font-size:16px">${chartPrice(report.chartAnalysis?.sma20)} / ${chartPrice(report.chartAnalysis?.sma50)}</div></div>
            <div class="card"><span class="muted">Support / Resistance</span><div class="metric" style="font-size:16px">${chartPrice(report.chartAnalysis?.support)} / ${chartPrice(report.chartAnalysis?.resistance)}</div></div>
          </div>
          <div class="notice" style="margin-top:10px"><b>Chart read:</b> ${escLocal(report.chartAnalysis?.trend||'CHECK')} · Target scenario ${chartPrice(report.chartAnalysis?.target)} · Stop scenario ${chartPrice(report.chartAnalysis?.stop)}. <span class="muted">Source: ${escLocal(report.chartAnalysis?.provider||'live market adapter')} · ${escLocal(report.chartAnalysis?.asOf||'')}</span></div>          <div class="card" style="margin-top:10px;border:1px solid #d8e0ef;background:#fbfcff"><div class="sectionTitle"><div><span class="eyebrow">CHART PATTERN</span><h3 style="font-size:17px;margin-top:4px">${escLocal(detectChartPattern(report.chartAnalysis).name)}</h3></div><span class="pill low">${detectChartPattern(report.chartAnalysis).confidence}% confidence</span></div><div class="muted">${escLocal(detectChartPattern(report.chartAnalysis).reason)}</div><div class="notice" style="margin-top:8px"><b>What to watch:</b> breakout above resistance or breakdown below support. Pattern detection uses the valid candle series available in this run; it does not imply live quote freshness.</div></div>

        </div>
        <div class="grid cards" style="margin-bottom:12px">
          <div class="card"><span class="muted">News & evidence</span><div class="metric">${web.count||0}</div><span class="muted">${escLocal(web.provider||'web')} · ${escLocal(web.stance||'Mixed')}</span></div>
          <div class="card"><span class="muted">Risk level</span><div class="metric ${riskClass==='high'?'red':riskClass==='med'?'yellow':'green'}">${risk}</div><span class="muted">${escLocal(report.evidenceFreshness||'CHECK')}</span></div>
          <div class="card"><span class="muted">AI specialists</span><div class="metric">${report.agentCount}</div><span class="muted">specialists completed</span></div>
          <div class="card"><span class="muted">Final check</span><div class="metric" style="font-size:18px">${escLocal(paperLabel)}</div><span class="muted">virtual only</span></div>
        </div>
        <div class="grid three">
          <div class="decision"><span class="pill low">CEO · OPPORTUNITY</span><p>${escLocal(e.ceo||'No CEO view')}</p><b>${e.ceoConfidence||0}% confidence</b></div>
          <div class="decision"><span class="pill med">CFO · SAFETY</span><p>${escLocal(e.cfo||'No CFO view')}</p><b>${e.cfoConfidence||0}% confidence</b></div>
          <div class="decision"><span class="pill">⚖ JUDGE · FINAL</span><h2>${escLocal(e.judge||report.decision||'VERIFY')}</h2><b>${report.confidence||0}% confidence</b></div>
        </div>
<div class="card" style="margin-top:12px;border:1px solid #d8e0ef;background:#fbfcff">
          <div class="sectionTitle"><div><span class="eyebrow">₹1,000 EXAMPLE</span><h3 style="font-size:18px;margin-top:5px">What ₹1,000 could look like</h3></div><span class="pill ${money?.riskBand==='HIGH'?'high':money?.riskBand==='MEDIUM'?'med':'low'}">${money?.riskBand||'CHECK'}</span></div>
          <div class="notice" style="margin-bottom:10px"><b>Expected P/L timing:</b> ${escLocal(scenarioTimingLabel)}<br><span class="muted">${scenarioQuoteValid?'Scenario calculated '+formatScenarioDate(scenarioStartedAt)+' IST using quote timestamp '+formatScenarioDate(new Date(scenarioQuote.asOf))+' IST. Profit/loss can occur earlier, later, or not at all; this is a review horizon, not a forecast guarantee.':'FinPilot will not assign an expected profit/loss date without verified fresh market data.'}</span></div>
          <div class="notice ${money?.approved===true?'':'highNotice'}" style="margin-bottom:10px"><b>Exposure gate:</b> ${money?.approved===true?'CONDITIONAL · recommended scenario exposure ₹'+Number(money?.plan?.recommendedAmount||0).toLocaleString('en-IN'):'BLOCKED · recommended exposure ₹'+Number(money?.plan?.recommendedAmount||0).toLocaleString('en-IN')}.<br><span class="muted">The gain/loss cards below are hypothetical outcomes on the full ₹1,000 example, not a promise or an approved position. Do not treat the scenario amount as a trade instruction.</span></div>
          <div class="grid cards" style="margin-bottom:10px">
            <div class="card"><span class="muted">Suggested view</span><div class="metric" style="font-size:19px">${escLocal(money?.action||'CHECK')}</div><span class="muted">${money?.horizon||30}-day scenario</span></div>
            <div class="card"><span class="muted">Buy probability</span><div class="metric green" style="font-size:22px">${money?.buyProbability||0}%</div><span class="muted">Model estimate</span></div>
            <div class="card"><span class="muted">Sell probability</span><div class="metric red" style="font-size:22px">${money?.sellProbability||0}%</div><span class="muted">Model estimate</span></div>
            <div class="card"><span class="muted">Hold probability</span><div class="metric" style="font-size:22px">${money?.holdProbability||0}%</div><span class="muted">Model estimate</span></div>
          </div>
          <div class="grid four">
            <div class="card"><span class="muted">If ₹1,000 gains</span><div class="metric green" style="font-size:20px">+₹${money?.estimatedProfit?.toLocaleString('en-IN')||0}</div><span class="muted">+${money?.upsidePct||0}% scenario</span></div>
            <div class="card"><span class="muted">If ₹1,000 falls</span><div class="metric red" style="font-size:20px">−₹${money?.estimatedLoss?.toLocaleString('en-IN')||0}</div><span class="muted">−${money?.downsidePct||0}% scenario</span></div>
            <div class="card"><span class="muted">Risk : Reward</span><div class="metric" style="font-size:20px">${money?.riskReward||0}:1</div><span class="muted">Potential upside / downside</span></div>
            <div class="card"><span class="muted">Expected value</span><div class="metric ${Number(money?.expectedValue||0)>=0?'green':'red'}" style="font-size:20px">${Number(money?.expectedValue||0)>=0?'+':''}₹${money?.expectedValue?.toLocaleString('en-IN')||0}</div><span class="muted">Probability-weighted scenario</span></div>
          </div>
          <div class="notice" style="margin-top:10px"><b>How the AI got this:</b> current risk ${money?.inputs?.risk||0} · CEO ${money?.inputs?.ceo||0}% · CFO ${money?.inputs?.cfo||0}% · Judge ${money?.inputs?.judge||0}% · evidence ${money?.inputs?.evidence||0} · market ${money?.inputs?.market||0}.<br><span class="muted">${escLocal(money?.probabilityBasis||'')}</span></div>
          <div class="notice highNotice" style="margin-top:8px"><b>Important:</b> ${escLocal(money?.disclaimer||'Scenario only.')}</div>
        </div>
<div class="card" style="margin-top:12px;border:1px solid #cfd8ea;background:#fff">
          <div class="sectionTitle"><div><span class="eyebrow">RISK CHECK</span><h3 style="font-size:18px;margin-top:5px">Safety and risk checks</h3></div><span class="pill ${v8?.gate?.includes('BLOCK')?'high':'low'}">${escLocal(v8?.gate||'CHECK')}</span></div>
          <div class="grid four">
            <div class="card"><span class="muted">Safe position</span><div class="metric" style="font-size:20px">₹${v8?.position?.recommended?.toLocaleString('en-IN')||0}</div><span class="muted">of ₹${v8?.position?.requested?.toLocaleString('en-IN')||0} requested</span></div>
            <div class="card"><span class="muted">Risk-adjusted return</span><div class="metric" style="font-size:20px">${v8?.riskMetrics?.riskAdjustedReturn||0}%</div><span class="muted">quality-adjusted</span></div>
            <div class="card"><span class="muted">7-day stress</span><div class="metric red" style="font-size:20px">−${v8?.scenarios?.stress7||0}%</div><span class="muted">stress case</span></div>
            <div class="card"><span class="muted">Signal stability</span><div class="metric" style="font-size:20px">${v8?.quality?.signalStability||0}%</div><span class="muted">CEO/CFO/evidence</span></div>
          </div>
          <div class="grid three" style="margin-top:10px">
            <div class="card"><span class="muted">Target / stop</span><div class="metric" style="font-size:17px">+${v8?.scenarios?.targetMovePct||0}% / ${v8?.scenarios?.stopMovePct||0}%</div><span class="muted">scenario boundaries</span></div>
            <div class="card"><span class="muted">Maximum loss</span><div class="metric red" style="font-size:18px">₹${v8?.riskMetrics?.maxLoss?.toLocaleString('en-IN')||0}</div><span class="muted">risk budget</span></div>
            <div class="card"><span class="muted">Audit ID</span><div class="metric" style="font-size:15px">${escLocal(v8?.auditId||'—')}</div><span class="muted">decision trace</span></div>
          </div>
          <div class="notice" style="margin-top:10px"><b>Re-evaluation triggers:</b> ${v8?.triggers?.length?v8.triggers.map(escLocal).join(' · '):'No immediate trigger; continue monitoring.'}</div>
          <div class="notice" style="margin-top:8px"><b>v8 decision trace:</b> ${v8?.trace?.map(escLocal).join(' → ')||'Not available'}</div>
          <div class="muted" style="margin-top:8px">${escLocal(v8?.disclaimer||'')}</div>
        </div>        <div class="card" style="margin-top:12px;border:2px solid #315efb;background:#f7f9ff">
          <div class="sectionTitle"><div><span class="eyebrow">₹1,000 RISK PLAN</span><h3 style="font-size:18px;margin-top:5px">Amount · target · stop · loss</h3></div><span class="pill ${money.plan?.approval==='CONDITIONAL'?'low':'high'}">${escLocal(money.plan?.approval||'BLOCKED')}</span></div>
          <div class="grid four">
            <div class="card"><span class="muted">Requested</span><div class="metric">₹${Number(money.plan?.requestedAmount||1000).toLocaleString('en-IN')}</div><span class="muted">scenario capital</span></div>
            <div class="card"><span class="muted">Recommended exposure</span><div class="metric ${Number(money.plan?.recommendedAmount||0)>0?'green':'red'}">₹${Number(money.plan?.recommendedAmount||0).toLocaleString('en-IN')}</div><span class="muted">${money.plan?.approval==='CONDITIONAL'?'paper-only conditional size':'capital protected'}</span></div>
            <div class="card"><span class="muted">Risk budget</span><div class="metric red">₹${Number(money.plan?.riskBudget||0).toLocaleString('en-IN')}</div><span class="muted">maximum planned risk</span></div>
            <div class="card"><span class="muted">Maximum loss</span><div class="metric red">₹${Number(money.plan?.maximumLoss||0).toLocaleString('en-IN')}</div><span class="muted">scenario boundary</span></div>
          </div>
          <div class="grid four" style="margin-top:10px">
            <div class="card"><span class="muted">Target</span><div class="metric green">+${Number(money.plan?.targetPct||0).toFixed(2)}%</div><span class="muted">+₹${Number(money.plan?.targetProfit||0).toLocaleString('en-IN')}</span></div>
            <div class="card"><span class="muted">Stop-loss</span><div class="metric red">${Number(money.plan?.stopPct||0).toFixed(2)}%</div><span class="muted">−₹${Number(money.plan?.stopLoss||0).toLocaleString('en-IN')}</span></div>
            <div class="card"><span class="muted">Trailing stop</span><div class="metric">${Number(money.plan?.trailingStopPct||0).toFixed(2)}%</div><span class="muted">dynamic risk control</span></div>
            <div class="card"><span class="muted">Break-even</span><div class="metric">${Number(money.plan?.breakEvenPct||0).toFixed(2)}%</div><span class="muted">cost buffer ₹${Number(money.plan?.breakEvenCost||0).toFixed(2)}</span></div>
          </div>
          <div class="notice" style="margin-top:10px"><b>Plan decision:</b> ${escLocal(money.plan?.actionReason||'No plan available.')}<br><b>Entry:</b> ${escLocal(money.plan?.entry||'Use verified market price only.')}</div>
          <div class="grid three" style="margin-top:10px">
            <div class="notice"><b>7-day stress</b><br>−${Number(money.plan?.stress7||0).toFixed(2)}%</div>
            <div class="notice"><b>30-day stress</b><br>−${Number(money.plan?.stress30||0).toFixed(2)}%</div>
            <div class="notice"><b>90-day stress</b><br>−${Number(money.plan?.stress90||0).toFixed(2)}%</div>
          </div>
          <div class="notice highNotice" style="margin-top:10px"><b>Safety:</b> ${escLocal((money.plan?.gateReasons||[]).join(' · ')||'No blocking gate detected.')} — This is a paper scenario; no real order is placed.</div>
        </div>
        <div class="notice" style="margin-top:12px"><b>Analysis used:</b> Internet evidence → Financial Brain → ${report.agentCount} agents → 7-voice Round Table → CEO → CFO → Judge → Action Center → final virtual check. No real order was placed.</div>
      </div>`;
    const old=document.getElementById('oneClickResult');
    if(old)old.remove();
    box.insertAdjacentHTML('afterbegin',html);
  }

  function liveWebSignal(){
    const d=window.__lastSearch||{};
    const rows=Array.isArray(d.results)?d.results:[];
    const text=rows.map(x=>String((x?.title||'')+' '+(x?.snippet||''))).join(' ').toLowerCase();
    const positive=(text.match(/surge|rise|gain|bullish|growth|upgrade|profit|strong|positive/g)||[]).length;
    const negative=(text.match(/fall|drop|loss|bearish|downgrade|debt|risk|warning|weak|negative/g)||[]).length;
    const stance=positive>negative+1?'Positive':negative>positive+1?'Cautious':'Mixed';
    return {provider:d.provider||'web',live:d.live===true&&d.cached!==true,cached:d.cached===true,cacheAgeMs:Number(d.cacheAgeMs||0),count:rows.length,positive,negative,stance,freshness:d.cached===true?'CACHED':d.live===true?'LIVE':'FALLBACK',query:d.query||'',results:rows.slice(0,10)};
  }

  function ensureRawSearch(){
    if(typeof rawDoSearch==='function')return rawDoSearch;
    if(typeof window.doSearch==='function'){
      rawDoSearch=window.doSearch;
      return rawDoSearch;
    }
    throw new Error('Search engine is still loading. Please try again in a moment.');
  }

  function createForecastLedgerRecord({snapshot,candidate,decision,money,chartAnalysis}={}){
    const createdAt=new Date().toISOString();
    const horizonDays=Math.max(1,Math.min(365,Number(money?.horizon)||30));
    const probability=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=100?n:null;};
    const price=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:null;};
    const eligible=snapshot?.quality?.forecastEligible===true&&price(snapshot?.quote?.price)!==null;
    const id='fc_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);
    return {
      schemaVersion:1,
      forecastId:id,
      createdAt,
      dueAt:new Date(Date.now()+horizonDays*86400000).toISOString(),
      horizonDays,
      modelVersion:'finpilot-one-click-baseline-v1',
      ticker:snapshot?.instrument?.ticker||candidate?.ticker||null,
      market:snapshot?.instrument?.market||'UNKNOWN',
      currency:snapshot?.instrument?.currency||'UNKNOWN',
      marketSnapshotId:snapshot?.snapshotId||null,
      dataStatus:snapshot?.quality?.status||'UNAVAILABLE',
      forecastEligible:eligible,
      forecastStatus:eligible?'PENDING_OUTCOME':'BLOCKED_UNVERIFIED_DATA',
      referencePrice:price(snapshot?.quote?.price),
      quoteAsOf:snapshot?.timing?.sourceAsOf||null,
      probabilitiesCalibrated:false,
      probabilities:{
        up:probability(money?.buyProbability),
        down:probability(money?.sellProbability),
        hold:probability(money?.holdProbability)
      },
      expectedValue:eligible&&Number.isFinite(Number(money?.expectedValue))?Number(money.expectedValue):null,
      targetPrice:price(chartAnalysis?.target),
      stopPrice:price(chartAnalysis?.stop),
      decision:String(decision?.decision||'UNSPECIFIED'),
      outcome:null,
      actualReturnPct:null,
      evaluatedAt:null
    };
  }

  async function runFullStockAnalysis(query){
    query=String(query||'').trim();
    if(!query){
      updateAnalysisStatus('Enter a stock, crypto symbol, company or finance question before running analysis.','error');
      return {ok:false,error:'EMPTY_QUERY'};
    }
    if(running){
      updateAnalysisStatus('The current analysis is still running. Wait for it to finish before starting another run.','busy');
      return {ok:false,error:'ANALYSIS_BUSY'};
    }

    running=true;
    const runId=++activeRunId;
    window.__fpAnalysisRunning=true;
    window.__fpActiveAnalysisQuery=query;
    try{
      if(typeof window.show==='function'&&!document.getElementById('search')?.classList.contains('active'))window.show('search');
    }catch{}
    const queryInput=document.getElementById('searchQuery');
    if(queryInput)queryInput.value=query;
    const box=document.getElementById('searchResults');
    if(box)box.innerHTML='';
    window.__lastSearch={query,results:[],provider:null,live:false};
    window.__lastMarketMatch=null;
    window.__fpLastRenderedQuery='';

    const stage=t=>{
      if(runId!==activeRunId)return;
      updateAnalysisStatus(t,'running');
    };

    try{
      let searchWarning='';
      stage('1/6 · Searching live evidence for “'+query+'”…');

      const searchPromise=(async()=>{
        try{
          const search=ensureRawSearch();
          await withTimeout(search(query),16000,'Web search');
          const result=window.__lastSearch||{query,results:[],provider:null,live:false};
          if(result.query&&String(result.query).trim()!==query){
            throw new Error('Search returned results for a different query. Please retry.');
          }
          return result;
        }catch(e){
          const message=String(e?.message||'Live web search unavailable');
          window.__lastSearch={query,results:[],provider:null,live:false,error:message};
          return window.__lastSearch;
        }
      })();

      const directMarketPromise=(async()=>{
        const raw=String(query).trim().toUpperCase();
        if(!/^(?:[A-Z][A-Z0-9]{0,5})(?:\.(?:NS|BO))?$/.test(raw))return null;
        try{
          return await fetchJsonBounded(
            '/api/market-snapshot?ticker='+encodeURIComponent(raw)+'&interval=1h&multi=1&ts='+Date.now(),
            {cache:'no-store',headers:{'Cache-Control':'no-cache'}},
            12000,
            'Market snapshot request'
          );
        }catch(e){
          return {ok:false,report:null,snapshot:null,error:String(e?.message||'Market snapshot unavailable')};
        }
      })();

      const search=await searchPromise;
      if(runId!==activeRunId)return {ok:false,error:'RUN_REPLACED'};
      searchWarning=search?.error||'';
      stage('2/6 · Ranking candidates and refreshing the Financial Brain…');

      const cycle=buildAgentCycle();
      const web=liveWebSignal();
      let candidate=window.FinPilotDeepLearning?.resolveCandidate(query,search,web)||null;
      const broadRequest=/\b(BEST|TOP|PICK|STOCK|TRADE|TRADING|TODAY|BUY|SELL|CANDIDATES|MARKET)\b/i.test(query);

      if(!candidate&&broadRequest){
        try{
          const picks=await fetchJsonBounded('/api/market-picks?limit=5',{cache:'no-store'},10000,'Market scan');
          const top=picks?.candidates?.[0];
          if(top){
            candidate={
              ticker:top.ticker,
              name:top.name,
              confidence:Math.round(Math.min(92,58+Number(top.score||0)*.34)),
              score:top.score,
              evidenceMentions:0,
              positive:Number(top.changePct||0)>0?1:0,
              negative:Number(top.changePct||0)<0?1:0,
              method:'Live market scan',
              reason:'Top scan score '+Number(top.score||0)+'/100; session move '+Number(top.changePct||0).toFixed(2)+'%; RSI '+Number(top.rsi||0).toFixed(1)+'.',
              disclaimer:picks.disclaimer||'Market-scan candidate; verify current broker/exchange data.'
            };
          }
        }catch(e){
          searchWarning=searchWarning||String(e?.message||'Market scan unavailable');
        }
      }

      const initialMarket=await directMarketPromise;
      let marketSnapshot=initialMarket?.snapshot||null;
      let directMarket=initialMarket?.report||null;
      const normalizeTicker=value=>String(value||'').trim().toUpperCase().replace(/\.(?:NS|BO)$/,'');
      // A short query can match a different instrument on another exchange (for example
      // "SBI" can map to an unrelated US-listed fund while web evidence resolves SBIN).
      // Fetch the resolved candidate's quote before rendering anything.
      if(candidate?.ticker&&directMarket&&normalizeTicker(directMarket.ticker||directMarket.symbol)!==normalizeTicker(candidate.ticker)){
        stage('Market symbol mismatch detected — fetching the resolved instrument…');
        try{
          const resolved=await fetchJsonBounded(
            '/api/market-snapshot?ticker='+encodeURIComponent(String(candidate.ticker).trim().toUpperCase())+'&interval=1h&multi=1&ts='+Date.now(),
            {cache:'no-store',headers:{'Cache-Control':'no-cache'}},
            12000,
            'Resolved market snapshot request'
          );
          marketSnapshot=resolved?.snapshot||null;
          directMarket=resolved?.report||null;
          if(!directMarket)searchWarning=searchWarning||resolved?.error||'The search-resolved instrument quote is unavailable; market-dependent scenarios will be blocked.';
        }catch(e){
          directMarket=null;
          searchWarning=searchWarning||String(e?.message||'Resolved instrument quote unavailable');
        }
      }
      if(directMarket&&!candidate&&directMarket.ticker){
        candidate={
          ticker:directMarket.ticker,
          name:directMarket.name,
          confidence:82,
          score:82,
          evidenceMentions:0,
          positive:0,
          negative:0,
          method:'Verified market symbol',
          reason:'A market report matched the requested symbol.',
          disclaimer:'Market-data match; not a guaranteed trade.'
        };
      }

      if(candidate?.ticker&&!directMarket){
        stage('Verifying the resolved ticker and building the shared market snapshot…');
        try{
          const resolved=await fetchJsonBounded(
            '/api/market-snapshot?ticker='+encodeURIComponent(String(candidate.ticker).trim().toUpperCase())+'&interval=1h&multi=1&ts='+Date.now(),
            {cache:'no-store',headers:{'Cache-Control':'no-cache'}},
            12000,
            'Candidate market snapshot request'
          );
          marketSnapshot=resolved?.snapshot||marketSnapshot;
          directMarket=resolved?.report||null;
          if(!directMarket)searchWarning=searchWarning||resolved?.error||'Market data unavailable for the resolved candidate.';
        }catch(e){searchWarning=searchWarning||String(e?.message||'Market snapshot unavailable');}
      }
      marketSnapshot=marketSnapshot||null;
      if(directMarket&&marketSnapshot&&!marketSnapshot?.quality?.forecastEligible){
        directMarket={...directMarket,live:false};
        searchWarning=searchWarning||'Market data status '+String(marketSnapshot?.quality?.status||'UNAVAILABLE')+'; forecasts are blocked until the quote is verified.';
      }
      window.__fpMarketSnapshot=marketSnapshot?Object.freeze({...marketSnapshot}):null;
      state.marketSnapshot=window.__fpMarketSnapshot;
      stage('3/6 · Running specialist agents and the Round Table…');
      const agentFleet=window.FinPilotDeepLearning?.runFleet(state,{web,candidate,marketSnapshot:window.__fpMarketSnapshot})||null;
      // Decision Core's fourth argument is a money-formatting function, not a scenario object.
      // Passing scenarioSafe(...) here shadows the formatter and causes "money is not a function".
      const formatMoney=typeof window.FinPilotBridge?.money==='function'
        ? window.FinPilotBridge.money
        : (value)=>'₹'+(Number(value)||0).toLocaleString('en-IN',{maximumFractionDigits:0});
      const core=FinPilotDecisionCore.computeExecutiveDecision(state,cycle.findings,web,formatMoney,sourceAge);
      const decision={
        decision:core.decision,
        summary:core.summary,
        risk:core.risk,
        confidence:core.confidence,
        findings:cycle.findings.map(f=>f.domain),
        voices:core.voices,
        evidenceIds:state.evidence.map(e=>e.id),
        evidenceFreshness:core.evidenceFreshness,
        webSignal:core.webSignal,
        executive:core.executive,
        candidate,
        marketSnapshotId:marketSnapshot?.snapshotId||null,
        marketDataStatus:marketSnapshot?.quality?.status||'UNAVAILABLE',
        marketForecastEligible:marketSnapshot?.quality?.forecastEligible===true,
        agentFleet,
        time:new Date().toISOString()
      };

      state.decision=decision;
      state.decisionHistory.unshift(decision);
      state.decisionHistory=state.decisionHistory.slice(0,50);
      const paper=buildPaperCouncil(query,web);
      if(window.FinPilotDeepLearning?.learnFromDecision){
        window.FinPilotDeepLearning.learnFromDecision(state,{...decision,candidate});
      }
      state.memory.push({title:'One-click full stock analysis',text:query+': '+decision.decision,time:new Date().toLocaleTimeString()});
      save();

      stage('4/6 · Validating the shared snapshot and loading the chart…');
      let marketReport=directMarket;
      if(marketReport&&marketSnapshot&&!marketSnapshot.quality?.forecastEligible)marketReport={...marketReport,live:false};
      const reportTicker=String(marketReport?.ticker||marketReport?.symbol||'').trim().toUpperCase();
      const candidateTicker=String(candidate?.ticker||'').trim().toUpperCase();
      if(marketReport&&candidateTicker&&reportTicker&&reportTicker!==candidateTicker){
        searchWarning=searchWarning||'Market report symbol mismatch; quantitative plan blocked.';
        marketReport={...marketReport,live:false};
      }
      const finalMoney=scenarioSafe({...decision,marketReport});
      decision.marketReport=marketReport;
      decision.marketSnapshotId=marketSnapshot?.snapshotId||null;
      decision.chartAnalysis=buildChartAnalysis(marketReport,finalMoney,candidate);
      const forecastRecord=createForecastLedgerRecord({snapshot:marketSnapshot,candidate,decision,money:finalMoney,chartAnalysis:decision.chartAnalysis});
      decision.forecastRecordId=forecastRecord.forecastId;
      state.forecastLedger=Array.isArray(state.forecastLedger)?state.forecastLedger:[];
      state.forecastLedger.unshift(forecastRecord);
      state.forecastLedger=state.forecastLedger.slice(0,200);
      state.lastForecastRecordId=forecastRecord.forecastId;
      state.marketSnapshot=marketSnapshot||null;
      save();

      stage('5/6 · Reconciling CEO, CFO, Judge and risk gates…');
      const report={...decision,agentCount:cycle.enabled.length,paper};
      renderOneClickPanel(query,report);
      if(marketReport){
        publishEquitySnapshot(marketReport);
        setTimeout(mountTradingViewFallbacks,60);
      }

      stage('6/6 · Complete. Review source freshness and risk gates before acting.');
      updateAnalysisStatus(
        (searchWarning?'Completed with a provider warning: '+searchWarning:'All available stages finished.')+' Query: '+query,
        'complete'
      );
      window.__fpLastRenderedQuery=query;
      toast((searchWarning?'Completed with warning · ':'')+'analysis complete · verify data freshness');
      return {ok:true,query,candidate:candidate?.ticker||null,marketData:Boolean(marketReport),warning:searchWarning||null};
    }catch(e){
      const message=String(e?.message||'Unknown analysis error');
      updateAnalysisStatus(message,'error');
      const boxNow=document.getElementById('searchResults');
      if(boxNow){
        const old=boxNow.querySelector('#oneClickFailure');
        if(old)old.remove();
        boxNow.insertAdjacentHTML('afterbegin','<div id="oneClickFailure" class="notice highNotice" role="alert"><b>Analysis stopped safely</b><br>'+escLocal(message)+'<br><span class="muted">No real order was placed. Retry after verifying data/provider status.</span></div>');
      }
      toast('Analysis stopped · '+message);
      return {ok:false,error:message};
    }finally{
      if(runId===activeRunId){
        running=false;
        window.__fpAnalysisRunning=false;
      }
    }
  }

  function mountSearchActions(){
    const searchForm=document.querySelector('.search');
    if(searchForm&&!document.getElementById('oneClickTop')){
      const b=document.createElement('button');
      b.id='oneClickTop';b.className='btn primary';b.type='button';b.textContent='⚡ Analyze';
      b.title='Run the complete FinPilot decision stack for the current search';
      b.onclick=()=>window.finpilotLaunch?.(document.getElementById('globalSearch')?.value||document.getElementById('searchQuery')?.value||'');
      searchForm.appendChild(b);
    }
  }

  function installProductionDiagnostics(){
    if(window.__finpilotDiagnosticsInstalled)return;
    window.__finpilotDiagnosticsInstalled=true;
    const showErr=(title,detail)=>{
      let el=document.getElementById('fpBootGuard');
      if(!el){
        el=document.createElement('div');el.id='fpBootGuard';
        el.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#fff;border:1px solid #e4e8ef;border-radius:12px;padding:12px;box-shadow:0 16px 50px rgba(15,23,42,.18);font:13px system-ui;color:#172033';
        document.body.appendChild(el);
      }
      el.style.display='block';
      el.innerHTML='<b style="color:#c23d4f">'+escLocal(title)+'</b><div style="margin-top:5px;color:#6b7688">'+escLocal(detail)+'</div>';
    };
    window.addEventListener('error',e=>showErr('FinPilot frontend error',e.message||'Script failure'));
    window.addEventListener('unhandledrejection',e=>showErr('FinPilot async error',e.reason?.message||String(e.reason||'Unhandled rejection')));
    fetch('/api/health',{cache:'no-store'}).then(async r=>{
      const d=await r.json();
      const s=document.getElementById('engineStatus'),detail=document.getElementById('engineDetail');
      if(s){s.textContent=d.ok?'ONLINE':'OFFLINE';s.style.color=d.ok?'#138a5b':'#c23d4f'}
      if(detail)detail.textContent=d.ok?'Gateway connected · '+new Date().toLocaleTimeString():'Gateway unavailable · local engine only';
    }).catch(e=>{
      const s=document.getElementById('engineStatus'),detail=document.getElementById('engineDetail');
      if(s){s.textContent='OFFLINE';s.style.color='#c23d4f'}
      if(detail)detail.textContent='Gateway unavailable · '+e.message;
    });
  }

  function install(){
    if(!rawDoSearch&&typeof window.doSearch==='function')rawDoSearch=window.doSearch;
    mountSearchActions();
  }
  window.runFullStockAnalysis=runFullStockAnalysis;
  window.startOneClickAnalysis=runFullStockAnalysis;
  window.addEventListener('load',()=>{install();installProductionDiagnostics();});
  setTimeout(()=>{install();installProductionDiagnostics();},0);
  setTimeout(install,100);
  const fpInstallTimer=setInterval(()=>{
    try{
      install();
      installProductionDiagnostics();
      if(rawDoSearch)clearInterval(fpInstallTimer);
    }catch(e){}
  },500);

  injectMarketChartStyles();
})();
