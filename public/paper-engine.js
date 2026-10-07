/* FinPilot isolated pseudo paper-trading core.
   No broker connection. No real orders. All balances are virtual. */
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
  const money=(n)=>Number(n)||0;
  const uid=(p)=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);

  function defaultPaper(){
    return {
      version:1,
      baseCurrency:'INR',
      startingCash:1000000,
      cash:1000000,
      realizedPnl:0,
      unrealizedPnl:0,
      agents:[],
      positions:[],
      orders:[],
      journal:[],
      rounds:[],
      leaderboard:[],
      marketSnapshot:{},
      updatedAt:new Date().toISOString()
    };
  }

  function ensure(state){
    if(!state.paperTrading)state.paperTrading=defaultPaper();
    const p=state.paperTrading;
    p.agents=Array.isArray(p.agents)?p.agents:[];p.positions=Array.isArray(p.positions)?p.positions:[];p.orders=Array.isArray(p.orders)?p.orders:[];
    p.journal=Array.isArray(p.journal)?p.journal:[];p.rounds=Array.isArray(p.rounds)?p.rounds:[];p.leaderboard=Array.isArray(p.leaderboard)?p.leaderboard:[];
    p.marketSnapshot=p.marketSnapshot&&typeof p.marketSnapshot==='object'?p.marketSnapshot:{};
    return p;
  }

  function ensureAgent(p,agent){
    let a=p.agents.find(x=>x.id===agent.id);
    if(!a){
      a={id:agent.id,name:agent.name,role:agent.role||'Specialist',capital:p.startingCash/Math.max(1,p.agents.length+1),cash:p.startingCash/Math.max(1,p.agents.length+1),positions:[],pnl:0,winRate:null,decisions:0,confidence:70,enabled:true,strategy:agent.strategy||'Evidence-first',createdAt:new Date().toISOString()};
      p.agents.push(a);
    }
    return a;
  }

  function think(agent,market){
    const px=Number(market.price)||100;
    const momentum=clamp(Number(market.momentum)||0,-100,100);
    const quality=clamp(Number(market.quality)||50);
    const valuation=clamp(Number(market.valuation)||50);
    const risk=clamp(Number(market.risk)||50);
    const evidence=clamp(Number(market.evidence)||50);
    const bull=quality*.28+valuation*.22+Math.max(0,momentum)*.18+evidence*.18+(100-risk)*.14;
    const bear=(100-quality)*.22+(100-valuation)*.22+Math.max(0,-momentum)*.2+risk*.22+(100-evidence)*.14;
    const edge=clamp(50+(bull-bear)/2);
    let action=edge>=67?'BUY':edge<=33?'SELL':'HOLD';
    if(risk>=78&&action==='BUY')action='HOLD';
    const confidence=clamp(58+Math.abs(edge-50)*.65+Math.abs(momentum)*.08);
    const thesis=action==='BUY'?'Evidence and quality outweigh downside risk; accumulate only inside the paper risk budget.':action==='SELL'?'Downside factors dominate the evidence; reduce exposure in simulation rather than chase the move.':'Evidence is not strong enough for a high-conviction position; preserve optionality and wait for confirmation.';
    return {
      action,confidence:Number(confidence.toFixed(1)),edge:Number(edge.toFixed(1)),
      bull:Number(bull.toFixed(1)),bear:Number(bear.toFixed(1)),
      thesis,
      steps:[
        'Define hypothesis from market and company inputs',
        'Cross-check quality, valuation, momentum and risk',
        'Stress-test the opposing case',
        'Apply paper-only position and loss limits',
        'Return action, confidence and invalidation trigger'
      ],
      invalidation:action==='BUY'?'Quality or evidence falls below 40, or risk rises above 80.':action==='SELL'?'Quality recovers above 65 with improving evidence.':'Edge moves outside the 33–67 neutral band.',
      timestamp:new Date().toISOString()
    };
  }

  function paperOrder(state,agentId,symbol,side,qty,price,reason){
    const p=ensure(state);const a=p.agents.find(x=>x.id===agentId);
    if(!a)throw new Error('Paper agent not found');
    qty=Math.max(0,Math.floor(Number(qty)||0));price=Math.max(0,Number(price)||0);
    if(!qty||!price)throw new Error('Quantity and price are required');
    const value=qty*price;
    if(side==='BUY'&&a.cash<value)throw new Error('Paper cash limit exceeded');
    const pos=a.positions.find(x=>x.symbol===symbol);
    if(side==='BUY'){
      a.cash-=value;
      if(pos){const total=pos.qty+qty;pos.avg=(pos.avg*pos.qty+price*qty)/total;pos.qty=total;pos.last=price}
      else a.positions.push({symbol,qty,avg:price,last:price});
    }else{
      if(!pos||pos.qty<qty)throw new Error('Paper position limit exceeded');
      a.cash+=value;pos.qty-=qty;pos.last=price;if(pos.qty===0)a.positions=a.positions.filter(x=>x!==pos);
    }
    const o={id:uid('order'),agentId,symbol,side,qty,price,value,reason:reason||'Paper decision',time:new Date().toISOString()};
    p.orders.unshift(o);p.journal.unshift({...o,type:'PAPER_ORDER'});
    a.decisions++;
    p.updatedAt=new Date().toISOString();
    return o;
  }

  function roundTable(state,market){
    const p=ensure(state);
    const active=p.agents.filter(a=>a.enabled);
    const debates=active.map(a=>({agent:a,thought:think(a,market)}));
    const buy=debates.filter(x=>x.thought.action==='BUY').length;
    const sell=debates.filter(x=>x.thought.action==='SELL').length;
    const hold=debates.length-buy-sell;
    const avg=debates.length?debates.reduce((n,x)=>n+x.thought.edge,0)/debates.length:50;
    const risk=clamp(Number(market.risk)||50);
    const final=buy>sell&&avg>=60&&risk<78?'PAPER BUY':sell>buy&&avg<=40?'PAPER SELL':'PAPER HOLD';
    const confidence=clamp(60+Math.abs(avg-50)*.7+Math.abs(buy-sell)*3-risk*.12);
    const dissent=debates.filter(x=>final.includes('BUY')?x.thought.action==='SELL':final.includes('SELL')?x.thought.action==='BUY':x.thought.action!=='HOLD');
    const r={id:uid('round'),symbol:market.symbol||'SIM',final,confidence:Number(confidence.toFixed(1)),vote:{buy,sell,hold},avgEdge:Number(avg.toFixed(1)),risk,debates:debates.map(x=>({agentId:x.agent.id,name:x.agent.name,role:x.agent.role,thought:x.thought})),dissent:dissent.map(x=>x.agent.name),time:new Date().toISOString()};
    p.rounds.unshift(r);p.rounds=p.rounds.slice(0,50);
    p.journal.unshift({type:'PAPER_ROUND_TABLE',final,confidence:r.confidence,vote:r.vote,symbol:r.symbol,time:r.time});
    p.updatedAt=new Date().toISOString();
    return r;
  }

  function leaderboard(state){
    const p=ensure(state);
    return p.agents.map(a=>{
      const exposure=a.positions.reduce((n,x)=>n+x.qty*x.last,0);
      const equity=a.cash+exposure;
      const pnl=equity-a.capital;
      return {...a,equity,pnl:Number(pnl.toFixed(2)),returnPct:Number((pnl/Math.max(1,a.capital)*100).toFixed(2)),exposure};
    }).sort((a,b)=>b.returnPct-a.returnPct);
  }

  window.FinPilotPaperCore={defaultPaper,ensure,ensureAgent,think,paperOrder,roundTable,leaderboard};
})();