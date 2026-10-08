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
    try{
      const p=syncPaperAgents();
      const stance=web?.stance||'Mixed';
      const market={
        symbol:String(query||'STOCK').trim().toUpperCase().slice(0,24),
        price:100,
        momentum:stance==='Positive'?25:stance==='Cautious'?-25:0,
        quality:50,
        valuation:50,
        risk:stance==='Cautious'?72:50,
        evidence:Math.min(90,60+(web?.count||0)*4)
      };
      const round=FinPilotPaperCore.roundTable(state,market);
      p.lastMarket=market;p.lastRound=round;
      return round;
    }catch(e){return null}
  }

  function scenarioSafe(report){
    try{const engine=window.FinpilotMoneyEngine;if(engine&&typeof engine.analyze==='function'){const x=engine.analyze(report,1000,30);if(x&&Number.isFinite(Number(x.buyProbability))&&x.plan)return x;}}catch(e){}
    const d=report||{},risk=Math.max(0,Math.min(100,Number(d.risk??50))),conf=Math.max(0,Math.min(100,Number(d.confidence??50)));
    const buy=Math.max(5,Math.min(85,50+(conf-risk)*.22)),sell=Math.max(5,Math.min(85,30+(risk-conf)*.18)),hold=Math.max(5,100-buy-sell),total=buy+sell+hold,b=buy/total*100,s=sell/total*100,h=hold/total*100;
    const up=Math.max(2,Math.min(18,3.5+conf*.06)),down=Math.max(2,Math.min(18,2.5+risk*.08)),reward=1000*up/100,loss=1000*down/100;
    return {version:'fallback',upgradeCount:50,amount:1000,horizon:30,action:b>=s+8&&up/down>=1.25?'BUY BIAS':s>=b+8?'SELL / AVOID':'HOLD / WAIT',riskBand:risk>=70?'HIGH':risk>=45?'MEDIUM':'LOW',approved:false,buyProbability:Number(b.toFixed(2)),sellProbability:Number(s.toFixed(2)),holdProbability:Number(h.toFixed(2)),upsidePct:Number(up.toFixed(2)),downsidePct:Number(down.toFixed(2)),estimatedProfit:Number(reward.toFixed(2)),estimatedLoss:Number(loss.toFixed(2)),riskReward:Number((up/down).toFixed(2)),expectedValue:Number(((b/100)*reward-(s/100)*loss).toFixed(2)),inputs:{risk,confidence:conf,ceo:conf,cfo:conf,judge:conf,evidence:50,market:50},plan:{requestedAmount:1000,recommendedAmount:0,approval:'BLOCKED',riskBudget:Math.round(1000*Math.max(0,Math.min(4.5,1.5+(100-risk)*.035))/100),capitalAtRisk:0,targetPct:Number(up.toFixed(2)),stopPct:-Number(down.toFixed(2)),trailingStopPct:Number((down*.65).toFixed(2)),targetProfit:0,stopLoss:0,maximumLoss:0,breakEvenPct:.25,breakEvenCost:2.5,riskReward:Number((up/down).toFixed(2)),expectedValue:0,stress7:Number((down*1.35).toFixed(2)),stress30:Number((down*1.75).toFixed(2)),stress90:Number((down*2.25).toFixed(2)),positionCap:0,gateReasons:['Scenario engine fallback'],actionReason:'Primary scenario engine was unavailable; no capital allocation is approved.'},probabilityBasis:'Fallback safety calculation because the primary scenario engine was unavailable.',disclaimer:'Fallback scenario only. No trade is approved.'};
  }

  function buildChartAnalysis(market,money,candidate){
    if(!market)return {available:false,message:'Live price-series data was not returned for this candidate.'};
    const candles=Array.isArray(market.candles)?market.candles.filter(x=>Number.isFinite(Number(x.close))).slice(-80):[];
    const s20=Number(market.sma20),s50=Number(market.sma50);
    const resistance=Number(market.recentHigh||market.resistance),support=Number(market.recentLow||market.support);
    const target=Number(money?.upsidePct)>0&&Number(market.price)>0?Number(market.price)*(1+Number(money.upsidePct)/100):resistance;
    const stop=Number(money?.downsidePct)>0&&Number(market.price)>0?Number(market.price)*(1-Number(money.downsidePct)/100):support;
    const trend=Number(market.price)>=s20&&Number(market.price)>=s50?'BULLISH TREND':'DEFENSIVE / MIXED';
    return {available:candles.length>1,candles,price:Number(market.price),sma20:s20,sma50:s50,support,resistance,target,stop,rsi:Number(market.rsi),trend,ticker:market.ticker||candidate?.ticker,name:market.name||candidate?.name,provider:market.provider,asOf:market.asOf};
  }
  function chartSvg(a){
    if(!a?.available)return '<div class="notice">Chart unavailable because the live price series was not returned. FinPilot will not invent candles.</div>';
    const rows=a.candles,w=760,h=260,pad=28,vals=rows.flatMap(x=>[x.low,x.high]).concat([a.sma20,a.sma50,a.support,a.resistance]).filter(Number.isFinite);
    let lo=Math.min(...vals),hi=Math.max(...vals);if(!(hi>lo)){lo-=1;hi+=1;}
    const x=i=>pad+(w-2*pad)*(i/Math.max(1,rows.length-1)),y=v=>h-pad-(h-2*pad)*((v-lo)/(hi-lo));
    const path=rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(r.close).toFixed(1)).join(' ');
    const line=(v,dash)=>Number.isFinite(v)?'<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'" stroke="'+(dash?'#94a3b8':'#cbd5e1')+'" stroke-width="1" stroke-dasharray="'+(dash?'5 4':'2 3')+'"/><text x="'+(w-pad-2)+'" y="'+(y(v)-4).toFixed(1)+'" text-anchor="end" fill="#64748b" font-size="11">'+escLocal(Number(v).toFixed(2))+'</text>':'';
    return '<div style="overflow:auto"><svg viewBox="0 0 '+w+' '+h+'" style="width:100%;min-width:620px;height:260px;background:#f8fafc;border-radius:10px" aria-label="Live technical price chart">'+line(a.support,true)+line(a.resistance,true)+'<path d="'+path+'" fill="none" stroke="#315efb" stroke-width="3"/>'+line(a.sma20,false)+line(a.sma50,false)+'</svg></div>';
  }
  function renderOneClickPanel(q,report){
    const box=document.getElementById('searchResults');
    if(!box)return;
    const e=report.executive||{};
    const web=report.webSignal||{};
    const paper=report.paper;
    const money=scenarioSafe(report);
    const candidate=report.candidate||null;
    const v8=window.FinPilotV8?.analyze(report,money,{amount:1000})||null;
    const risk=Number(report.risk||0);
    const riskClass=risk>=70?'high':risk>=45?'med':'low';
    const paperLabel=paper?paper.final:'NOT RUN';
    const html=`
      <div id="oneClickResult" class="card" style="margin-bottom:14px;border:2px solid #315efb;background:linear-gradient(180deg,#f8faff,#fff)">
        <div class="sectionTitle">
          <div><span class="eyebrow">FinPilot One-Click Intelligence</span><h3 style="font-size:18px;margin-top:5px">Full decision stack · ${escLocal(q)}</h3></div>
          <span class="pill low">COMPLETE</span>
        </div>
        <div class="card" style="margin-bottom:12px;border:1px solid #315efb;background:#eef5ff">
          <div class="sectionTitle"><div><span class="eyebrow">AI MARKET CANDIDATE</span><h3 style="font-size:20px;margin-top:5px">${candidate?escLocal(candidate.name):'No stock identified yet'}</h3><span class="muted">${candidate?escLocal(candidate.ticker)+' · '+escLocal(candidate.method):'Search results did not contain a resolvable stock symbol.'}</span></div><span class="pill ${candidate&&candidate.confidence>=70?'low':'med'}">${candidate?candidate.confidence+'% CONFIDENCE':'CHECK'}</span></div>
          ${candidate?`<div class="grid three"><div class="card"><span class="muted">Candidate score</span><div class="metric">${candidate.score}/100</div></div><div class="card"><span class="muted">Evidence mentions</span><div class="metric">${candidate.evidenceMentions||0}</div></div><div class="card"><span class="muted">Signal balance</span><div class="metric">+${candidate.positive||0} / −${candidate.negative||0}</div></div></div><div class="notice" style="margin-top:10px"><b>Why selected:</b> ${escLocal(candidate.reason||'Highest evidence-weighted candidate found in the current search results.')}<br><span class="muted">${escLocal(candidate.disclaimer||'Evidence-ranked candidate; not a guaranteed trade.')}</span></div>`:'<div class="notice">Try a query containing a stock symbol or a broad request such as “pick best stock for today trading”. FinPilot will rank identifiable candidates instead of returning an unnamed CHECK result.</div>'}
        </div>
        <div class="card" style="margin-bottom:12px;border:1px solid #cbd7ee;background:#fff">
          <div class="sectionTitle"><div><span class="eyebrow">LIVE TECHNICAL CHART</span><h3 style="font-size:18px;margin-top:5px">${escLocal(report.chartAnalysis?.name||report.candidate?.name||q)} · ${escLocal(report.chartAnalysis?.ticker||report.candidate?.ticker||'')}</h3></div><span class="pill ${report.chartAnalysis?.available?'low':'med'}">${report.chartAnalysis?.available?'LIVE SERIES':'NO SERIES'}</span></div>
          ${chartSvg(report.chartAnalysis)}
          <div class="grid cards" style="margin-top:10px">
            <div class="card"><span class="muted">Live price</span><div class="metric">₹${Number(report.chartAnalysis?.price||0).toLocaleString('en-IN',{maximumFractionDigits:2})}</div></div>
            <div class="card"><span class="muted">RSI</span><div class="metric">${Number(report.chartAnalysis?.rsi||0).toFixed(1)}</div></div>
            <div class="card"><span class="muted">SMA20 / SMA50</span><div class="metric" style="font-size:16px">₹${Number(report.chartAnalysis?.sma20||0).toFixed(2)} / ₹${Number(report.chartAnalysis?.sma50||0).toFixed(2)}</div></div>
            <div class="card"><span class="muted">Support / Resistance</span><div class="metric" style="font-size:16px">₹${Number(report.chartAnalysis?.support||0).toFixed(2)} / ₹${Number(report.chartAnalysis?.resistance||0).toFixed(2)}</div></div>
          </div>
          <div class="notice" style="margin-top:10px"><b>Chart read:</b> ${escLocal(report.chartAnalysis?.trend||'CHECK')} · Target scenario ₹${Number(report.chartAnalysis?.target||0).toFixed(2)} · Stop scenario ₹${Number(report.chartAnalysis?.stop||0).toFixed(2)}. <span class="muted">Source: ${escLocal(report.chartAnalysis?.provider||'live market adapter')} · ${escLocal(report.chartAnalysis?.asOf||'')}</span></div>
        </div>
        <div class="grid cards" style="margin-bottom:12px">
          <div class="card"><span class="muted">Web evidence</span><div class="metric">${web.count||0}</div><span class="muted">${escLocal(web.provider||'web')} · ${escLocal(web.stance||'Mixed')}</span></div>
          <div class="card"><span class="muted">Decision risk</span><div class="metric ${riskClass==='high'?'red':riskClass==='med'?'yellow':'green'}">${risk}</div><span class="muted">${escLocal(report.evidenceFreshness||'CHECK')}</span></div>
          <div class="card"><span class="muted">Agent fleet</span><div class="metric">${report.agentCount}</div><span class="muted">specialists completed</span></div>
          <div class="card"><span class="muted">Paper council</span><div class="metric" style="font-size:18px">${escLocal(paperLabel)}</div><span class="muted">virtual only</span></div>
        </div>
        <div class="grid three">
          <div class="decision"><span class="pill low">CEO · OPPORTUNITY</span><p>${escLocal(e.ceo||'No CEO view')}</p><b>${e.ceoConfidence||0}% confidence</b></div>
          <div class="decision"><span class="pill med">CFO · SAFETY</span><p>${escLocal(e.cfo||'No CFO view')}</p><b>${e.cfoConfidence||0}% confidence</b></div>
          <div class="decision"><span class="pill">⚖ JUDGE · FINAL</span><h2>${escLocal(e.judge||report.decision||'VERIFY')}</h2><b>${report.confidence||0}% confidence</b></div>
        </div>
<div class="card" style="margin-top:12px;border:1px solid #d8e0ef;background:#fbfcff">
          <div class="sectionTitle"><div><span class="eyebrow">₹1,000 REAL-MONEY SCENARIO</span><h3 style="font-size:18px;margin-top:5px">Current AI evaluation translated into money</h3></div><span class="pill ${money?.riskBand==='HIGH'?'high':money?.riskBand==='MEDIUM'?'med':'low'}">${money?.riskBand||'CHECK'}</span></div>
          <div class="grid cards" style="margin-bottom:10px">
            <div class="card"><span class="muted">AI action</span><div class="metric" style="font-size:19px">${escLocal(money?.action||'CHECK')}</div><span class="muted">${money?.horizon||30}-day scenario</span></div>
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
          <div class="sectionTitle"><div><span class="eyebrow">FINPILOT v8 · 50 UPGRADES</span><h3 style="font-size:18px;margin-top:5px">Risk-controlled execution intelligence</h3></div><span class="pill ${v8?.gate?.includes('BLOCK')?'high':'low'}">${escLocal(v8?.gate||'CHECK')}</span></div>
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
          <div class="sectionTitle"><div><span class="eyebrow">₹1,000 TOP-TIER RISK PLAN</span><h3 style="font-size:18px;margin-top:5px">Capital plan · target · stop · loss budget</h3></div><span class="pill ${money.plan?.approval==='CONDITIONAL'?'low':'high'}">${escLocal(money.plan?.approval||'BLOCKED')}</span></div>
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
        <div class="notice" style="margin-top:12px"><b>All-in-one pipeline:</b> Internet evidence → Financial Brain → ${report.agentCount} agents → 7-voice Round Table → CEO → CFO → Judge → Action Center → isolated paper council. No real order was placed.</div>
      </div>`;
    const old=document.getElementById('oneClickResult');
    if(old)old.remove();
    box.insertAdjacentHTML('afterbegin',html);
  }

  function ensureRawSearch(){
    if(typeof rawDoSearch==='function')return rawDoSearch;
    if(typeof window.doSearch==='function'){
      rawDoSearch=window.doSearch;
      return rawDoSearch;
    }
    throw new Error('Search engine is still loading. Please try again in a moment.');
  }

  async function runFullStockAnalysis(query){
    query=String(query||'').trim();
    if(!query||running)return;
    running=true;
    try{if(typeof window.show==='function')window.show('search')}catch{}
    const box=document.getElementById('searchResults');
    if(box)box.insertAdjacentHTML('afterbegin','<div id="oneClickProgress" class="notice" style="margin-bottom:14px"><b>Running full analysis…</b> Search → evidence → agents → CEO/CFO/Judge → paper council</div>');
    try{
      const search=ensureRawSearch();
      let searchWarning='';
      try{ await search(query); }catch(e){ searchWarning=String(e?.message||'Live web search unavailable'); window.__lastSearch={results:[],provider:null,live:false}; }
      const cycle=buildAgentCycle();
      const web=liveWebSignal();
      let candidate=window.FinPilotDeepLearning?.resolveCandidate(query,window.__lastSearch,web)||null;
      const broadRequest=/\b(BEST|TOP|PICK|STOCK|TRADE|TRADING|TODAY|BUY|SELL)\b/i.test(query);
      if(!candidate&&broadRequest){
        try{
          const rp=await fetch('/api/market-picks?limit=5',{cache:'no-store'});
          const picks=await rp.json();
          const top=picks?.candidates?.[0];
          if(top) candidate={ticker:top.ticker,name:top.name,confidence:Math.round(Math.min(92,58+Number(top.score||0)*.34)),score:top.score,evidenceMentions:0,positive:Number(top.changePct||0)>0?1:0,negative:Number(top.changePct||0)<0?1:0,method:'Live NSE market scan',reason:`Highest live scan score: ${top.score}/100; ${Number(top.changePct||0).toFixed(2)}% session move, RSI ${Number(top.rsi||0).toFixed(1)}, relative volume ${top.volumeRatio?Number(top.volumeRatio).toFixed(2)+'x':'n/a'}.`,disclaimer:picks.disclaimer||'Live market scan candidate; verify current broker/exchange data.'};
        }catch(e){searchWarning=searchWarning||String(e?.message||'Market scan unavailable');}
      }
      const learnedFleet=window.FinPilotDeepLearning?.runFleet(state,{web,candidate})||null;
      const core=FinPilotDecisionCore.computeExecutiveDecision(state,cycle.findings,web,money,sourceAge);
      const decision={
        decision:core.decision,summary:core.summary,risk:core.risk,confidence:core.confidence,
        findings:cycle.findings.map(f=>f.domain),voices:core.voices,
        evidenceIds:state.evidence.map(e=>e.id),evidenceFreshness:core.evidenceFreshness,
        webSignal:core.webSignal,executive:core.executive,candidate,time:new Date().toISOString()
      };
      state.decision=decision;
      state.decisionHistory.unshift(decision);
      state.decisionHistory=state.decisionHistory.slice(0,50);
      const paper=buildPaperCouncil(query,web);
      if(window.FinPilotDeepLearning?.learnFromDecision)window.FinPilotDeepLearning.learnFromDecision(state,{...decision,candidate});
      state.memory.push({title:'One-click full stock analysis',text:`${query}: ${decision.decision}`,time:new Date().toLocaleTimeString()});
      save();
      let marketReport=null;
      try{
        const symbol=String(candidate?.ticker||query||'').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'');
        if(symbol){
          const mr=await fetch('/api/stock-report?ticker='+encodeURIComponent(symbol)+'&interval=1h&multi=1',{cache:'no-store'});
          const md=await mr.json();
          if(md?.ok&&md?.report)marketReport=md.report;
        }
      }catch(e){searchWarning=searchWarning||'Chart data unavailable';}
      decision.marketReport=marketReport;
      decision.chartAnalysis=buildChartAnalysis(marketReport,money,candidate);
      const report={...decision,agentCount:cycle.enabled.length,paper};
      renderOneClickPanel(query,report);
      const progress=document.getElementById('oneClickProgress');if(progress)progress.remove();
      toast((searchWarning?'Market scan used · ':'')+'1-click full analysis complete · all decision layers updated');
    }catch(e){
      const progress=document.getElementById('oneClickProgress');
      if(progress)progress.innerHTML='<b>Analysis stopped.</b> '+escLocal(e?.message||'Unknown error');
      toast('Full analysis failed');
    }finally{running=false}
  }

  function mountSearchActions(){
    const searchForm=document.querySelector('.search');
    if(searchForm&&!document.getElementById('oneClickTop')){
      const b=document.createElement('button');
      b.id='oneClickTop';b.className='btn primary';b.type='button';b.textContent='⚡ Run All';
      b.title='Run the complete FinPilot decision stack for the current search';
      b.onclick=()=>runFullStockAnalysis(document.getElementById('globalSearch')?.value||document.getElementById('searchQuery')?.value||'');
      searchForm.appendChild(b);
    }
  }

  function mountSearchCard(q){
    const box=document.getElementById('searchResults');
    if(!box||document.getElementById('oneClickLauncher'))return;
    const d=document.createElement('div');
    d.id='oneClickLauncher';d.className='decision';
    d.style.marginBottom='14px';
    d.innerHTML='<div class="sectionTitle"><div><span class="eyebrow">Decision automation</span><h3>Run the entire analysis in one click</h3></div><span class="pill low">SEARCH READY</span></div><p class="muted">Uses the live search evidence you just fetched, refreshes the Financial Brain, runs the full agent fleet, reconciles CEO + CFO + Judge, updates Action Center, and runs the isolated paper council.</p><div class="action"><button class="btn primary" type="button">⚡ 1-Click Full Analysis</button><button class="btn" type="button">Open Evidence Ledger</button></div>';
    d.querySelector('.btn.primary').onclick=()=>runFullStockAnalysis(q);
    d.querySelectorAll('.btn')[1].onclick=()=>show('evidence');
    box.prepend(d);
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
    if(!rawDoSearch && typeof window.doSearch==='function'){
      rawDoSearch=window.doSearch;
      window.doSearch=async function(q){
        await rawDoSearch(q);
        mountSearchCard(q);
      };
    }
    mountSearchActions();
  }
  window.runFullStockAnalysis=runFullStockAnalysis;
  window.addEventListener('load',()=>{install();installProductionDiagnostics();});
  setTimeout(()=>{install();installProductionDiagnostics();},0);
  setTimeout(install,100);
  const fpInstallTimer=setInterval(()=>{
    try{
      install();
      installProductionDiagnostics();
      const q=document.getElementById('searchQuery')?.value||document.getElementById('globalSearch')?.value||'';
      const box=document.getElementById('searchResults');
      if(q&&box&&!document.getElementById('oneClickLauncher'))mountSearchCard(q);
      if(rawDoSearch)clearInterval(fpInstallTimer);
    }catch(e){}
  },500);
})();
