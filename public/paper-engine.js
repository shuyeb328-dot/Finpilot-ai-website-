/* FinPilot Paper Trading Engine V2
   Broker-style simulation only. No broker connection, no real-money execution. */
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
  const num=(n,d=0)=>Number.isFinite(Number(n))?Number(n):d;
  const uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const now=()=>new Date().toISOString();
  function defaultPaper(){return{
    version:2,baseCurrency:'INR',startingCash:1000000,cash:1000000,realizedPnl:0,unrealizedPnl:0,
    fees:0,slippage:0,agents:[],positions:[],orders:[],openOrders:[],journal:[],rounds:[],
    leaderboard:[],marketSnapshot:{},account:{marginEnabled:false,leverage:1,commissionBps:8,slippageBps:3},
    updatedAt:now()
  }}
  function ensure(state){
    if(!state.paperTrading)state.paperTrading=defaultPaper();
    const p=state.paperTrading;
    p.agents=(Array.isArray(p.agents)?p.agents:[]).filter(a=>a&&typeof a==='object');p.positions=(Array.isArray(p.positions)?p.positions:[]).filter(x=>x&&typeof x==='object');p.orders=(Array.isArray(p.orders)?p.orders:[]).filter(x=>x&&typeof x==='object');
    p.openOrders=(Array.isArray(p.openOrders)?p.openOrders:[]).filter(x=>x&&typeof x==='object');p.journal=Array.isArray(p.journal)?p.journal:[];p.rounds=Array.isArray(p.rounds)?p.rounds:[];p.leaderboard=Array.isArray(p.leaderboard)?p.leaderboard:[];
    p.marketSnapshot=p.marketSnapshot&&typeof p.marketSnapshot==='object'?p.marketSnapshot:{};
    // Repair older/partial local paper state before any numeric formatter is called.
    p.version=num(p.version,2); p.startingCash=num(p.startingCash,1000000);
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
  function paperOrder(state,agentId,symbol,side,qty,price,reason,opts={}){
    const p=ensure(state),a=p.agents.find(x=>x.id===agentId);if(!a)throw new Error('Paper agent not found');
    qty=Math.max(0,Math.floor(num(qty)));price=Math.max(0,num(price));side=String(side).toUpperCase();
    if(!qty||!price||!['BUY','SELL'].includes(side))throw new Error('Valid side, quantity and price are required');
    const fill=fillPrice(p,side,price,num(opts.slippageBps||0)),fillValue=qty*fill,c=costs(p,fillValue),slip=Math.abs(fill-price)*qty;
    if(side==='BUY'&&a.cash<fillValue+c.fee)throw new Error('Paper cash limit exceeded');
    let realized=updateAgentPosition(a,symbol,side,qty,fill);
    if(side==='BUY')a.cash-=fillValue+c.fee;else a.cash-=c.fee;
    p.realizedPnl+=realized-c.fee;p.fees+=c.fee;p.slippage+=slip;
    const o={id:uid('order'),agentId,symbol,side,qty,requestedPrice:price,fillPrice:+fill.toFixed(6),value:+fillValue.toFixed(2),fees:+c.fee.toFixed(2),slippage:+slip.toFixed(2),realizedPnl:+realized.toFixed(2),reason:reason||'Paper decision',orderType:opts.orderType||'MARKET',status:'FILLED',time:now(),virtualOnly:true};
    p.orders.unshift(o);p.journal.unshift({...o,type:'PAPER_ORDER'});a.decisions++;p.updatedAt=now();return o;
  }
  function placeOrder(state,agentId,symbol,side,qty,orderType,price,stop,target,reason,timeInForce='GTC',expiresAt=null){
    if(String(orderType).toUpperCase()==='MARKET')return paperOrder(state,agentId,symbol,side,qty,price,reason,{orderType:'MARKET'});
    const p=ensure(state);const a=p.agents.find(x=>x.id===agentId);if(!a)throw new Error('Paper agent not found');
    const tif=String(timeInForce||'GTC').toUpperCase();
    if(!['GTC','DAY','IOC','FOK'].includes(tif))throw new Error('Unsupported paper time-in-force');
    const exp=expiresAt?Number(expiresAt):(tif==='DAY'?Date.now()+24*60*60*1000:null);
    const oq=Math.floor(num(qty));if(oq<1)throw new Error('Order quantity must be positive');const ot=String(orderType).toUpperCase();if(!['MARKET','LIMIT','STOP','STOP_LIMIT','TRAILING_STOP'].includes(ot))throw new Error('Unsupported paper order type');if((ot==='LIMIT'||ot==='STOP_LIMIT')&&!num(price))throw new Error('Limit price required');if((ot==='STOP'||ot==='STOP_LIMIT')&&!num(stop))throw new Error('Stop price required');if(ot==='TRAILING_STOP'&&!num(arguments[9]))throw new Error('Trailing percent required');const trailingPercent=ot==='TRAILING_STOP'?Math.max(0.01,num(arguments[9])):0; const o={id:uid('order'),agentId,symbol,side:String(side).toUpperCase(),qty:oq,orderType:ot,limitPrice:num(price),stopPrice:num(stop),targetPrice:num(target),trailingPercent,trailHigh:null,trailLow:null,reason:reason||'Paper order',status:'OPEN',time:now(),timeInForce:tif,expiresAt:exp,virtualOnly:true,filledQty:0,remainingQty:oq};
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
  function reservedBuyCash(state,agentId){
    const p=ensure(state),a=p.agents.find(x=>x.id===agentId);if(!a)return 0;
    return p.openOrders.filter(o=>o.agentId===agentId&&o.side==='BUY'&&o.status==='OPEN').reduce((n,o)=>{
      const px=num(o.limitPrice||o.stopPrice||o.requestedPrice);return n+(o.remainingQty||o.qty)*px*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000);
    },0);
  }
  function processOpenOrders(state,prices){
    const p=ensure(state),fills=[];expirePaperOrders(state);const px=prices||p.marketSnapshot||{};
    p.openOrders=[...p.openOrders].filter(o=>{
      const price=num(px[o.symbol]);if(!price)return true;
      let trigger=false;
      if(o.orderType==='LIMIT')trigger=o.side==='BUY'?price<=o.limitPrice:price>=o.limitPrice;
      if(o.orderType==='STOP')trigger=o.side==='BUY'?price>=o.stopPrice:price<=o.stopPrice;
      if(o.orderType==='STOP_LIMIT'){const triggered=o.side==='BUY'?price>=o.stopPrice:price<=o.stopPrice;const withinLimit=o.side==='BUY'?price<=o.limitPrice:price>=o.limitPrice;trigger=triggered&&withinLimit;} if(o.orderType==='TRAILING_STOP'){if(o.side==='SELL'){o.trailHigh=Math.max(num(o.trailHigh,price),price);o.stopPrice=o.trailHigh*(1-num(o.trailingPercent)/100);trigger=price<=o.stopPrice;}else{o.trailLow=o.trailLow==null?price:Math.min(num(o.trailLow,price),price);o.stopPrice=o.trailLow*(1+num(o.trailingPercent)/100);trigger=price>=o.stopPrice;}}
      if(!trigger)return true;
      try{
        const remaining=Math.max(0,Number(o.remainingQty??o.qty));
        if(!remaining) {o.status='FILLED';return false;}
        const a=p.agents.find(x=>x.id===o.agentId);if(!a)throw new Error('Paper agent not found');
        let fillQty=remaining; const liquidity=Math.max(1,Math.floor(Math.abs(price)*0.02/Math.max(0.000001,price)*100)); fillQty=Math.min(fillQty,Math.max(1,liquidity));
        if(o.timeInForce==='FOK'){
          if(o.side==='BUY'){
            const available=Math.max(0,a.cash-reservedBuyCash(state,o.agentId)+remaining*price*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000));
            if(available < remaining*price*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000))throw new Error('FOK not fully fillable');
          }else if(o.reduceOnly){
            const pos=a.positions.find(x=>x.symbol===o.symbol);if(!pos||pos.qty<remaining)throw new Error('FOK not fully fillable');
          }
        }else if(o.timeInForce==='IOC'&&o.side==='BUY'){
          const availableCash=Math.max(0,a.cash-reservedBuyCash(state,o.agentId)+remaining*price*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000));
          fillQty=Math.min(remaining,Math.floor(availableCash/Math.max(0.000001,price*(1+num(p.account.commissionBps)/10000+num(p.account.slippageBps)/10000))));
        }else if(o.timeInForce==='IOC'&&o.reduceOnly){
          const pos=a.positions.find(x=>x.symbol===o.symbol);fillQty=Math.min(remaining,pos?pos.qty:0);
        }
        if(o.reduceOnly){const pos=a.positions.find(x=>x.symbol===o.symbol);if(!pos||pos.qty<fillQty)throw new Error('Reduce-only order exceeds position');}
        if(fillQty<1){o.status='CANCELLED';o.cancelledAt=now();return false;}
        const depthBps=Math.min(25,Math.max(0,(remaining-fillQty)/Math.max(1,remaining)*12)); const f=paperOrder(state,o.agentId,o.symbol,o.side,fillQty,price,o.reason,{orderType:o.orderType,slippageBps:depthBps});
        o.filledQty=(o.filledQty||0)+fillQty;o.remainingQty=Math.max(0,o.qty-o.filledQty);o.lastFillAt=now();fills.push(f);
        if(o.remainingQty===0){o.status='FILLED';o.filledAt=now();if(o.bracketRole==='ENTRY'&&o.bracket)activateBracketChildren(state,o,o.filledQty||o.qty);if(o.bracketRole&&o.bracketRole!=='ENTRY')cancelOco(state,o.id);return false}
        if(o.timeInForce==='IOC'){o.status='CANCELLED';o.cancelledAt=now();const ledger=p.orders.find(x=>x.id===o.id);if(ledger)Object.assign(ledger,{status:'CANCELLED',cancelledAt:o.cancelledAt});p.journal.unshift({...o,type:'PAPER_ORDER_CANCELLED'});return false}
        o.status='PARTIALLY_FILLED';return true;
      }catch(e){o.status='REJECTED';o.error=e.message;const ledger=p.orders.find(x=>x.id===o.id);if(ledger)Object.assign(ledger,{status:'REJECTED',error:o.error});return false}
    });return fills;
  }
  function amendOrder(state,orderId,changes={}){
    const p=ensure(state),o=p.openOrders.find(x=>x.id===orderId);
    if(!o)throw new Error('Open paper order not found');
    if(o.status==='CANCELLED'||o.status==='FILLED')throw new Error('Order is not amendable');
    if(changes.qty!=null){const q=Math.floor(num(changes.qty));if(q<1||q<(o.filledQty||0))throw new Error('Invalid amended quantity');o.qty=q}
    if(changes.limitPrice!=null)o.limitPrice=num(changes.limitPrice);
    if(changes.stopPrice!=null)o.stopPrice=num(changes.stopPrice);
    o.amendedAt=now();o.amendments=(o.amendments||0)+1;
    p.journal.unshift({...o,type:'PAPER_ORDER_AMENDED'});p.updatedAt=now();return o;
  }
  function cancelOco(state,filledOrderId){
    const p=ensure(state),o=p.orders.find(x=>x.id===filledOrderId)||p.openOrders.find(x=>x.id===filledOrderId);
    if(!o||!o.bracketGroup)return [];
    const cancelled=[];
    p.openOrders=p.openOrders.filter(x=>{
      if(x.bracketGroup===o.bracketGroup&&x.id!==o.id&&x.status==='OPEN'){
        x.status='CANCELLED';x.cancelledAt=now();cancelled.push(x.id);
        const ledger=p.orders.find(y=>y.id===x.id);
        if(ledger)Object.assign(ledger,{status:'CANCELLED',cancelledAt:x.cancelledAt});
        p.journal.unshift({...x,type:'PAPER_OCO_CANCELLED'});
        return false
      }
      return true
    });
    p.updatedAt=now();return cancelled;
  }
  function activateBracketChildren(state,entry,qty){
    const p=ensure(state),group=entry.bracketGroup,bSide=entry.side==='BUY'?'SELL':'BUY',q=Math.max(1,Math.floor(num(qty)));
    if(num(entry.bracket?.stopPrice)){
      const sl=placeOrder(state,entry.agentId,entry.symbol,bSide,q,'STOP',0,entry.bracket.stopPrice,null,'Bracket stop loss','GTC',null);
      sl.bracketRole='STOP';sl.bracketGroup=group;sl.reduceOnly=true;sl.parentId=entry.id;
    }
    if(num(entry.bracket?.targetPrice)){
      const tp=placeOrder(state,entry.agentId,entry.symbol,bSide,q,'LIMIT',entry.bracket.targetPrice,null,null,'Bracket take profit','GTC',null);
      tp.bracketRole='TARGET';tp.bracketGroup=group;tp.reduceOnly=true;tp.parentId=entry.id;
    }
  }
  function placeBracket(state,agentId,symbol,side,qty,entryType,entryPrice,stopPrice,targetPrice,reason){
    const p=ensure(state),group=uid('bracket'),et=String(entryType).toUpperCase(),entrySide=String(side).toUpperCase();
    const entry=placeOrder(state,agentId,symbol,entrySide,qty,et,entryPrice,null,null,reason,'GTC',null);
    entry.bracketRole='ENTRY';entry.bracketGroup=group;entry.bracket={stopPrice:num(stopPrice),targetPrice:num(targetPrice),oco:true};
    if(et==='MARKET') activateBracketChildren(state,entry,qty);
    return entry;
  }
  function cancelOrder(state,orderId){
    const p=ensure(state),o=p.openOrders.find(x=>x.id===orderId);
    if(!o)throw new Error('Open paper order not found');
    o.status='CANCELLED';o.cancelledAt=now();p.openOrders=p.openOrders.filter(x=>x.id!==orderId);
    const ledger=p.orders.find(x=>x.id===orderId);if(ledger)Object.assign(ledger,{status:'CANCELLED',cancelledAt:o.cancelledAt});
    p.journal.unshift({...o,type:'PAPER_ORDER_CANCELLED'});p.updatedAt=now();return o;
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
    const r={id:uid('round'),symbol:market.symbol||'SIM',final,confidence:+confidence.toFixed(1),vote:{buy,sell,hold},avgEdge:+avg.toFixed(1),risk,debates:debates.map(x=>({agentId:x.agent.id,name:x.agent.name,role:x.agent.role,thought:x.thought})),dissent:dissent.map(x=>x.agent.name),time:now(),virtualOnly:true};
    p.rounds.unshift(r);p.rounds=p.rounds.slice(0,50);p.journal.unshift({type:'PAPER_ROUND_TABLE',...r});p.updatedAt=now();return r;
  }
  function markToMarket(state,prices){
    const p=ensure(state),px=prices||p.marketSnapshot||{};let exposure=0,unreal=0;
    p.agents.forEach(a=>a.positions.forEach(pos=>{const last=Math.max(0,num(px[pos.symbol],pos.last||pos.avg));pos.last=last;exposure+=pos.qty*last;unreal+=(last-pos.avg)*pos.qty}));
    p.unrealizedPnl=+unreal.toFixed(2);p.marketSnapshot={...p.marketSnapshot,...px};processOpenOrders(state,px);processRiskExits(state,px);p.updatedAt=now();const cash=p.agents.reduce((n,a)=>n+a.cash,0);return{exposure:+exposure.toFixed(2),unrealizedPnl:p.unrealizedPnl,equity:+(cash+exposure).toFixed(2)};
  }
  function leaderboard(state){
    const p=ensure(state);return p.agents.map(a=>{const exposure=a.positions.reduce((n,x)=>n+x.qty*x.last,0),equity=a.cash+exposure,pnl=equity-a.capital;return{...a,equity:+equity.toFixed(2),pnl:+pnl.toFixed(2),returnPct:+(pnl/Math.max(1,a.capital)*100).toFixed(2),exposure:+exposure.toFixed(2)}}).sort((a,b)=>b.returnPct-a.returnPct);
  }
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
  window.FinPilotPaperCore={defaultPaper,ensure,ensureAgent,think,paperOrder,placeOrder,processOpenOrders,processRiskExits,amendOrder,placeBracket,cancelOco,cancelOrder,expirePaperOrders,attachRisk,roundTable,markToMarket,leaderboard,accountSummary,riskReport};
})();