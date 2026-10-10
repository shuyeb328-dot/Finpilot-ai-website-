/* FinPilot Paper Trading Engine V2
   Broker-style simulation only. No broker connection, no real-money execution. */
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
  const num=(n,d=0)=>Number.isFinite(Number(n))?Number(n):d;
  const uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const now=()=>new Date().toISOString();
  function defaultPaper(){return{
    version:3,baseCurrency:'INR',startingCash:1000000,cash:1000000,realizedPnl:0,unrealizedPnl:0,
    fees:0,slippage:0,agents:[],positions:[],orders:[],openOrders:[],journal:[],rounds:[],
    leaderboard:[],marketSnapshot:{},decisionLedger:[],execution:{lastTick:null,reconciledAt:null},account:{marginEnabled:false,leverage:1,commissionBps:8,slippageBps:3},
    updatedAt:now()
  }}
  function ensure(state){
    if(!state.paperTrading)state.paperTrading=defaultPaper();
    const p=state.paperTrading;
    p.agents=(Array.isArray(p.agents)?p.agents:[]).filter(a=>a&&typeof a==='object');p.positions=(Array.isArray(p.positions)?p.positions:[]).filter(x=>x&&typeof x==='object');p.orders=(Array.isArray(p.orders)?p.orders:[]).filter(x=>x&&typeof x==='object');
    p.openOrders=(Array.isArray(p.openOrders)?p.openOrders:[]).filter(x=>x&&typeof x==='object');p.journal=Array.isArray(p.journal)?p.journal:[];p.rounds=Array.isArray(p.rounds)?p.rounds:[];p.leaderboard=Array.isArray(p.leaderboard)?p.leaderboard:[];
    p.marketSnapshot=p.marketSnapshot&&typeof p.marketSnapshot==='object'?p.marketSnapshot:{};p.decisionLedger=Array.isArray(p.decisionLedger)?p.decisionLedger.filter(x=>x&&typeof x==='object'):[];
    p.execution={lastTick:null,reconciledAt:null,tickCount:0,lastTickAt:null,model:'REALISTIC',latencyMs:75,impactBpsCap:30,...(p.execution||{})};
    p.execution.latencyMs=Math.max(0,num(p.execution.latencyMs,75));
    p.execution.impactBpsCap=Math.max(0,num(p.execution.impactBpsCap,30));
    // Repair older/partial local paper state before any numeric formatter is called.
    p.version=Math.max(3,num(p.version,3)); p.startingCash=num(p.startingCash,1000000);
    p.cash=num(p.cash,p.startingCash); p.realizedPnl=num(p.realizedPnl,0);
    p.unrealizedPnl=num(p.unrealizedPnl,0); p.fees=num(p.fees,0); p.slippage=num(p.slippage,0);
    p.account={marginEnabled:false,leverage:1,commissionBps:8,slippageBps:3,...(p.account||{})};
    p.account.leverage=Math.max(1,num(p.account.leverage,1));
    p.account.commissionBps=Math.max(0,num(p.account.commissionBps,8));
    p.account.slippageBps=Math.max(0,num(p.account.slippageBps,3));
    p.agents.forEach(a=>{a.capital=num(a.capital,p.startingCash/Math.max(1,p.agents.length));a.cash=num(a.cash,a.capital);a.pnl=num(a.pnl,0);a.decisions=Math.max(0,Math.floor(num(a.decisions,0)));a.confidence=num(a.confidence,70);a.positions=Array.isArray(a.positions)?a.positions:[];a.positions.forEach(pos=>{pos.qty=Math.max(0,num(pos.qty,0));pos.avg=num(pos.avg,0);pos.last=num(pos.last,pos.avg);});});
    return p;
  }
  function ensureAgent(p,agent){
    let a=p.agents.find(x=>x.id===agent.id);
    if(!a){const capital=p.startingCash/Math.max(1,p.agents.length+1);a={id:agent.id,name:agent.name,role:agent.role||'Specialist',capital,cash:capital,positions:[],pnl:0,winRate:null,decisions:0,confidence:70,enabled:true,strategy:agent.strategy||'Evidence-first',createdAt:now()};p.agents.push(a)}
    a.positions=Array.isArray(a.positions)?a.positions:[];return a;
  }

  // Decision-to-outcome bridge: records the recommendation context used by later paper fills.
  function recordDecision(state,agentId,symbol,action,meta={}){
    const p=ensure(state),a=aOf(p,agentId)||p.agents.find(x=>String(x.id)===String(agentId));
    if(!a)throw new Error('Paper agent not found');
    const row={id:uid('decision'),agentId:a.id,agentName:a.name||agentId,symbol:String(symbol||'SIM').toUpperCase(),action:String(action||'HOLD').toUpperCase(),confidence:clamp(num(meta.confidence,50)),edge:clamp(num(meta.edge,50)),thesis:meta.thesis||'',source:meta.source||'AGENT_DECISION',roundId:meta.roundId||null,time:now(),outcomeStatus:'UNRESOLVED',virtualOnly:true};
    p.decisionLedger.unshift(row);if(p.decisionLedger.length>500)p.decisionLedger=p.decisionLedger.slice(0,500);p.updatedAt=now();return row;
  }
  function latestDecision(p,agentId,symbol){
    const key=String(symbol||'').toUpperCase(),cut=Date.now()-30*60*1000;
    return p.decisionLedger.find(d=>d.agentId===agentId&&String(d.symbol||'').toUpperCase()===key&&Date.parse(d.time||0)>=cut)||null;
  }

  function think(agent,market){
    const momentum=clamp(num(market.momentum),-100,100),quality=clamp(num(market.quality,50)),valuation=clamp(num(market.valuation,50)),risk=clamp(num(market.risk,50)),evidence=clamp(num(market.evidence,50));
    const bull=quality*.28+valuation*.22+Math.max(0,momentum)*.18+evidence*.18+(100-risk)*.14;
    const bear=(100-quality)*.22+(100-valuation)*.22+Math.max(0,-momentum)*.2+risk*.22+(100-evidence)*.14;
    const edge=clamp(50+(bull-bear)/2);let action=edge>=67?'BUY':edge<=33?'SELL':'HOLD';if(risk>=78&&action==='BUY')action='HOLD';
    const confidence=clamp(58+Math.abs(edge-50)*.65+Math.abs(momentum)*.08);
    const steps=[`Momentum ${momentum.toFixed(1)}`,`Quality ${quality.toFixed(1)}`,`Valuation ${valuation.toFixed(1)}`,`Risk ${risk.toFixed(1)}`,`Evidence ${evidence.toFixed(1)}`];
    return{action,confidence:+confidence.toFixed(1),edge:+edge.toFixed(1),bull:+bull.toFixed(1),bear:+bear.toFixed(1),steps,
      thesis:action==='BUY'?'Evidence and quality outweigh downside risk; accumulate only inside the paper risk budget.':action==='SELL'?'Downside factors dominate the evidence; reduce exposure in simulation rather than chase the move.':'Evidence is not strong enough for a high-conviction position; preserve optionality and wait for confirmation.',
      invalidation:action==='BUY'?'Quality/evidence <40 or risk >80.':action==='SELL'?'Quality >65 with improving evidence.':'Edge exits the 33–67 neutral band.',timestamp:now()};
  }
  function costs(p,value){const fee=value*num(p.account.commissionBps)/10000;return{fee,slip:0,total:fee}}
  function fillPrice(p,side,price,extraBps=0){const s=(num(p.account.slippageBps)+num(extraBps))/10000;return side==='BUY'?price*(1+s):price*(1-s)}
  function updateAgentPosition(a,symbol,side,qty,price){
    let pos=a.positions.find(x=>x.symbol===symbol);
    if(side==='BUY'){if(pos){const total=pos.qty+qty;pos.avg=(pos.avg*pos.qty+price*qty)/total;pos.qty=total;pos.last=price}else{pos={symbol,qty,avg:price,last:price,stop:null,target:null,openedAt:now()};a.positions.push(pos)}}
    else{if(!pos||pos.qty<qty)throw new Error('Paper position limit exceeded');const pnl=(price-pos.avg)*qty;a.cash+=price*qty;pos.qty-=qty;pos.last=price;if(pos.qty===0)a.positions=a.positions.filter(x=>x!==pos);return pnl}
    return 0;
  }
  function qtyStep(symbol){
    const s=String(symbol||'').toUpperCase().replace(/[-_/].*$/,'');
    return ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','MATIC','POL'].includes(s)?0.0001:1;
  }
  function normalizeQty(symbol,qty){
    const step=qtyStep(symbol),n=Math.max(0,num(qty));
    return step===1?Math.floor(n):Math.floor(n/step+1e-9)*step;
  }
  function estimateQuoteAgeSec(meta){
    const raw=meta?.sourceAsOf??meta?.asOf??meta?.tick?.sourceAsOf??meta?.tick?.asOf;
    if(raw===null||raw===undefined||String(raw).trim()==='')return null;
    const text=String(raw).trim();
    let ms;
    if(typeof raw==='number'||/^\d{10,13}$/.test(text)){
      const value=Number(raw);
      if(!Number.isFinite(value))return null;
      ms=value<100000000000?value*1000:value;
    }else{
      ms=Date.parse(text);
    }
    if(!Number.isFinite(ms))return null;
    const ageMs=Date.now()-ms;
    if(ageMs < -5000)return null;
    return Math.max(0,ageMs)/1000;
  }
  function preTradeCheck(state,args={}){
    const p=ensure(state),agent=p.agents.find(x=>x.id===args.agentId);
    const symbol=String(args.symbol||'').toUpperCase(),side=String(args.side||'').toUpperCase();
    const qty=normalizeQty(symbol,args.qty),price=Math.max(0,num(args.entryPrice));
    const meta=args.marketMeta&&typeof args.marketMeta==='object'?args.marketMeta:{};
    const age=estimateQuoteAgeSec(meta);
    const verified=meta.verified===true&&meta.available===true&&meta.executionEligible===true
      &&meta.sourceTimestampType==='PROVIDER_TIMESTAMP'&&age!==null&&age<=30;
    const reasons=[],warnings=[];let status='PASS';
    const block=x=>{if(!reasons.includes(x))reasons.push(x);status='BLOCK'};
    const warn=x=>{warnings.push(x);if(status!=='BLOCK')status='WARN'};
    if(!verified)block('Verified live market data with a fresh provider timestamp is required for paper execution.');
    if(age===null)block('Provider quote timestamp is missing, invalid, or too far in the future.');
    else if(age>30)block('Verified quote is stale (>30s).');
    else if(age>10)warn('Quote is older than 10s.');
    if(!agent)block('Selected paper agent is unavailable.');
    if(!symbol)block('A trading symbol is required.');
    if(!['BUY','SELL'].includes(side))block('A valid BUY or SELL side is required.');
    if(qty<=0)block('Quantity is below the minimum tradable size.');
    if(price<=0)block('Executable reference price is unavailable.');
    if(agent&&price>0&&qty>0){
      const notional=qty*price,fee=notional*p.account.commissionBps/10000,slip=notional*p.account.slippageBps/10000;
      if(side==='BUY'&&notional+fee+slip>agent.cash)block('Insufficient paper buying power.');
      if(side==='SELL'){
        const pos=agent.positions.find(x=>x.symbol===symbol);
        if(!pos||pos.qty+1e-12<qty)block('SELL quantity exceeds the current paper position.');
      }
      const equity=Math.max(1,agent.cash+agent.positions.reduce((n,x)=>n+x.qty*x.last,0));
      const currentExposure=agent.positions.reduce((n,x)=>n+x.qty*x.last,0);
      const projectedExposure=side==='BUY'?currentExposure+notional:Math.max(0,currentExposure-Math.min(notional,currentExposure));
      const exposurePct=projectedExposure/equity*100;
      if(exposurePct>90)block('Post-trade exposure exceeds the 90% paper risk ceiling.');
      else if(exposurePct>50)warn('Post-trade exposure will exceed 50% of agent equity.');
      const bid=Number(meta.bid),ask=Number(meta.ask),mid=(bid>0&&ask>0)?(bid+ask)/2:0,spreadBps=mid>0?(ask-bid)/mid*10000:null;
      if(spreadBps!=null){if(spreadBps>80)block('Quote spread is too wide for controlled execution.');else if(spreadBps>40)warn('Quote spread is elevated.')}
      const liquidityNotional=Math.max(2500,Math.min(250000,price*50)),liquidityQty=liquidityNotional/price;
      if(qty>liquidityQty*2)warn('Requested size is larger than simulated immediate liquidity; partial fill is likely.');
      if(p.account.slippageBps>20)warn('Configured paper slippage is elevated.');
      const stop=num(args.stopPrice),target=num(args.targetPrice);
      let riskPerUnit=0,rewardPerUnit=0,rr=null,maxLoss=null;
      if(stop>0||target>0){
        if(side==='BUY'){
          if(stop>0&&stop>=price)block('BUY stop loss must be below the entry reference.');
          if(target>0&&target<=price)block('BUY target must be above the entry reference.');
          riskPerUnit=stop>0?price-stop:0;rewardPerUnit=target>0?target-price:0;
        }else{
          if(stop>0&&stop<=price)block('SELL stop loss must be above the entry reference.');
          if(target>0&&target>=price)block('SELL target must be below the entry reference.');
          riskPerUnit=stop>0?stop-price:0;rewardPerUnit=target>0?price-target:0;
        }
        if(riskPerUnit>0&&rewardPerUnit>0){rr=rewardPerUnit/riskPerUnit;maxLoss=riskPerUnit*qty+fee;if(rr<1)block('Risk/reward is below 1:1.');else if(rr<1.5)warn('Risk/reward is below the preferred 1.5:1 threshold.')}
      }else warn('No protective stop/target configured; maximum loss is not bounded.');
      const confidence=Math.max(0,Math.min(99,Math.round((verified?72:0)+(Number(meta.providerCount||0)>=2?15:5)+(age!==null&&age<5?8:0)-(status==='BLOCK'?25:status==='WARN'?5:0))));
      return {status,reasons,warnings,virtualOnly:true,metrics:{qty,qtyStep:qtyStep(symbol),price,notional:+(qty*price).toFixed(2),estimatedFee:+fee.toFixed(2),estimatedSlippage:+slip.toFixed(2),quoteAgeSec:age===null?null:+age.toFixed(1),spreadBps:spreadBps==null?null:+spreadBps.toFixed(1),postTradeExposurePct:+exposurePct.toFixed(1),riskPerUnit:+riskPerUnit.toFixed(6),maxLoss:maxLoss==null?null:+maxLoss.toFixed(2),riskReward:rr==null?null:+rr.toFixed(2),liquidityQty:+liquidityQty.toFixed(4),fillability:qty<=liquidityQty?'FULL':'PARTIAL',dataConfidence:confidence},timestamp:now()};
    }
    return {status,reasons,warnings,virtualOnly:true,metrics:{qty,qtyStep:qtyStep(symbol),price,notional:0,estimatedFee:0,estimatedSlippage:0,quoteAgeSec:age===null?null:+age.toFixed(1),spreadBps:null,postTradeExposurePct:0,riskPerUnit:0,maxLoss:null,riskReward:null,liquidityQty:0,fillability:'BLOCKED',dataConfidence:0},timestamp:now()};
  }
  function paperOrder(state,agentId,symbol,side,qty,price,reason,opts={}){
    const p=ensure(state),a=p.agents.find(x=>x.id===agentId);if(!a)throw new Error('Paper agent not found');
    const clientOrderId=opts.clientOrderId?String(opts.clientOrderId):'';
    const marketMeta=opts.marketMeta||{};
    const linkedDecision=opts.decisionId? p.decisionLedger.find(d=>d.id===String(opts.decisionId)):latestDecision(p,agentId,symbol);
    if(clientOrderId){
      const existing=p.orders.find(x=>x.clientOrderId===clientOrderId);
      if(existing)return existing;
      const existingOpen=p.openOrders.find(x=>x.clientOrderId===clientOrderId);
      if(existingOpen)return existingOpen;
    }
    qty=normalizeQty(symbol,qty);price=Math.max(0,num(price));side=String(side).toUpperCase();
    if(!qty||!price||!['BUY','SELL'].includes(side))throw new Error('Valid side, quantity and price are required');
    if(opts.enforceRisk){const gate=preTradeCheck(state,{agentId,symbol,side,qty,entryPrice:price,stopPrice:opts.stopPrice,targetPrice:opts.targetPrice,marketMeta:opts.marketMeta});if(gate.status==='BLOCK')throw new Error('Pre-trade risk block: '+gate.reasons.join(' '));}
    const bid=Math.max(0,num(marketMeta.bid,0)),ask=Math.max(0,num(marketMeta.ask,0));
    const quoted=(side==='BUY'?ask:bid)>0?(side==='BUY'?ask:bid):price;
    const spreadBps=bid>0&&ask>0&&((bid+ask)/2)>0?((ask-bid)/((bid+ask)/2))*10000:0;
    const liquidityNotional=Math.max(2500,Math.min(250000,Math.abs(price)*50));
    const liquidityQty=liquidityNotional/Math.max(0.000001,Math.abs(price));
    const impactBps=opts.realistic?Math.min(num(p.execution.impactBpsCap,30),(qty/Math.max(1e-9,liquidityQty))*num(p.execution.impactBpsCap,30)):0;
    const referencePrice=opts.realistic?quoted:price;
    const fill=fillPrice(p,side,referencePrice,num(opts.slippageBps||0)+impactBps),fillValue=qty*fill,c=costs(p,fillValue),slip=Math.abs(fill-referencePrice)*qty;
    const executionLatencyMs=Math.max(0,num(opts.latencyMs,p.execution.latencyMs));
    if(side==='BUY'&&a.cash<fillValue+c.fee)throw new Error('Paper cash limit exceeded');
    if(opts.reduceOnly){const pos=a.positions.find(x=>x.symbol===symbol);if(side==='BUY')throw new Error('Reduce-only BUY is not supported in the long-only paper account.');if(!pos||pos.qty+1e-12<qty)throw new Error('Reduce-only order exceeds paper position.');}
    let realized=updateAgentPosition(a,symbol,side,qty,fill);
    if(side==='BUY')a.cash-=fillValue+c.fee;else a.cash-=c.fee;
    p.realizedPnl+=realized-c.fee;p.fees+=c.fee;p.slippage+=slip;
    const filledAt=now();
    const o={id:uid('order'),clientOrderId:clientOrderId||null,parentOrderId:opts.parentOrderId||null,agentId,symbol,side,qty,requestedPrice:price,quoteBid:bid||null,quoteAsk:ask||null,spreadBps:+spreadBps.toFixed(2),marketImpactBps:+impactBps.toFixed(2),executionLatencyMs,fillPrice:+fill.toFixed(6),value:+fillValue.toFixed(2),fees:+c.fee.toFixed(2),slippage:+slip.toFixed(2),realizedPnl:+realized.toFixed(2),reason:reason||'Paper decision',decisionId:linkedDecision?.id||opts.decisionId||null,decisionAction:String(opts.decisionAction||linkedDecision?.action||'').toUpperCase()||null,decisionConfidence:linkedDecision?num(linkedDecision.confidence,null):num(opts.decisionConfidence,null),decisionEdge:linkedDecision?num(linkedDecision.edge,null):num(opts.decisionEdge,null),decisionAt:linkedDecision?.time||null,orderType:opts.orderType||'MARKET',stopPrice:num(opts.stopPrice),targetPrice:num(opts.targetPrice),reduceOnly:Boolean(opts.reduceOnly),source:opts.source||'PAPER',status:'FILLED',time:now(),filledAt,virtualOnly:true};
    if(opts.parentOrderId){
      p.journal.unshift({...o,type:'PAPER_FILL',executionModel:opts.realistic?'REALISTIC':'BASELINE'});
    }else{
      p.orders.unshift(o);
      p.journal.unshift({...o,type:'PAPER_ORDER'});
    }
    a.decisions++;p.updatedAt=now();return o;
  }
  function placeOrder(state,agentId,symbol,side,qty,orderType,price,stop,target,reason,timeInForce='GTC',expiresAt=null,trailingPercent=0,options={}){
    const p=ensure(state),a=p.agents.find(x=>x.id===agentId);if(!a)throw new Error('Paper agent not found');
    const ot=String(orderType||'MARKET').toUpperCase(),ss=String(side||'').toUpperCase(),oq=normalizeQty(symbol,qty);
    if(options.clientOrderId){
      const existing=p.orders.find(x=>x.clientOrderId===String(options.clientOrderId));
      if(existing)return existing;
      const existingOpen=p.openOrders.find(x=>x.clientOrderId===String(options.clientOrderId));
      if(existingOpen)return existingOpen;
    }
    if(!['BUY','SELL'].includes(ss))throw new Error('Valid side is required');
    if(oq<=0)throw new Error('Order quantity must be positive');
    if(!['MARKET','LIMIT','STOP','STOP_LIMIT','TRAILING_STOP'].includes(ot))throw new Error('Unsupported paper order type');
    if(ot==='MARKET')return paperOrder(state,agentId,symbol,ss,oq,num(price),reason,{orderType:'MARKET',stopPrice:stop,targetPrice:target,...options});
    if((ot==='LIMIT'||ot==='STOP_LIMIT')&&!num(price))throw new Error('Limit price required');
    if((ot==='STOP'||ot==='STOP_LIMIT')&&!num(stop))throw new Error('Stop price required');
    if(ot==='TRAILING_STOP'&&!num(trailingPercent))throw new Error('Trailing percent required');
    const tif=String(timeInForce||'GTC').toUpperCase();
    if(!['GTC','DAY','IOC','FOK'].includes(tif))throw new Error('Unsupported paper time-in-force');
    const exp=expiresAt?Number(expiresAt):(tif==='DAY'?Date.now()+24*60*60*1000:null);
    const referencePrice=ot==='STOP'||ot==='TRAILING_STOP'?num(stop)||num(price):ot==='STOP_LIMIT'?num(price):num(price);
    if(options.enforceRisk){
      const gate=preTradeCheck(state,{agentId,symbol,side:ss,qty:oq,entryPrice:referencePrice,stopPrice:stop,targetPrice:target,marketMeta:options.marketMeta});
      if(gate.status==='BLOCK')throw new Error('Pre-trade risk block: '+gate.reasons.join(' '));
    }
    const reservePrice=ot==='STOP_LIMIT'?Math.max(num(price),num(stop)):referencePrice;
    if(ss==='BUY'){
      const estimated=oq*reservePrice*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000);
      if(!(reservePrice>0)||a.cash-reservedBuyCash(state,agentId) < estimated-1e-9)throw new Error('Paper buying power reserved by existing orders or insufficient cash.');
    }else{
      const pos=a.positions.find(x=>x.symbol===symbol);
      if(!pos||pos.qty+1e-12<oq)throw new Error('SELL quantity exceeds the current paper position.');
    }
    const trailingPct=ot==='TRAILING_STOP'?Math.max(0.01,num(trailingPercent)):0;
    const o={id:uid('order'),clientOrderId:options.clientOrderId?String(options.clientOrderId):null,agentId,symbol,side:ss,qty:oq,orderType:ot,limitPrice:num(price),stopPrice:num(stop),targetPrice:num(target),trailingPercent:trailingPct,trailHigh:null,trailLow:null,reduceOnly:Boolean(options.reduceOnly),bracketRole:options.bracketRole||null,bracketGroup:options.bracketGroup||null,parentId:options.parentId||null,reason:reason||'Paper order',source:options.source||'PAPER',status:'OPEN',time:now(),timeInForce:tif,expiresAt:exp,virtualOnly:true,filledQty:0,remainingQty:oq,amendments:0};
    p.openOrders.unshift(o);p.orders.unshift(o);p.journal.unshift({...o,type:'PAPER_ORDER_PLACED'});p.updatedAt=now();return o;
  }
  function expirePaperOrders(state,at=Date.now()){
    const p=ensure(state),ts=Number(at)||Date.now();
    p.openOrders=p.openOrders.filter(o=>{
      if(o.timeInForce==='GTC'||!o.expiresAt||ts<Number(o.expiresAt))return true;
      o.status='EXPIRED';o.expiredAt=now();
      const ledger=p.orders.find(x=>x.id===o.id);if(ledger)Object.assign(ledger,{status:'EXPIRED',expiredAt:o.expiredAt});
      p.journal.unshift({...o,type:'PAPER_ORDER_EXPIRED'});return false;
    });p.updatedAt=now();return p.openOrders;
  }
  function reservedBuyCash(state,agentId,excludeOrderId=null){
    const p=ensure(state),a=p.agents.find(x=>x.id===agentId);if(!a)return 0;
    return p.openOrders.filter(o=>o.agentId===agentId&&o.side==='BUY'&&o.status==='OPEN'&&o.id!==excludeOrderId).reduce((n,o)=>{
      const px=Math.max(num(o.limitPrice),num(o.stopPrice),num(o.requestedPrice));return n+Math.max(0,num(o.remainingQty??o.qty))*px*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000);
    },0);
  }
  const TERMINAL_ORDER_STATES=new Set(['FILLED','CANCELLED','REJECTED','EXPIRED']);
  function orderEvent(p,o,type,extra={}){
    const at=now();o.lastEvent=type;o.lastEventAt=at;o.eventSeq=Number(o.eventSeq||0)+1;
    o.events=Array.isArray(o.events)?o.events:[];o.events.push({seq:o.eventSeq,type,at,...extra});if(o.events.length>32)o.events=o.events.slice(-32);
    p.journal.unshift({...o,type:'PAPER_EXECUTION_EVENT',event:type,eventAt:at,...extra});
  }
  function reconcileOrders(state){
    const p=ensure(state),map=new Map();
    p.orders.forEach(o=>{if(!o||!o.id)return;const id=String(o.id);if(!map.has(id))map.set(id,o);else Object.assign(map.get(id),o)});
    p.openOrders.forEach(o=>{if(!o||!o.id)return;const id=String(o.id);if(map.has(id))Object.assign(map.get(id),o);else map.set(id,o)});
    p.orders=[...map.values()];
    const active=[];
    p.orders.forEach(o=>{
      if(!o||!o.id)return;
      o.qty=Math.max(0,num(o.qty));o.filledQty=Math.max(0,Math.min(o.qty,num(o.filledQty)));o.remainingQty=Math.max(0,o.qty-o.filledQty);
      if(!o.status)o.status=o.filledQty>0&&o.remainingQty>0?'PARTIALLY_FILLED':'OPEN';
      if(o.status==='OPEN'&&o.remainingQty===0)o.status='FILLED';
      if(o.status==='PARTIALLY_FILLED'&&o.remainingQty<=0)o.status='FILLED';
      if(!TERMINAL_ORDER_STATES.has(o.status))active.push(o);
    });
    p.openOrders=active;
    p.execution.reconciledAt=now();p.updatedAt=now();
    return {openOrders:active.length,filled:p.orders.filter(o=>o.status==='FILLED').length,partial:p.orders.filter(o=>o.status==='PARTIALLY_FILLED').length,terminal:p.orders.filter(o=>TERMINAL_ORDER_STATES.has(o.status)).length,timestamp:p.execution.reconciledAt};
  }
  function processOpenOrders(state,prices,marketMeta={}){
    const p=ensure(state),fills=[];expirePaperOrders(state);reconcileOrders(state);const px=prices||p.marketSnapshot||{};
    const tickKey=marketMeta?.seq!=null?String(marketMeta.seq):(marketMeta?.receivedAt||marketMeta?.asOf||null);
    if(tickKey&&p.execution.lastTick===tickKey)return fills;
    const hasMarketMeta=Boolean(marketMeta&&Object.keys(marketMeta).length);const quoteAge=hasMarketMeta?estimateQuoteAgeSec(marketMeta):null;if(hasMarketMeta&&(marketMeta.executionEligible!==true||marketMeta.verified!==true||marketMeta.sourceTimestampType!=='PROVIDER_TIMESTAMP'||quoteAge===null||quoteAge>30)){if(tickKey)p.execution.lastTick=tickKey;return fills;}
    if(hasMarketMeta&&quoteAge>10){/* quote is still usable but surfaced as aged by the risk gate */}
    if(tickKey)p.execution.lastTick=tickKey;
    p.execution.tickCount=Math.max(0,num(p.execution.tickCount,0))+1;
    p.execution.lastTickAt=now();
    p.openOrders=[...p.openOrders].filter(o=>{
      const price=num(px[o.symbol]);if(!price)return true;
      const bid=Math.max(0,num(marketMeta?.bid,price)),ask=Math.max(0,num(marketMeta?.ask,price));
      const triggerPx=o.side==='BUY'?ask:bid;
      let trigger=false;
      if(o.orderType==='LIMIT')trigger=o.side==='BUY'?ask<=o.limitPrice:bid>=o.limitPrice;
      if(o.orderType==='STOP')trigger=o.side==='BUY'?ask>=o.stopPrice:bid<=o.stopPrice;
      if(o.orderType==='STOP_LIMIT'){
        const triggered=o.side==='BUY'?ask>=o.stopPrice:bid<=o.stopPrice;
        const withinLimit=o.side==='BUY'?ask<=o.limitPrice:bid>=o.limitPrice;
        trigger=triggered&&withinLimit;
      }
      if(o.orderType==='TRAILING_STOP'){
        if(o.side==='SELL'){o.trailHigh=Math.max(num(o.trailHigh,triggerPx),triggerPx);o.stopPrice=o.trailHigh*(1-num(o.trailingPercent)/100);trigger=bid<=o.stopPrice;}
        else{o.trailLow=o.trailLow==null?triggerPx:Math.min(num(o.trailLow,triggerPx),triggerPx);o.stopPrice=o.trailLow*(1+num(o.trailingPercent)/100);trigger=ask>=o.stopPrice;}
      }
      if(!trigger)return true;
      try{
        const remaining=normalizeQty(o.symbol,Math.max(0,num(o.remainingQty??o.qty)));
        if(remaining<=0){o.status='FILLED';return false;}
        const a=p.agents.find(x=>x.id===o.agentId);if(!a)throw new Error('Paper agent not found');
        const liquidityNotional=Math.max(2500,Math.min(250000,Math.abs(price)*50));
        const liquidityQty=normalizeQty(o.symbol,liquidityNotional/Math.max(0.000001,Math.abs(price)));
        let fillQty=Math.min(remaining,liquidityQty);
        if(o.timeInForce==='FOK'&&fillQty+1e-12<remaining)throw new Error('FOK not fully fillable at current simulated liquidity.');
        if(o.side==='BUY'&&(o.timeInForce==='FOK'||o.timeInForce==='IOC')){
          const availableCash=Math.max(0,a.cash-reservedBuyCash(state,o.agentId,o.id));
          const unitCost=Math.max(0.000001,price*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000));
          const cashQty=normalizeQty(o.symbol,availableCash/unitCost);
          fillQty=Math.min(fillQty,cashQty);
          if(o.timeInForce==='FOK'&&fillQty+1e-12<remaining)throw new Error('FOK not fully cash-funded.');
        }
        if(o.timeInForce==='IOC'&&o.reduceOnly){
          const pos=a.positions.find(x=>x.symbol===o.symbol);fillQty=Math.min(fillQty,pos?pos.qty:0);
        }
        if(o.reduceOnly){
          const pos=a.positions.find(x=>x.symbol===o.symbol);if(!pos||pos.qty+1e-12<fillQty)throw new Error('Reduce-only order exceeds position');
        }
        if(fillQty<=0){o.status='CANCELLED';o.cancelledAt=now();const ledger=p.orders.find(x=>x.id===o.id);if(ledger)Object.assign(ledger,{status:'CANCELLED',cancelledAt:o.cancelledAt});p.journal.unshift({...o,type:'PAPER_ORDER_CANCELLED'});return false;}
        let executionPrice=o.side==='BUY'?ask:bid;
        if(o.orderType==='LIMIT'||o.orderType==='STOP_LIMIT'){
          executionPrice=o.side==='BUY'?Math.min(ask,o.limitPrice):Math.max(bid,o.limitPrice);
        }
        const depthBps=Math.min(25,Math.max(0,(remaining-fillQty)/Math.max(1e-9,remaining)*12));
        const f=paperOrder(state,o.agentId,o.symbol,o.side,fillQty,executionPrice,o.reason,{orderType:o.orderType,slippageBps:depthBps,parentOrderId:o.id,reduceOnly:o.reduceOnly,source:o.source,realistic:true,marketMeta:{...marketMeta,bid,ask,price,seq:tickKey}});
        // Keep the parent order as a broker-style execution record too: preserve
        // the actual quote that triggered the fill for audit/reconciliation.
        o.quoteBid=bid;o.quoteAsk=ask;o.spreadBps=+(((ask-bid)/Math.max(0.000001,(ask+bid)/2))*10000).toFixed(2);
        o.marketImpactBps=num(f.marketImpactBps);o.executionLatencyMs=num(f.executionLatencyMs);
        o.filledQty=(o.filledQty||0)+fillQty;o.remainingQty=Math.max(0,o.qty-o.filledQty);o.lastFillAt=now();o.lastFillPrice=f.fillPrice;o.avgFillPrice=o.avgFillPrice?((o.avgFillPrice*(o.filledQty-fillQty)+f.fillPrice*fillQty)/o.filledQty):f.fillPrice;o.fees=(num(o.fees)+num(f.fees));o.slippage=(num(o.slippage)+num(f.slippage));o.realizedPnl=(num(o.realizedPnl)+num(f.realizedPnl));fills.push({...f,parentOrderId:o.id});
        if(o.remainingQty===0){o.status='FILLED';o.filledAt=now();orderEvent(p,o,'FILLED',{fillQty,fillPrice:f.fillPrice,remainingQty:0});if(o.bracketRole==='ENTRY'&&o.bracket)activateBracketChildren(state,o,o.filledQty||o.qty);if(o.bracketRole&&o.bracketRole!=='ENTRY')cancelOco(state,o.id);return false}
        if(o.timeInForce==='IOC'){o.status='CANCELLED';o.cancelledAt=now();orderEvent(p,o,'CANCELLED',{reason:'IOC remainder cancelled',remainingQty:o.remainingQty});return false}
        o.status='PARTIALLY_FILLED';orderEvent(p,o,'PARTIALLY_FILLED',{fillQty,fillPrice:f.fillPrice,remainingQty:o.remainingQty});return true;
      }catch(e){o.status='REJECTED';o.error=e.message;orderEvent(p,o,'REJECTED',{error:e.message});return false}
    });return fills;
  }
  function processMarketTick(state,tick={}){
    const p=ensure(state),symbol=String(tick.symbol||tick.ticker||'').toUpperCase(),price=Math.max(0,num(tick.price));
    if(!symbol||price<=0)return {ok:false,error:'Market tick requires symbol and positive price',fills:[],virtualOnly:true};
    const receivedAt=tick.receivedAt||now(),sourceAsOf=tick.sourceAsOf||tick.asOf||null;
    const bid=Math.max(0,num(tick.bid,price)),ask=Math.max(0,num(tick.ask,price)),seq=tick.seq!=null?String(tick.seq):receivedAt;
    const meta={...tick,symbol,price,bid,ask,seq,receivedAt,sourceAsOf,asOf:sourceAsOf,sourceTimestampType:tick.sourceTimestampType||'UNKNOWN_TIMESTAMP',verified:tick.verified===true,executionEligible:tick.executionEligible===true};
    p.marketSnapshot[symbol]=price;
    p.lastMarket={...(p.lastMarket||{}),...tick,symbol,price,bid,ask,receivedAt,sourceAsOf,asOf:sourceAsOf,sourceTimestampType:meta.sourceTimestampType,streamSeq:seq,streamStatus:tick.status||'UNKNOWN',verified:meta.verified,executionEligible:meta.executionEligible,verification:tick.verification||p.lastMarket?.verification||{available:false,providerCount:tick.providerCount||0}};
    const fills=processOpenOrders(state,{[symbol]:price},meta);
    const age=estimateQuoteAgeSec(meta);
    const executionFresh=meta.executionEligible===true && meta.verified===true && meta.sourceTimestampType==='PROVIDER_TIMESTAMP' && age!==null && age<=30;
    let exposure=0,unreal=0;
    p.agents.forEach(a=>a.positions.forEach(pos=>{
      if(executionFresh&&pos.symbol===symbol)pos.last=price;
      const last=Math.max(0,num(pos.last,pos.avg));
      exposure+=pos.qty*last;
      unreal+=(last-pos.avg)*pos.qty;
    }));
    p.unrealizedPnl=+unreal.toFixed(2);
    const riskFills=age!==null&&age<=30&&executionFresh?processRiskExits(state,{[symbol]:price}):[];
    p.execution.lastTick=seq;p.execution.lastTickAt=receivedAt;
    p.journal.unshift({type:'MARKET_TICK',symbol,price,bid,ask,spreadBps:bid>0&&ask>0?+(((ask-bid)/((bid+ask)/2))*10000).toFixed(2):0,seq,receivedAt,sourceAsOf,executionEligible:meta.executionEligible===true,sourceTimestampType:meta.sourceTimestampType,virtualOnly:true});
    if(p.journal.length>500)p.journal=p.journal.slice(0,500);
    reconcileOrders(state);p.updatedAt=now();
    return {ok:true,symbol,price,bid,ask,seq,fills:[...fills,...riskFills],execution:{tickCount:p.execution.tickCount,lastTick:seq},virtualOnly:true};
  }

  function aOf(p,agentId){return p.agents.find(x=>x.id===agentId)||null}
  function amendOrder(state,orderId,changes={}){
    const p=ensure(state),o=p.openOrders.find(x=>x.id===orderId)||p.orders.find(x=>x.id===orderId);
    if(!o)throw new Error('Paper order not found');
    if(TERMINAL_ORDER_STATES.has(o.status))throw new Error('Order is not amendable');
    const old={qty:o.qty,limitPrice:o.limitPrice,stopPrice:o.stopPrice,timeInForce:o.timeInForce};
    const newQty=changes.qty!=null?normalizeQty(o.symbol,changes.qty):o.qty;
    if(newQty<=0||newQty<(o.filledQty||0))throw new Error('Invalid amended quantity');
    const newLimit=changes.limitPrice!=null?num(changes.limitPrice):o.limitPrice;
    const newStop=changes.stopPrice!=null?num(changes.stopPrice):o.stopPrice;
    const newTif=changes.timeInForce!=null?String(changes.timeInForce).toUpperCase():o.timeInForce;
    if(!['GTC','DAY','IOC','FOK'].includes(newTif))throw new Error('Unsupported paper time-in-force');
    if((o.orderType==='LIMIT'||o.orderType==='STOP_LIMIT')&&newLimit<=0)throw new Error('Limit price required');
    if((o.orderType==='STOP'||o.orderType==='STOP_LIMIT')&&newStop<=0)throw new Error('Stop price required');
    const agent=aOf(p,o.agentId);if(!agent)throw new Error('Paper agent not found');
    if(o.side==='BUY'){
      const reservePrice=o.orderType==='STOP_LIMIT'?Math.max(newLimit,newStop):Math.max(newLimit,newStop,o.orderType==='STOP'||o.orderType==='TRAILING_STOP'?newStop:0);
      const required=Math.max(0,newQty-(o.filledQty||0))*reservePrice*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000);
      if(agent.cash-reservedBuyCash(state,o.agentId,o.id)<required-1e-9)throw new Error('Amendment exceeds available paper buying power.');
    }else{
      const pos=agent.positions.find(x=>x.symbol===o.symbol);if(!pos||pos.qty+1e-12<newQty-(o.filledQty||0))throw new Error('Amendment exceeds current paper position.');
    }
    if(changes.clientOrderId&&String(changes.clientOrderId)!==String(o.clientOrderId||'')){
      const duplicate=p.orders.find(x=>String(x.clientOrderId||'')===String(changes.clientOrderId)&&x.id!==o.id);if(duplicate)throw new Error('Client order id already exists.');
      o.clientOrderId=String(changes.clientOrderId);
    }
    o.qty=newQty;o.remainingQty=Math.max(0,newQty-(o.filledQty||0));o.limitPrice=newLimit;o.stopPrice=newStop;o.timeInForce=newTif;
    if(newTif==='DAY'&&!o.expiresAt)o.expiresAt=Date.now()+24*60*60*1000;
    o.amendedAt=now();o.amendments=(o.amendments||0)+1;
    orderEvent(p,o,'AMENDED',{old,newValues:{qty:o.qty,limitPrice:o.limitPrice,stopPrice:o.stopPrice,timeInForce:o.timeInForce},amendments:o.amendments});
    p.updatedAt=now();return o;
  }
  function replaceOrder(state,orderId,changes={}){return amendOrder(state,orderId,changes)}
  function cancelOco(state,filledOrderId){
    const p=ensure(state),o=p.orders.find(x=>x.id===filledOrderId)||p.openOrders.find(x=>x.id===filledOrderId);
    if(!o||!o.bracketGroup)return [];
    const cancelled=[];
    p.openOrders=p.openOrders.filter(x=>{
      if(x.bracketGroup===o.bracketGroup&&x.id!==o.id&&!TERMINAL_ORDER_STATES.has(x.status)){
        x.status='CANCELLED';x.cancelledAt=now();cancelled.push(x.id);
        const ledger=p.orders.find(y=>y.id===x.id);if(ledger&&ledger!==x)Object.assign(ledger,{status:'CANCELLED',cancelledAt:x.cancelledAt});
        orderEvent(p,x,'CANCELLED',{reason:'OCO peer filled'});return false
      }
      return true
    });
    p.updatedAt=now();return cancelled;
  }
  function activateBracketChildren(state,entry,qty){
    const p=ensure(state),group=entry.bracketGroup,bSide=entry.side==='BUY'?'SELL':'BUY',q=normalizeQty(entry.symbol,qty);if(q<=0)return;
    if(num(entry.bracket?.stopPrice)){
      const sl=placeOrder(state,entry.agentId,entry.symbol,bSide,q,'STOP',0,entry.bracket.stopPrice,null,'Bracket stop loss','GTC',null);
      sl.bracketRole='STOP';sl.bracketGroup=group;sl.reduceOnly=true;sl.parentId=entry.id;
    }
    if(num(entry.bracket?.targetPrice)){
      const tp=placeOrder(state,entry.agentId,entry.symbol,bSide,q,'LIMIT',entry.bracket.targetPrice,null,null,'Bracket take profit','GTC',null);
      tp.bracketRole='TARGET';tp.bracketGroup=group;tp.reduceOnly=true;tp.parentId=entry.id;
    }
  }
  function placeBracket(state,agentId,symbol,side,qty,entryType,entryPrice,stopPrice,targetPrice,reason,options={}){
    const p=ensure(state),group=uid('bracket'),et=String(entryType).toUpperCase(),entrySide=String(side).toUpperCase();
    const entry=placeOrder(state,agentId,symbol,entrySide,qty,et,entryPrice,null,null,reason,'GTC',null,0,options);
    entry.bracketRole='ENTRY';entry.bracketGroup=group;entry.bracket={stopPrice:num(stopPrice),targetPrice:num(targetPrice),oco:true};
    if(et==='MARKET') activateBracketChildren(state,entry,qty);
    return entry;
  }
  function placeTrailingStop(state,agentId,symbol,side,qty,trailingPercent,reason){return placeOrder(state,agentId,symbol,side,qty,'TRAILING_STOP',0,null,null,reason||'Trailing stop','GTC',null,trailingPercent,{reduceOnly:true,source:'PAPER_TRAILING_STOP'})}
  function placeOco(state,agentId,symbol,side,qty,limitPrice,stopPrice,reason){const group=uid('oco');const opts={reduceOnly:true,source:'PAPER_OCO',bracketGroup:group};const tp=placeOrder(state,agentId,symbol,side,qty,'LIMIT',limitPrice,null,null,reason||'OCO take profit','GTC',null,0,opts);tp.bracketRole='TARGET';tp.bracketGroup=group;const sl=placeOrder(state,agentId,symbol,side,qty,'STOP',0,stopPrice,null,reason||'OCO stop','GTC',null,0,opts);sl.bracketRole='STOP';sl.bracketGroup=group;return{group,orders:[tp,sl]}}
  function cancelOrder(state,orderId,reason='User cancelled paper order'){
    const p=ensure(state),o=p.openOrders.find(x=>x.id===orderId)||p.orders.find(x=>x.id===orderId);
    if(!o)throw new Error('Paper order not found');
    if(TERMINAL_ORDER_STATES.has(o.status))return o;
    o.status='CANCELLED';o.cancelledAt=now();p.openOrders=p.openOrders.filter(x=>x.id!==orderId);
    const ledger=p.orders.find(x=>x.id===orderId);if(ledger&&ledger!==o)Object.assign(ledger,{status:'CANCELLED',cancelledAt:o.cancelledAt});
    orderEvent(p,o,'CANCELLED',{reason});p.updatedAt=now();return o;
  }
  function attachRisk(position,stop,target){position.stop=num(stop)||null;position.target=num(target)||null;return position}
  function processRiskExits(state,prices){
    const p=ensure(state),px=prices||p.marketSnapshot||{},fills=[];
    p.agents.forEach(a=>a.positions.slice().forEach(pos=>{
      const price=num(px[pos.symbol],pos.last||pos.avg); if(!price||!pos.qty)return;
      const stop=pos.stop,target=pos.target;
      const hitStop=stop&&price<=stop,hitTarget=target&&price>=target;
      if(!hitStop&&!hitTarget)return;
      try{
        const reason=hitStop?'PAPER STOP LOSS':'PAPER TAKE PROFIT';
        const f=paperOrder(state,a.id,pos.symbol,'SELL',pos.qty,price,reason,{orderType:'RISK_EXIT'});
        fills.push(f);
      }catch(e){}
    }));
    return fills;
  }
  function roundTable(state,market){
    const p=ensure(state),active=p.agents.filter(a=>a.enabled),debates=active.map(a=>({agent:a,thought:think(a,market)}));
    const buy=debates.filter(x=>x.thought.action==='BUY').length,sell=debates.filter(x=>x.thought.action==='SELL').length,hold=debates.length-buy-sell;
    const avg=debates.length?debates.reduce((n,x)=>n+x.thought.edge,0)/debates.length:50,risk=clamp(num(market.risk,50));
    const final=buy>sell&&avg>=60&&risk<78?'PAPER BUY':sell>buy&&avg<=40?'PAPER SELL':'PAPER HOLD';
    const confidence=clamp(60+Math.abs(avg-50)*.7+Math.abs(buy-sell)*3-risk*.12);
    const dissent=debates.filter(x=>final.includes('BUY')?x.thought.action==='SELL':final.includes('SELL')?x.thought.action==='BUY':x.thought.action!=='HOLD');
    const r={id:uid('round'),symbol:market.symbol||'SIM',confidence:+confidence.toFixed(1),vote:{buy,sell,hold},avgEdge:+avg.toFixed(1),risk,debates:debates.map(x=>({agentId:x.agent.id,name:x.agent.name,role:x.agent.role,thought:x.thought})),dissent:dissent.map(x=>x.agent.name),time:now(),virtualOnly:true};
    debates.forEach(x=>recordDecision(state,x.agent.id,r.symbol,x.thought.action,{confidence:x.thought.confidence,edge:x.thought.edge,thesis:x.thought.thesis,roundId:r.id,source:'ROUND_TABLE'}));
    p.rounds.unshift(r);p.rounds=p.rounds.slice(0,50);p.journal.unshift({type:'PAPER_ROUND_TABLE',...r});p.updatedAt=now();return r;
  }
  function markToMarket(state,prices){
    const p=ensure(state),px=prices||p.marketSnapshot||{};let exposure=0,unreal=0;
    p.agents.forEach(a=>a.positions.forEach(pos=>{const last=Math.max(0,num(px[pos.symbol],pos.last||pos.avg));pos.last=last;exposure+=pos.qty*last;unreal+=(last-pos.avg)*pos.qty}));
    p.unrealizedPnl=+unreal.toFixed(2);p.marketSnapshot={...p.marketSnapshot,...px};
    const meta=p.lastMarket?.verification?{...p.lastMarket.verification,receivedAt:p.lastMarket.receivedAt||p.lastMarket.asOf,seq:p.lastMarket.streamSeq,asOf:p.lastMarket.asOf}:null;
    const freshEnough=!meta||!meta.receivedAt||estimateQuoteAgeSec(meta)<=30;
    processOpenOrders(state,px,meta||{});if(freshEnough)processRiskExits(state,px);reconcileOrders(state);p.updatedAt=now();const cash=p.agents.reduce((n,a)=>n+a.cash,0);return{exposure:+exposure.toFixed(2),unrealizedPnl:p.unrealizedPnl,equity:+(cash+exposure).toFixed(2)};
  }
  function leaderboard(state){
    const p=ensure(state);return p.agents.map(a=>{const exposure=a.positions.reduce((n,x)=>n+x.qty*x.last,0),equity=a.cash+exposure,pnl=equity-a.capital;return{...a,equity:+equity.toFixed(2),pnl:+pnl.toFixed(2),returnPct:+(pnl/Math.max(1,a.capital)*100).toFixed(2),exposure:+exposure.toFixed(2)}}).sort((a,b)=>b.returnPct-a.returnPct);
  }
  function executionPreview(state,args={}){const p=ensure(state),agent=p.agents.find(x=>x.id===args.agentId),symbol=String(args.symbol||'').toUpperCase(),side=String(args.side||'').toUpperCase(),qty=normalizeQty(symbol,args.qty),price=Math.max(0,num(args.price));if(!agent)return{ok:false,error:'Paper agent not found',virtualOnly:true};const notional=qty*price,fee=notional*p.account.commissionBps/10000,slip=notional*p.account.slippageBps/10000;const reserved=reservedBuyCash(state,agent.id);const buyingPower=Math.max(0,agent.cash-reserved);const position=agent.positions.find(x=>x.symbol===symbol);return{ok:true,virtualOnly:true,agentId:agent.id,symbol,side,qty,price,notional:+notional.toFixed(2),estimatedFee:+fee.toFixed(2),estimatedSlippage:+slip.toFixed(2),buyingPower:+buyingPower.toFixed(2),positionQty:+num(position?.qty).toFixed(8),canBuy:side==='BUY'?(buyingPower>=notional+fee+slip):true,canSell:side==='SELL'?num(position?.qty)>=qty:true,timestamp:now()}}
  function accountSummary(state){
    const p=ensure(state),rows=leaderboard(state),exposure=rows.reduce((n,a)=>n+a.exposure,0),cash=rows.reduce((n,a)=>n+a.cash,0),equity=cash+exposure;
    return{cash:+cash.toFixed(2),equity:+equity.toFixed(2),startingCash:p.startingCash,realizedPnl:+p.realizedPnl.toFixed(2),unrealizedPnl:+p.unrealizedPnl.toFixed(2),exposure:+exposure.toFixed(2),returnPct:+((equity/p.startingCash-1)*100).toFixed(2),fees:+p.fees.toFixed(2),slippage:+p.slippage.toFixed(2),openOrders:p.openOrders.length,filledOrders:p.orders.filter(x=>x.status==='FILLED').length,virtualOnly:true};
  }
  function riskReport(state){
    const p=ensure(state),s=accountSummary(state),eq=Math.max(1,s.equity),concentration={};
    p.agents.flatMap(a=>a.positions).forEach(x=>concentration[x.symbol]=(concentration[x.symbol]||0)+x.qty*x.last);
    const top=Object.entries(concentration).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([symbol,value])=>({symbol,value:+value.toFixed(2),weight:+(value/eq*100).toFixed(1)}));
    return{...s,exposurePct:+(s.exposure/eq*100).toFixed(1),top,virtualOnly:true,limits:{maxSingleSymbolPct:20,maxTotalExposurePct:80}};
  }

  // Execution Quality Intelligence 1.0: telemetry and diagnostics for virtual fills only.
  // Scores are descriptive; they never promote agents or enable live brokerage.
  function executionQualityReport(state){
    const p=ensure(state),filled=p.orders.filter(o=>['FILLED','PARTIAL'].includes(String(o.status||'').toUpperCase())&&num(o.filledQty,o.qty)>0);
    const rows=filled.map(o=>{
      const qty=Math.max(0,num(o.filledQty,o.qty)),price=Math.max(0,num(o.avgFillPrice,o.fillPrice,o.price));
      const bid=Math.max(0,num(o.quoteBid)),ask=Math.max(0,num(o.quoteAsk));
      const mid=bid>0&&ask>0?(bid+ask)/2:0;
      const hasQuote=mid>0&&price>0,side=String(o.side||'BUY').toUpperCase();
      const adverseBps=hasQuote?((side==='BUY'?(price-mid):(mid-price))/mid)*10000:null;
      const spreadBps=bid>0&&ask>=bid?((ask-bid)/Math.max(mid,1e-9))*10000:null;
      const latency=Number.isFinite(Number(o.executionLatencyMs))?Math.max(0,Number(o.executionLatencyMs)):null;
      const impact=Number.isFinite(Number(o.marketImpactBps))?Math.max(0,Number(o.marketImpactBps)):null;
      const requested=Math.max(qty,num(o.qty,qty)),partialRatio=requested>0?Math.max(0,Math.min(1,(requested-qty)/requested)):0;
      const hasFreshness=o.executionEligible!==false&&o.quoteAgeSec!=null;
      const freshness=hasFreshness?(Number(o.quoteAgeSec)<=30?100:0):null;
      const components=[];
      if(adverseBps!=null)components.push({name:'priceVsMid',score:clamp(100-Math.max(0,adverseBps)*4),weight:35});
      if(spreadBps!=null)components.push({name:'spreadCost',score:clamp(100-spreadBps*2),weight:20});
      if(impact!=null)components.push({name:'marketImpact',score:clamp(100-impact*3),weight:15});
      if(latency!=null)components.push({name:'latency',score:clamp(100-latency/10),weight:10});
      if(freshness!=null)components.push({name:'quoteFreshness',score:freshness,weight:10});
      components.push({name:'fillCompleteness',score:100*(1-partialRatio),weight:10});
      const weight=components.reduce((n,c)=>n+c.weight,0);
      const score=weight?+(components.reduce((n,c)=>n+c.score*c.weight,0)/weight).toFixed(1):null;
      return {orderId:o.id,symbol:o.symbol,side,orderType:o.orderType||'MARKET',status:o.status,qty:+qty.toFixed(8),fillPrice:price||null,mid:mid||null,adverseSlippageBps:adverseBps==null?null:+adverseBps.toFixed(2),spreadBps:spreadBps==null?null:+spreadBps.toFixed(2),marketImpactBps:impact,executionLatencyMs:latency,quoteFreshnessScore:freshness,partialFillRatio:+partialRatio.toFixed(4),score,measuredDimensions:components.map(c=>c.name),virtualOnly:true};
    });
    const scored=rows.filter(r=>r.score!=null),avg=arr=>arr.length?+(arr.reduce((n,x)=>n+x,0)/arr.length).toFixed(1):null;
    const slippage=rows.filter(r=>r.adverseSlippageBps!=null).map(r=>r.adverseSlippageBps);
    const latency=rows.filter(r=>r.executionLatencyMs!=null).map(r=>r.executionLatencyMs);
    const impact=rows.filter(r=>r.marketImpactBps!=null).map(r=>r.marketImpactBps);
    const stale=rows.filter(r=>r.quoteFreshnessScore===0).length;
    return {version:'1.0',mode:'PAPER_ONLY',fills:rows.length,scoredFills:scored.length,averageScore:avg(scored.map(r=>r.score)),averageAdverseSlippageBps:avg(slippage),averageLatencyMs:avg(latency),averageMarketImpactBps:avg(impact),staleQuoteFills:stale,partialFillCount:rows.filter(r=>r.partialFillRatio>0).length,rows:rows.slice(0,100),governance:{autoPromotion:false,liveExecution:false,minimumSampleForComparison:30,ready:scored.length>=30&&stale===0},virtualOnly:true};
  }

  function agentExecutionOutcomeReport(state){
    const p=ensure(state),eq=executionQualityReport(state),rows=eq.rows||[],byOrder=new Map(rows.map(r=>[String(r.orderId),r])),filled=p.orders.filter(o=>['FILLED','PARTIALLY_FILLED'].includes(String(o.status||'').toUpperCase()));
    const groups=new Map();
    const ensureGroup=(a)=>{const id=a?.id||'UNKNOWN';if(!groups.has(id))groups.set(id,{agentId:id,agentName:a?.name||id,role:a?.role||'Specialist',fills:0,scoredFills:0,decisionLinked:0,closedOutcomes:0,wins:0,losses:0,breakeven:0,realizedPnl:0,netRealizedPnl:0,unrealizedPnl:0,fees:0,slippage:0,executionScores:[],symbols:new Set(),decisions:new Map()});return groups.get(id)};
    filled.forEach(o=>{
      const g=ensureGroup(p.agents.find(a=>a.id===o.agentId));g.fills++;g.symbols.add(o.symbol);
      const gross=num(o.realizedPnl);const fees=num(o.fees);g.realizedPnl+=gross;g.netRealizedPnl+=gross-fees;g.fees+=fees;g.slippage+=num(o.slippage);
      const xr=byOrder.get(String(o.id));if(xr?.score!=null){g.scoredFills++;g.executionScores.push(xr.score)}
      if(o.decisionId){
        g.decisionLinked++;
        const decisionKey=String(o.decisionId);
        const d=g.decisions.get(decisionKey)||{decisionId:decisionKey,symbol:o.symbol,firstFillAt:o.filledAt||o.time||'',lastFillAt:o.filledAt||o.time||'',grossPnl:0,fees:0,fillCount:0,actions:new Set()};
        d.grossPnl+=gross;d.fees+=fees;d.fillCount++;d.lastFillAt=String(o.filledAt||o.time||d.lastFillAt);
        if(o.decisionAction)d.actions.add(String(o.decisionAction));
        g.decisions.set(decisionKey,d);
      }
    });
    p.agents.forEach(a=>{const g=ensureGroup(a);g.unrealizedPnl+=a.positions.reduce((n,pos)=>n+(num(pos.last)-num(pos.avg))*num(pos.qty),0)});
    const agents=[...groups.values()].map(g=>{
      const avg=arr=>arr.length?+(arr.reduce((n,x)=>n+x,0)/arr.length).toFixed(2):null;
      const outcomes=[...g.decisions.values()].map(d=>({...d,netPnl:d.grossPnl-d.fees,actions:[...d.actions]})).sort((a,b)=>Date.parse(a.lastFillAt||0)-Date.parse(b.lastFillAt||0));
      let equity=0,peak=0,maxDrawdown=0;
      outcomes.forEach(d=>{equity+=d.netPnl;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);if(d.netPnl>0)g.wins++;else if(d.netPnl<0)g.losses++;else g.breakeven++;});
      g.closedOutcomes=outcomes.length;
      const winRate=g.closedOutcomes?g.wins/g.closedOutcomes*100:null;
      const decisionAccuracy=winRate===null?null:+winRate.toFixed(1);
      const expectancy=outcomes.length?outcomes.reduce((n,d)=>n+d.netPnl,0)/outcomes.length:null;
      const grossWins=outcomes.filter(d=>d.netPnl>0).reduce((n,d)=>n+d.netPnl,0);
      const grossLosses=Math.abs(outcomes.filter(d=>d.netPnl<0).reduce((n,d)=>n+d.netPnl,0));
      const profitFactor=grossLosses>0?grossWins/grossLosses:(grossWins>0?null:0);
      const executionScore=avg(g.executionScores),decisionOutcomeScore=decisionAccuracy,coverage=g.fills?+(g.decisionLinked/g.fills*100).toFixed(1):0;
      const qualityParts=[];if(executionScore!=null)qualityParts.push({score:executionScore,weight:60});if(decisionAccuracy!=null)qualityParts.push({score:decisionAccuracy,weight:40});
      const combinedScore=qualityParts.length?+(qualityParts.reduce((n,x)=>n+x.score*x.weight,0)/qualityParts.reduce((n,x)=>n+x.weight,0)).toFixed(1):null;
      const sampleReady=g.scoredFills>=30&&g.closedOutcomes>=30&&g.decisionLinked>=30;
      return {agentId:g.agentId,agentName:g.agentName,role:g.role,fills:g.fills,scoredFills:g.scoredFills,decisionLinked:g.decisionLinked,decisionCoverage:coverage,closedOutcomes:g.closedOutcomes,wins:g.wins,losses:g.losses,breakeven:g.breakeven,winRate:decisionAccuracy,realizedPnl:+g.realizedPnl.toFixed(2),netRealizedPnl:+g.netRealizedPnl.toFixed(2),unrealizedPnl:+g.unrealizedPnl.toFixed(2),fees:+g.fees.toFixed(2),slippage:+g.slippage.toFixed(2),expectancyPerDecision:expectancy===null?null:+expectancy.toFixed(2),profitFactor:profitFactor===null?null:+profitFactor.toFixed(3),maxDrawdown:+maxDrawdown.toFixed(2),executionQualityScore:executionScore,decisionOutcomeScore,combinedOutcomeScore:combinedScore,symbols:[...g.symbols],trainingReviewEligible:sampleReady,trainingReviewReason:sampleReady?'MINIMUM_SAMPLE_MET':'Need 30 scored fills and 30 distinct linked decisions',virtualOnly:true};
    }).sort((a,b)=>(b.combinedOutcomeScore??b.executionQualityScore??-1)-(a.combinedOutcomeScore??a.executionQualityScore??-1));
    return {version:'2.0',mode:'PAPER_AGENT_OUTCOMES',agents,governance:{autoPromotion:false,productionMutation:false,minimumScoredFills:30,minimumClosedOutcomes:30,minimumLinkedDecisions:30,outcomeUnit:'Distinct decisionId; partial fills are aggregated; breakeven decisions count',netPnl:'Gross realized P&L less recorded fees; slippage is already reflected in simulated fill prices and is reported separately, not subtracted twice.',notes:'Outcome data is evaluation telemetry only. This report is not proof of future profitability.'},virtualOnly:true};
  }
  window.FinPilotPaperCore={defaultPaper,ensure,ensureAgent,think,qtyStep,normalizeQty,preTradeCheck,paperOrder,placeOrder,processOpenOrders,processMarketTick,processRiskExits,amendOrder,replaceOrder,reconcileOrders,placeBracket,placeTrailingStop,placeOco,cancelOco,cancelOrder,expirePaperOrders,attachRisk,roundTable,markToMarket,leaderboard,executionPreview,accountSummary,riskReport,executionQualityReport,recordDecision,agentExecutionOutcomeReport};
})();