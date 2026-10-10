/* FinPilot Paper Arena PRO — professional order dashboard overlay. Paper trading only. */
(function(){
  function esc(v){return window.FinPilotBridge?.esc?window.FinPilotBridge.esc(v):String(v??'').replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
  function money(v){return window.FinPilotBridge?.money?window.FinPilotBridge.money(v):Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
  function paperProSide(side){
    window.__paperProSide=String(side).toUpperCase()==='SELL'?'SELL':'BUY';
    document.querySelectorAll('.fpSide').forEach(function(b){b.classList.toggle('active',b.dataset.side===window.__paperProSide)});
    paperProPreview();
  }
  function paperProSyncType(){
    var t=String(document.getElementById('paperOrderType')?.value||'MARKET').toUpperCase();
    var limit=document.getElementById('paperLimitPrice'),stop=document.getElementById('paperStop'),trail=document.getElementById('paperTrail'),help=document.getElementById('paperTypeHelp');
    if(limit)limit.disabled=!['LIMIT','STOP_LIMIT'].includes(t);
    if(stop)stop.disabled=!['STOP','STOP_LIMIT'].includes(t);
    if(trail)trail.disabled=t!=='TRAILING_STOP';
    if(help)help.textContent=t==='MARKET'?'Immediate fill at the latest verified paper quote.':t==='LIMIT'?'Wait for a market price at or better than the limit.':t==='STOP'?'Trigger a market-style paper order at the stop.':t==='STOP_LIMIT'?'Trigger first, then enforce the limit price.':'Follow price and trigger after the trailing distance is breached.';
    paperProPreview();
  }
  function paperProPreview(){
    var p=syncPaperAgents(),agent=p.agents.find(function(a){return a.id===document.getElementById('paperAgent')?.value})||p.agents[0],sym=(document.getElementById('paperSymbol')?.value||'BTC').trim().toUpperCase(),rawQty=Number(document.getElementById('paperQty')?.value||0),qty=FinPilotPaperCore.normalizeQty(sym,rawQty),t=String(document.getElementById('paperOrderType')?.value||'MARKET').toUpperCase(),m=p.lastMarket&&p.lastMarket.symbol===sym?p.lastMarket:null,px=Number(m?.price||document.getElementById('paperPrice')?.value||0),notional=qty*px,fee=notional*(Number(p.account?.commissionBps||8)/10000),slip=notional*(Number(p.account?.slippageBps||3)/10000),host=document.getElementById('paperOrderPreview');
    if(document.getElementById('paperQty')&&Math.abs(rawQty-qty)>1e-9)document.getElementById('paperQty').value=qty||'';
    if(!host)return;
    var after=Math.max(0,Number(agent?.cash||0)-(window.__paperProSide==='BUY'?notional+fee:fee));
    host.innerHTML='<div><span>NOTIONAL</span><b>'+money(notional)+'</b></div><div><span>EST. FEE</span><b>'+money(fee)+'</b></div><div><span>EST. SLIPPAGE</span><b>'+money(slip)+'</b></div><div><span>POST-TRADE CASH</span><b>'+money(after)+'</b></div><small>'+window.__paperProSide+' · '+t+' · '+esc(sym)+(px?' · reference '+money(px):' · waiting for verified quote')+'</small>';
    paperProRiskGate();
  }
  function paperProRiskGate(){
    var p=syncPaperAgents(),sym=(document.getElementById('paperSymbol')?.value||'BTC').trim().toUpperCase(),agentId=document.getElementById('paperAgent')?.value||p.agents[0]?.id,qty=Number(document.getElementById('paperQty')?.value||0),t=String(document.getElementById('paperOrderType')?.value||'MARKET').toUpperCase(),m=p.lastMarket&&p.lastMarket.symbol===sym?p.lastMarket:null,limit=Number(document.getElementById('paperLimitPrice')?.value||0),stop=Number(document.getElementById('paperStop')?.value||document.getElementById('paperBracketStop')?.value||0),target=Number(document.getElementById('paperBracketTarget')?.value||0),entry=(t==='LIMIT'||t==='STOP_LIMIT')?limit:Number(m?.price||0),host=document.getElementById('paperRiskTower');
    if(!host||!FinPilotPaperCore.preTradeCheck)return;
    var meta=paperProMarketMeta(m);
    var gate=FinPilotPaperCore.preTradeCheck(state,{agentId:agentId,symbol:sym,side:window.__paperProSide||'BUY',qty:qty,entryPrice:entry,stopPrice:stop,targetPrice:target,marketMeta:meta});
    var tone=gate.status==='PASS'?'good':gate.status==='WARN'?'warn':'bad';
    var reasons=gate.reasons.concat(gate.warnings).slice(0,3),mm=gate.metrics||{};
    host.innerHTML='<div class="fpTowerHead"><div><span class="eyebrow">EXECUTION CONTROL TOWER</span><strong class="'+tone+'">'+gate.status+'</strong></div><span class="fpTowerConfidence">DATA CONFIDENCE '+(mm.dataConfidence??0)+'%</span></div><div class="fpTowerGrid"><div><span>QUOTE AGE</span><b>'+Number(mm.quoteAgeSec||0).toFixed(1)+'s</b></div><div><span>SPREAD</span><b>'+(mm.spreadBps==null?'—':Number(mm.spreadBps).toFixed(1)+' bps')+'</b></div><div><span>SLIPPAGE</span><b>'+Number(mm.estimatedSlippage||0).toFixed(2)+'</b></div><div><span>NOTIONAL</span><b>'+money(mm.notional||0)+'</b></div><div><span>POST EXPOSURE</span><b>'+Number(mm.postTradeExposurePct||0).toFixed(1)+'%</b></div><div><span>FILLABILITY</span><b>'+esc(mm.fillability||'BLOCKED')+'</b></div><div><span>RISK / UNIT</span><b>'+money(mm.riskPerUnit||0)+'</b></div><div><span>R:R</span><b>'+(mm.riskReward==null?'—':Number(mm.riskReward).toFixed(2)+':1')+'</b></div></div>'+(reasons.length?'<div class="fpTowerReasons">'+reasons.map(function(x){return '<span>• '+esc(x)+'</span>'}).join('')+'</div>':'<div class="fpTowerReasons"><span>• Execution checks passed; order is eligible for paper routing.</span></div>')+'<small class="fpTowerNote">Risk gate is enforced by the paper engine. Market execution remains virtual only.</small>';
    return gate;
  }
  function paperProMarketMeta(m){
 var v=m?.verification||{};
 var sourceAsOf=m?.sourceAsOf||m?.asOf||m?.tick?.sourceAsOf||m?.tick?.asOf;
 var ageMs=sourceAsOf?Date.now()-Date.parse(sourceAsOf):NaN;
 var verified=Boolean(m?.verified===true&&m?.executionEligible===true&&m?.live===true
   &&m?.sourceTimestampType==='PROVIDER_TIMESTAMP'&&Number.isFinite(ageMs)&&ageMs>=-5000&&ageMs<=30000
   &&v.status==='VERIFIED'&&v.available===true&&v.priceAgreement===true&&v.primaryProviderTimestampValid===true
   &&Number(m?.price)>0);
 return {verified,available:verified,executionEligible:verified,sourceTimestampType:m?.sourceTimestampType||'UNKNOWN_TIMESTAMP',
   provider:m?.provider||'',providerCount:Number(v.providerCount||m?.providerCount||0),sourceAsOf:sourceAsOf||undefined,
   asOf:sourceAsOf||undefined,receivedAt:m?.receivedAt||m?.tick?.receivedAt,bid:Number(m?.orderBook?.bid||0)||undefined,
   ask:Number(m?.orderBook?.ask||0)||undefined};
}
async function paperProMarket(){
    var sym=(document.getElementById('paperSymbol')?.value||'BTC').trim().toUpperCase();
    var m=null;
    try{m=await loadPaperMarket();}catch(e){m=null}
    if(m&&m.price){
      var p=syncPaperAgents();
      p.lastMarket=m;
      p.marketSnapshot[sym]=m.price;
      FinPilotPaperCore.markToMarket(state,p.marketSnapshot);
      if(document.getElementById('paperPrice'))document.getElementById('paperPrice').value=m.price;
      if(document.getElementById('paperLimitPrice')&&String(document.getElementById('paperOrderType')?.value||'MARKET').toUpperCase()==='MARKET')document.getElementById('paperLimitPrice').value=m.price;
      var last=document.getElementById('paperQuoteLast');if(last)last.textContent=money(m.price);
      var exec=document.getElementById('paperExecutionStatus');if(exec){exec.className='fpExec good';exec.textContent='Market verified · order entry enabled'}
      paperProPreview();
    }
    return m;
  }
  async function paperProSubmit(side){
    var p=syncPaperAgents(),agentId=document.getElementById('paperAgent')?.value,agent=p.agents.find(function(a){return a.id===agentId})||p.agents[0],sym=(document.getElementById('paperSymbol')?.value||'BTC').trim().toUpperCase(),qty=FinPilotPaperCore.normalizeQty(sym,Number(document.getElementById('paperQty')?.value||0)),t=String(document.getElementById('paperOrderType')?.value||'MARKET').toUpperCase(),tif=String(document.getElementById('paperTif')?.value||'GTC').toUpperCase(),limit=Number(document.getElementById('paperLimitPrice')?.value||0),stop=Number(document.getElementById('paperStop')?.value||document.getElementById('paperBracketStop')?.value||0),trail=Number(document.getElementById('paperTrail')?.value||0),reduceOnly=Boolean(document.getElementById('paperReduceOnly')?.checked),bracket=Boolean(document.getElementById('paperBracket')?.checked),bracketStop=Number(document.getElementById('paperBracketStop')?.value||0),bracketTarget=Number(document.getElementById('paperBracketTarget')?.value||0);
    side=String(side||window.__paperProSide||'BUY').toUpperCase()==='SELL'?'SELL':'BUY';
    if(!agent){window.FinPilotBridge.toast('Select a paper agent');return}
    if(qty<FinPilotPaperCore.qtyStep(sym)){window.FinPilotBridge.toast('Enter a valid '+sym+' quantity');return}
    var m=p.lastMarket&&p.lastMarket.symbol===sym?p.lastMarket:null;
    if(!m||!Number.isFinite(Number(m.price))||Number(m.price)<=0)m=await paperProMarket();
    if(!m||!Number.isFinite(Number(m.price))||Number(m.price)<=0){window.FinPilotBridge.toast('No verified price for '+sym+' — order blocked');return}
    if(reduceOnly){var pos=agent.positions.find(function(x){return x.symbol===sym});if(side!=='SELL'||!pos||pos.qty<qty){window.FinPilotBridge.toast('Reduce-only SELL exceeds the current paper position');return}}
    if(t==='LIMIT'&&!limit){window.FinPilotBridge.toast('Enter a limit price');return}
    if((t==='STOP'||t==='STOP_LIMIT')&&!stop){window.FinPilotBridge.toast('Enter a stop price');return}
    if(t==='STOP_LIMIT'&&!limit){window.FinPilotBridge.toast('Enter a limit price for the stop-limit order');return}
    if(t==='TRAILING_STOP'&&!trail){window.FinPilotBridge.toast('Enter a trailing percentage');return}
    if(bracket&&bracketStop<=0&&bracketTarget<=0){window.FinPilotBridge.toast('Add a bracket stop loss or take profit');return}
    var entryPrice=t==='LIMIT'||t==='STOP_LIMIT'?limit:Number(m.price);
    var meta=paperProMarketMeta(m);
    var gate=FinPilotPaperCore.preTradeCheck(state,{agentId:agent.id,symbol:sym,side:side,qty:qty,entryPrice:entryPrice,stopPrice:bracket?bracketStop:stop,targetPrice:bracket?bracketTarget:0,marketMeta:meta});
    if(gate.status==='BLOCK'){paperProRiskGate();window.FinPilotBridge.toast('ORDER BLOCKED · '+gate.reasons[0]);return}
    try{
      var order,opts={enforceRisk:true,marketMeta:meta,stopPrice:bracket?bracketStop:stop,targetPrice:bracket?bracketTarget:0};
      if(bracket&&t!=='TRAILING_STOP'){
        order=FinPilotPaperCore.placeBracket(state,agent.id,sym,side,qty,t,entryPrice,bracketStop,bracketTarget,'Manual bracket paper order',opts);
      }else if(t==='MARKET'){
        order=FinPilotPaperCore.paperOrder(state,agent.id,sym,side,qty,Number(m.price),'Manual paper market',{orderType:'MARKET',...opts});
      }else{
        order=FinPilotPaperCore.placeOrder(state,agent.id,sym,side,qty,t,limit,stop,null,'Manual paper order',tif,null,trail,opts);
      }
      if(reduceOnly)order.reduceOnly=true;
      p.lastMarket=m;p.marketSnapshot[sym]=m.price;
      window.FinPilotBridge.save();
      var exec=document.getElementById('paperExecutionStatus');
      if(exec){exec.className='fpExec '+(order.status==='FILLED'?'good':'pending');exec.textContent=order.status==='FILLED'?'FILLED · virtual only':String(order.status)+' · waiting for trigger'}
      window.FinPilotBridge.render('paperlab');
      window.FinPilotBridge.toast(order.status==='FILLED'?'Paper '+side+' FILLED · virtual only':'Paper '+t+' order '+order.status+' · virtual only');
    }catch(e){
      var er=document.getElementById('paperExecutionStatus');if(er){er.className='fpExec bad';er.textContent='Order rejected · '+(e.message||'check risk gate, quantity, cash or position')}
      window.FinPilotBridge.toast(e.message||'Paper order rejected');
    }
  }
  async function paperProExecuteSignal(side){
    var rec=paperProRecommendation();
    if(rec.action==='HOLD'&&side===undefined){window.FinPilotBridge.toast('FinPilot recommends HOLD · no automatic order');return}
    var finalSide=String(side||rec.action).toUpperCase();
    if(finalSide!=='BUY'&&finalSide!=='SELL'){window.FinPilotBridge.toast('No executable BUY/SELL signal');return}
    var q=document.getElementById('paperQty');if(q)q.value=rec.qty>0?rec.qty:'';
    paperProSide(finalSide);
    await paperProSubmit(finalSide);
  }
  async function paperProAIExecute(){ await paperProExecuteSignal(); }
  async function paperProQuick(side){
    paperProSide(side);
    var t=document.getElementById('paperOrderType');if(t){t.value='MARKET';paperProSyncType()}
    await paperProSubmit(side);
  }
  function paperProCancel(id){
    try{FinPilotPaperCore.cancelOrder(state,id);window.FinPilotBridge.save();window.FinPilotBridge.render('paperlab');window.FinPilotBridge.toast('Paper order cancelled')}
    catch(e){window.FinPilotBridge.toast(e.message||'Could not cancel order')}
  }
  function paperProSetRisk(){
    var p=syncPaperAgents(),m=p.lastMarket||paperMarket(),a=p.agents.find(function(x){return x.id===document.getElementById('paperAgent')?.value})||p.agents[0],pos=a?.positions.find(function(x){return x.symbol===m.symbol});
    if(!pos){window.FinPilotBridge.toast('No paper position for this symbol');return}
    var stop=Number(document.getElementById('paperStop')?.value||0),target=Number(document.getElementById('paperTarget')?.value||0);FinPilotPaperCore.attachRisk(pos,stop,target);window.FinPilotBridge.save();window.FinPilotBridge.render('paperlab');window.FinPilotBridge.toast('Paper stop/target saved');
  }

  function paperProRecommendation(){
    const p=syncPaperAgents(),m=p.lastMarket||{},agents=p.agents||[];
    const direction=String(m.direction||'').toUpperCase(),rsi=Number(m.rsi||50);
    const market={symbol:m.symbol||'BTC',price:Number(m.price||0),momentum:Number(m.momentum||((direction==='BULLISH'?35:direction==='BEARISH'?-35:0)+(rsi-50)*0.5)),quality:Number(m.quality||m.score||65),valuation:Number(m.valuation||m.score||60),risk:Number(m.risk||m.riskScore||45),evidence:Number(m.evidence||90)};
    const thoughts=agents.map(function(a){return {a:a,t:FinPilotPaperCore.think(a,market)}}),buy=thoughts.filter(function(x){return x.t.action==='BUY'}).length,sell=thoughts.filter(function(x){return x.t.action==='SELL'}).length,hold=thoughts.length-buy-sell;
    const avg=thoughts.length?thoughts.reduce(function(n,x){return n+x.t.edge},0)/thoughts.length:50,risk=Number(market.risk||50);
    const action=buy>sell&&avg>=60&&risk<78?'BUY':sell>buy&&avg<=40?'SELL':'HOLD';
    const confidence=Math.max(0,Math.min(99,Math.round(60+Math.abs(avg-50)*.7+Math.abs(buy-sell)*3-risk*.12)));
    const selected=agents.find(function(a){return a.id===document.getElementById('paperAgent')?.value})||agents[0],maxNotional=Math.max(0,Number(selected?.cash||0)*0.10),qty=m.price>0?FinPilotPaperCore.normalizeQty(m.symbol||'BTC',maxNotional/m.price):0;
    const reasons=(thoughts[0]?.t?.steps||[]).slice(0,3);
    const leaders=thoughts.slice().sort(function(a,b){return b.t.confidence-a.t.confidence}).slice(0,4);
    const host=document.getElementById('paperRecommendation');
    const out={action,confidence,qty,avg,buy,sell,hold};
    if(!host)return out;
    host.innerHTML='<div class="fpRecMain"><span class="eyebrow">FINPILOT EXECUTION SIGNAL</span><strong class="'+(action==='BUY'?'green':action==='SELL'?'red':'')+'">'+action+'</strong><span>'+confidence+'% confidence · '+buy+' BUY / '+sell+' SELL / '+hold+' HOLD · edge '+avg.toFixed(1)+'</span></div>'+
      '<div class="fpAgentCalls">'+leaders.map(function(x){return '<span><b>'+esc(x.a.name)+'</b> <strong class="'+(x.t.action==='BUY'?'green':x.t.action==='SELL'?'red':'')+'">'+x.t.action+'</strong> <em>'+x.t.confidence.toFixed(0)+'%</em></span>'}).join('')+'</div>'+
      '<div class="fpRecReasons">'+reasons.map(function(x){return '<span>• '+esc(x)+'</span>'}).join('')+'</div>'+
      '<div class="fpRecPlan"><span>Suggested paper size <b>'+(qty||'0')+' '+esc(m.symbol||'BTC')+'</b></span><span>Risk budget <b>10% max notional</b></span><span>Execution <b>verified quote only</b></span></div>'+
      '<div class="fpRecActions"><button class="fpBuy" onclick="paperProExecuteSignal(\'BUY\')">EXECUTE BUY</button><button class="fpSell" onclick="paperProExecuteSignal(\'SELL\')">EXECUTE SELL</button><button class="btn" onclick="runPaperCouncil()">FULL COUNCIL</button></div>';
    return out;
  }
  function paperProHeartbeat(){
    if(!window.FinPilotBridge?.state||!window.FinPilotPaperCore)return;
    const p=syncPaperAgents(),m=p.lastMarket;
    if(!m||!Number(m.price))return;
    p.marketSnapshot[m.symbol]=Number(m.price);
    FinPilotPaperCore.markToMarket(state,p.marketSnapshot);
    window.FinPilotBridge.save();
    const s=FinPilotPaperCore.accountSummary(state);
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
    set('fpEquityValue',money(s.equity));set('fpCashValue',money(s.cash));set('fpPnlValue',money(s.realizedPnl+s.unrealizedPnl));set('fpExposureValue',money(s.exposure));
    set('paperQuoteLast',money(m.price));set('paperExecHigh',money(m.dayHigh||0));set('paperExecLow',money(m.dayLow||0));set('paperExecChange',(Number(m.changePct||0)>=0?'+':'')+Number(m.changePct||0).toFixed(2)+'%');
    paperProRecommendation();
    paperProRiskGate();
  }
  function proPaperLab(){
    window.__paperProSide=window.__paperProSide||'BUY';
    var p=syncPaperAgents(),m=p.lastMarket||{symbol:'BTC',price:0,changePct:0,dayHigh:0,dayLow:0,candles:[]},s=FinPilotPaperCore.accountSummary(state),risk=FinPilotPaperCore.riskReport(state),r=p.lastRound,b=FinPilotPaperCore.leaderboard(state),sel=p.agents[0]?.id||'';
    document.getElementById('paperlab').innerHTML=
      window.FinPilotBridge.header('BROKER-STYLE PAPER DESK','Agent Paper Arena','Professional virtual trading terminal with verified market data, direct execution, advanced orders and an auditable dashboard.','<button class="btn primary" onclick="paperProMarket()">↻ Verify market</button><button class="btn" onclick="runPaperCouncil()">Run AI Council</button><button class="btn warn" onclick="resetPaperArena()">Reset</button>')+
      '<div class="complianceBanner"><b>PAPER ONLY</b><span>All orders are virtual. No broker API or real-money execution is connected. Unverified market prices are never used for execution.</span><button class="btn" onclick="paperProMarket()">Verify price</button></div>'+
      '<div class="fpMarketHead"><div class="card fpChartCard"><div class="sectionTitle"><div><span class="eyebrow">MARKET</span><h3>'+esc(m.symbol||'BTC')+' <span id="paperMarketStatus" class="fpStatus '+(m.price?'good':'warn')+'">'+(m.price?'VERIFIED':'WAITING')+'</span></h3><span class="subtle">OHLC candles · volume · SMA20/SMA50 · RSI · verified quote</span></div><div class="chartControls"><select id="paperInterval" onchange="loadPaperMarket()"><option value="5m">5m</option><option value="15m">15m</option><option value="1h" selected>1h</option><option value="1d">1D</option></select></div></div><div id="paperChart"></div></div>'+
      '<div class="card fpQuote"><span class="eyebrow">EXECUTION GATE</span><div id="paperExecutionStatus" class="fpExec '+(m.price?'good':'warn')+'">'+(m.price?'Ready for paper orders':'Verify market data to enable order entry')+'</div><div class="fpStats"><div><span>LAST</span><b id="paperQuoteLast">'+money(m.price||0)+'</b></div><div><span>HIGH</span><b id="paperExecHigh">'+money(m.dayHigh||0)+'</b></div><div><span>LOW</span><b id="paperExecLow">'+money(m.dayLow||0)+'</b></div><div><span>CHANGE</span><b id="paperExecChange" class="'+(Number(m.changePct||0)>=0?'green':'red')+'">'+(Number(m.changePct||0)>=0?'+':'')+Number(m.changePct||0).toFixed(2)+'%</b></div></div><div class="fpQuoteNote">Order book display is simulated from verified quotes, not real Level 2 depth.</div></div></div>'+
      '<div class="grid cards fpKpis"><div class="card kpi"><span class="label">EQUITY</span><div id="fpEquityValue" class="metric">'+money(s.equity)+'</div><div class="delta '+(s.returnPct>=0?'green':'red')+'">'+s.returnPct+'% return</div></div><div class="card kpi"><span class="label">CASH</span><div id="fpCashValue" class="metric">'+money(s.cash)+'</div><div class="delta">Virtual buying power</div></div><div class="card kpi"><span class="label">P&amp;L</span><div id="fpPnlValue" class="metric '+(s.realizedPnl+s.unrealizedPnl>=0?'green':'red')+'">'+money(s.realizedPnl+s.unrealizedPnl)+'</div><div class="delta">Realized '+money(s.realizedPnl)+' · Unrealized '+money(s.unrealizedPnl)+'</div></div><div class="card kpi"><span class="label">OPEN ORDERS</span><div class="metric">'+s.openOrders+'</div><div id="fpExposureValue" class="delta">Exposure '+money(s.exposure)+'</div></div></div>'+
      '<div id="paperRecommendation" class="card fpRecommendation"></div><div class="fpWorkspace">'+
      '<div class="card fpTicket"><div class="sectionTitle"><div><span class="eyebrow">ORDER TICKET</span><h3>Trade</h3></div><span class="pill low">VIRTUAL</span></div>'+
      '<div class="fpFields3"><label>Symbol<input id="paperSymbol" value="'+esc(m.symbol||'BTC')+'" oninput="paperProPreview()"></label><label>Verified price<input id="paperPrice" value="'+(m.price||'')+'" readonly></label><label>Agent<select id="paperAgent" onchange="paperProPreview()">'+p.agents.map(function(a){return '<option value="'+esc(a.id)+'" '+(a.id===sel?'selected':'')+'>'+esc(a.name)+' · '+esc(a.role)+'</option>'}).join('')+'</select></label></div>'+
      '<div class="fpSideRow"><span class="fpLabel">SIDE</span><button type="button" class="fpSide active" data-side="BUY" onclick="paperProSide(\'BUY\')">BUY</button><button type="button" class="fpSide" data-side="SELL" onclick="paperProSide(\'SELL\')">SELL</button><span class="fpHint">SELL reduces an existing long paper position.</span></div>'+
      '<div class="fpOrderGrid"><label>Quantity<input id="paperQty" type="number" min="0.0001" step="any" value="1" oninput="paperProPreview()"></label><label>Order type<select id="paperOrderType" onchange="paperProSyncType()"><option>MARKET</option><option>LIMIT</option><option>STOP</option><option>STOP_LIMIT</option><option>TRAILING_STOP</option></select><small id="paperTypeHelp">Immediate fill at the latest verified paper quote.</small></label><label>Limit price<input id="paperLimitPrice" type="number" step="any" value="'+(m.price||'')+'" oninput="paperProPreview()"></label><label>Stop price<input id="paperStop" type="number" step="any" placeholder="—" oninput="paperProPreview()"></label><label>Trailing %<input id="paperTrail" type="number" step="0.01" min="0.01" placeholder="1.5" oninput="paperProPreview()"></label><label>TIF<select id="paperTif"><option>GTC</option><option>DAY</option><option>IOC</option><option>FOK</option></select></label></div>'+
      '<div class="fpChecks"><label><input id="paperReduceOnly" type="checkbox"> Reduce-only</label><label><input id="paperBracket" type="checkbox" onchange="document.getElementById(\'paperBracketFields\').hidden=!this.checked"> Attach OCO bracket</label><div id="paperBracketFields" class="fpBracket" hidden><label>Bracket stop<input id="paperBracketStop" type="number" step="any" placeholder="Stop loss" oninput="paperProPreview()"></label><label>Bracket target<input id="paperBracketTarget" type="number" step="any" placeholder="Take profit" oninput="paperProPreview()"></label></div></div>'+
      '<div id="paperOrderPreview" class="fpPreview"></div>'+'<div id="paperRiskTower" class="fpRiskTower"></div>'+
      '<div class="fpButtonRow"><button class="btn" onclick="paperProMarket()">Get verified price</button><button class="btn primary" onclick="paperThink()">AI Deep Think</button><button class="btn" onclick="runPaperCouncil()">Run Council</button><button class="btn good" onclick="paperExecute()">AI Execute Paper</button></div>'+
      '<div class="fpDirect"><button class="fpBuy" onclick="paperProQuick(\'BUY\')">BUY · MARKET</button><button class="fpSell" onclick="paperProQuick(\'SELL\')">SELL · MARKET</button><button class="btn warn" onclick="paperProSetRisk()">Apply SL/TP</button></div></div>'+
      '<div class="card fpCouncil"><div class="sectionTitle"><div><span class="eyebrow">AI COUNCIL</span><h3>Decision layer</h3></div><span class="pill '+(r?'low':'med')+'">'+esc(r?.final||'WAITING')+'</span></div>'+(r?'<div class="fpVerdict"><b>'+esc(r.final)+'</b><span>'+r.confidence+'% confidence · edge '+r.avgEdge+'</span></div><div class="fpVotes"><div><span>BUY</span><b>'+r.vote.buy+'</b></div><div><span>SELL</span><b>'+r.vote.sell+'</b></div><div><span>HOLD</span><b>'+r.vote.hold+'</b></div></div>':'<div class="fpEmpty"><b>No Council decision</b><span>Run the Council for multi-agent reasoning. Direct market orders work independently.</span></div>')+
      '<div class="fpRisk"><div class="sectionTitle"><h3>Risk monitor</h3><span class="subtle">Virtual account</span></div><div><span>Total exposure</span><b>'+risk.exposurePct+'%</b></div><div><span>Fees simulated</span><b>'+money(s.fees)+'</b></div><div><span>Slippage simulated</span><b>'+money(s.slippage)+'</b></div><div><span>Real execution</span><b class="green">BLOCKED</b></div></div></div></div>'+
      '<div class="card fpDashboard"><div class="sectionTitle"><div><span class="eyebrow">BROKER DASHBOARD</span><h3>Open orders</h3></div><span class="subtle">'+p.openOrders.length+' active</span></div><div class="fpScroll"><table class="table fpTable"><thead><tr><th>Side</th><th>Symbol</th><th>Type</th><th>Qty</th><th>Price</th><th>TIF</th><th>Status</th><th></th></tr></thead><tbody>'+
      (p.openOrders.slice(0,20).map(function(o){return '<tr><td class="'+(o.side==='BUY'?'green':'red')+'"><b>'+esc(o.side)+'</b></td><td><b>'+esc(o.symbol)+'</b></td><td>'+esc(o.orderType)+'</td><td>'+o.remainingQty+'/'+o.qty+'</td><td>'+money(o.limitPrice||o.stopPrice||0)+'</td><td>'+esc(o.timeInForce||'GTC')+'</td><td><span class="pill med">'+esc(o.status)+'</span></td><td><button class="btn danger" onclick="paperProCancel(\''+esc(o.id)+'\')">Cancel</button></td></tr>'}).join('')||'<tr><td colspan="8" class="muted">No active orders. Place a LIMIT, STOP, STOP-LIMIT or TRAILING order to populate this dashboard.</td></tr>')+'</tbody></table></div></div>'+
      '<div class="fpBottom"><div class="card fpDashboard"><div class="sectionTitle"><h3>Open positions</h3><span class="subtle">Mark-to-market</span></div><div class="fpScroll"><table class="table fpTable"><thead><tr><th>Agent</th><th>Symbol</th><th>Qty</th><th>Avg</th><th>Last</th><th>P&amp;L</th><th>Risk</th></tr></thead><tbody>'+
      (p.agents.flatMap(function(a){return a.positions.map(function(pos){return '<tr><td>'+esc(a.name)+'</td><td><b>'+esc(pos.symbol)+'</b></td><td>'+pos.qty+'</td><td>'+money(pos.avg)+'</td><td>'+money(pos.last)+'</td><td class="'+((pos.last-pos.avg)>=0?'green':'red')+'">'+money((pos.last-pos.avg)*pos.qty)+'</td><td>'+(pos.stop||pos.target?'<span class="pill low">SL/TP</span>':'<span class="pill med">NONE</span>')+'</td></tr>'})}).join('')||'<tr><td colspan="7" class="muted">No open positions.</td></tr>')+'</tbody></table></div></div>'+
      '<div class="card fpDashboard"><div class="sectionTitle"><h3>Recent fills</h3><span class="subtle">Auditable ledger</span></div><div class="feed">'+
      (p.orders.filter(function(o){return o.status==='FILLED'}).slice(0,12).map(function(o){return '<div class="feedItem"><b class="'+(o.side==='BUY'?'green':'red')+'">'+esc(o.side)+' '+esc(o.symbol)+' · FILLED</b><span class="muted">'+o.qty+' @ '+money(o.fillPrice||0)+' · '+esc(o.orderType||'MARKET')+' · '+new Date(o.time).toLocaleString()+'</span></div>'}).join('')||'<div class="fpEmpty">No fills yet.</div>')+'</div></div></div>'+
      '<div class="card fpDashboard"><div class="sectionTitle"><h3>Agent performance</h3><span class="subtle">Virtual only</span></div><div class="fpAgents">'+b.map(function(a){return '<div><b>'+esc(a.name)+'</b><span class="'+(a.returnPct>=0?'green':'red')+'">'+a.returnPct+'%</span><small>Equity '+money(a.equity)+' · Exposure '+money(a.exposure)+'</small></div>'}).join('')+'</div></div>';
    renderPaperChart(m);
    paperProSyncType();
    paperProSide(window.__paperProSide);
    paperProRecommendation();
    paperProRiskGate();
    if(window.__paperProHeartbeatTimer)clearInterval(window.__paperProHeartbeatTimer);
    window.__paperProHeartbeatTimer=setInterval(paperProHeartbeat,1000);
    if(!m.price||!Array.isArray(m.candles)||m.candles.length<2)setTimeout(function(){paperProMarket()},60);
    else setTimeout(function(){connectPaperMarketStream(m)},60);
  }

  window.paperProSide=paperProSide;
  window.paperProSyncType=paperProSyncType;
  window.paperProPreview=paperProPreview;
  window.paperProMarket=paperProMarket;
  window.paperProSubmit=paperProSubmit;
  window.paperProQuick=paperProQuick;
  window.paperProCancel=paperProCancel;
  window.paperProSetRisk=paperProSetRisk;
  window.paperProAIExecute=paperProAIExecute;
  window.paperProExecuteSignal=paperProExecuteSignal;
  window.paperProRiskGate=paperProRiskGate;
  window.paperExecute=paperProAIExecute;
  window.paperProRecommendation=paperProRecommendation;
  window.paperProHeartbeat=paperProHeartbeat;
  window.paperLab=proPaperLab;

  document.head.insertAdjacentHTML('beforeend',`<style id="fpProUpgrade">.fpRecommendation{margin-top:14px;border:1px solid #31577d;background:linear-gradient(135deg,#0b1e35,#09172a);padding:14px}.fpRecMain{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.fpRecMain strong{font-size:28px}.fpRecMain span:last-child{font-size:10px;color:#91a7c5}.fpRecReasons{display:flex;gap:14px;flex-wrap:wrap;margin:9px 0;color:#b7c7dc;font-size:10px}.fpRecPlan{display:flex;gap:18px;flex-wrap:wrap;padding:9px 0;border-top:1px solid #203954;border-bottom:1px solid #203954;color:#8195b1;font-size:10px}.fpRecPlan b{color:#e7f0fc}.fpRecActions{display:flex;gap:8px;margin-top:10px}.fpRecActions button{min-width:150px}@media(max-width:720px){.fpRecActions{display:grid;grid-template-columns:1fr 1fr}.fpRecActions .btn{grid-column:1/-1}.fpRecActions button{min-width:0}}</style>`);
  document.head.insertAdjacentHTML('beforeend',`<style id="fpRiskTowerStyle">.fpRiskTower{margin:8px 0 12px;padding:12px;border:1px solid #263957;border-radius:10px;background:#08182b}.fpTowerHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.fpTowerHead strong{font-size:18px;margin-left:10px}.fpTowerConfidence{font-size:9px;color:#8093ae}.fpTowerHead .good{color:#59e4ad}.fpTowerHead .warn{color:#f4d35e}.fpTowerHead .bad{color:#fb7185}.fpTowerGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:9px 0}.fpTowerGrid>div{padding:8px;border:1px solid #1f3551;border-radius:7px;background:#0a1b30}.fpTowerGrid span{display:block;font-size:8px;color:#71859f;letter-spacing:.06em}.fpTowerGrid b{display:block;margin-top:3px;font-size:11px}.fpTowerReasons{display:flex;gap:10px;flex-wrap:wrap;font-size:9px;color:#b4c4d9}.fpTowerNote{display:block;margin-top:8px;font-size:8px;color:#6f8199}@media(max-width:720px){.fpTowerGrid{grid-template-columns:repeat(2,1fr)}.fpTowerHead{align-items:flex-start}}</style>`);
  document.head.insertAdjacentHTML('beforeend',`<style id="fpAgentCallsStyle">.fpAgentCalls{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0}.fpAgentCalls span{display:inline-flex;align-items:center;gap:6px;padding:7px 9px;background:#0a192d;border:1px solid #263957;border-radius:8px;font-size:9px;color:#a8bad0}.fpAgentCalls b{color:#dce8f6}.fpAgentCalls strong{font-size:10px}.fpAgentCalls em{font-style:normal;color:#71849e}</style>`);
  var css=document.createElement('style');
  css.textContent=".fpMarketHead{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:14px}.fpChartCard{overflow:hidden}.fpQuote{min-height:360px;display:flex;flex-direction:column;gap:12px}.fpStatus{font-size:10px;padding:4px 7px;border-radius:999px;margin-left:7px}.fpStatus.good{background:#0c291f;color:#59e4ad;border:1px solid #1d5d48}.fpStatus.warn{background:#2b2410;color:#f4d35e;border:1px solid #6b5820}.fpExec{padding:12px;border-radius:10px;border:1px solid #263957;font-weight:850}.fpExec.good{background:#0c291f;color:#59e4ad;border-color:#1d5d48}.fpExec.warn{background:#2b2410;color:#f4d35e;border-color:#6b5820}.fpExec.pending{background:#112746;color:#58b7ff;border-color:#23527e}.fpExec.bad{background:#32151d;color:#fb7185;border-color:#7c2536}.fpStats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fpStats>div{padding:11px;border:1px solid #263957;border-radius:9px;background:#09182b}.fpStats span{display:block;font-size:9px;letter-spacing:.08em;color:#8093ae}.fpStats b{font-size:16px}.fpQuoteNote{font-size:10px;line-height:1.45;color:#8093ae;margin-top:auto;padding-top:10px;border-top:1px solid #263957}.fpKpis{margin-top:14px}.fpWorkspace{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.85fr);gap:14px;margin-top:14px}.fpTicket,.fpCouncil,.fpDashboard{background:linear-gradient(180deg,#071426,#081729)}.fpFields3{display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:10px}.fpFields3 label,.fpOrderGrid label,.fpBracket label{display:grid;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#91a7c5;font-weight:800}.fpFields3 input,.fpFields3 select,.fpOrderGrid input,.fpOrderGrid select,.fpBracket input{width:100%;background:#09192e;color:#edf5ff;border:1px solid #294263;border-radius:9px;padding:11px 12px}.fpFields3 input[readonly]{color:#59e4ad}.fpSideRow{display:flex;align-items:center;gap:8px;padding:14px 0;border-bottom:1px solid #1b3454;margin-bottom:14px;flex-wrap:wrap}.fpLabel{font-size:10px;font-weight:900;letter-spacing:.1em;color:#91a7c5;margin-right:2px}.fpSide{border:0;background:#07111f;color:#91a7c5;padding:10px 18px;border-radius:8px;font-weight:900}.fpSide.active{background:#0f6c4e;color:#fff}.fpHint{font-size:9px;color:#7287a5;margin-left:auto}.fpOrderGrid{display:grid;grid-template-columns:1fr 1.3fr 1fr 1fr 1fr 1fr;gap:10px}.fpOrderGrid small{font-size:9px;color:#71819a;text-transform:none;letter-spacing:0;font-weight:500;line-height:1.3}.fpOrderGrid input:disabled,.fpOrderGrid select:disabled{opacity:.45}.fpChecks{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:14px 0}.fpChecks label{font-size:11px;color:#c3d0e3;display:flex;gap:7px;align-items:center}.fpBracket{display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:1;min-width:260px}.fpPreview{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px;background:#0a192d;border:1px solid #243c5c;border-radius:9px;margin-bottom:12px}.fpPreview div{padding-right:7px;border-right:1px solid #263957}.fpPreview div:last-of-type{border-right:0}.fpPreview span{display:block;color:#71819a;font-size:9px}.fpPreview b{display:block;font-size:12px;margin-top:4px}.fpPreview small{grid-column:1/-1;color:#8295b1;font-size:9px}.fpButtonRow,.fpDirect{display:flex;gap:8px;flex-wrap:wrap}.fpDirect{margin-top:8px}.fpBuy,.fpSell{flex:1;border-radius:9px;padding:12px 16px;border:1px solid transparent;color:#fff;font-weight:900}.fpBuy{background:#0f6c4e;border-color:#1c9d73}.fpSell{background:#7b2333;border-color:#bb4458}.fpVerdict{display:flex;justify-content:space-between;gap:8px;padding:14px;background:#0a192d;border:1px solid #263957;border-radius:9px}.fpVerdict b{font-size:20px}.fpVerdict span{font-size:10px;color:#8295b1}.fpVotes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}.fpVotes div{padding:10px;text-align:center;background:#09182b;border:1px solid #263957;border-radius:8px}.fpVotes span{display:block;color:#8093ae;font-size:9px}.fpVotes b{font-size:19px}.fpRisk{margin-top:14px;border-top:1px solid #263957;padding-top:8px}.fpRisk>div:not(.sectionTitle){display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #142844;font-size:11px}.fpScroll{overflow:auto}.fpTable{min-width:730px}.fpTable th{white-space:nowrap}.fpBottom{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.8fr);gap:14px;margin-top:14px}.fpEmpty{min-height:120px;display:grid;place-items:center;text-align:center;padding:18px;color:#7f92ae;border:1px dashed #294263;border-radius:9px;font-size:11px}.fpAgents{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.fpAgents>div{padding:11px;border:1px solid #263957;border-radius:8px;background:#0a192d}.fpAgents b,.fpAgents span,.fpAgents small{display:block}.fpAgents span{font-size:18px;font-weight:900;margin-top:4px}.fpAgents small{font-size:9px;color:#8295b1;margin-top:4px}@media(max-width:1100px){.fpMarketHead,.fpWorkspace,.fpBottom{grid-template-columns:1fr}.fpQuote{min-height:auto}.fpOrderGrid{grid-template-columns:1fr 1fr 1fr}}@media(max-width:720px){.fpFields3{grid-template-columns:1fr 1fr}.fpOrderGrid{grid-template-columns:1fr 1fr}.fpStats{grid-template-columns:1fr 1fr}.fpPreview{grid-template-columns:1fr 1fr}.fpAgents{grid-template-columns:1fr}.fpChartCard .paperChartWrap{height:300px}.fpHint{width:100%;margin-left:0}}";
  document.head.appendChild(css);
})();