/* FinPilot Adaptive Research Engine
   Deterministic backtesting for paper-only research.
   No brokerage execution and no claim of predictive accuracy.
*/
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const pct=(n)=>Number((Number(n||0)*100).toFixed(2));
  function signal(c){
    const momentum=Number(c.momentum||0), quality=Number(c.quality??50), valuation=Number(c.valuation??50), risk=Number(c.risk??50);
    const edge=(quality-50)*.6+(valuation-50)*.4+momentum*.5-(risk-50)*.6;
    return edge>=12?'BUY':edge<=-12?'SELL':'HOLD';
  }
  function backtest(series,opts={}){
    const rows=Array.isArray(series)?series.filter(x=>Number(x.price)>0):[];
    if(rows.length<2) return {ok:false,error:'At least 2 price observations are required.'};
    let cash=Number(opts.startingCash||100000),qty=0,entry=0,trades=0,wins=0,peak=cash,equity=cash,maxDrawdown=0;
    const ledger=[];
    rows.forEach((r,i)=>{
      const action=signal(r);
      const price=Number(r.price);
      if(action==='BUY'&&qty===0){
        const allocation=Math.min(cash*.2,Number(opts.maxAllocation||20000));
        qty=Math.floor(allocation/price);
        if(qty>0){cash-=qty*price;entry=price;trades++;}
      } else if(action==='SELL'&&qty>0){
        const pnl=(price-entry)*qty;cash+=qty*price;if(pnl>0)wins++;qty=0;trades++;
      }
      equity=cash+qty*price;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/Math.max(1,peak));
      ledger.push({index:i,price,action,qty,equity:Number(equity.toFixed(2)),drawdownPct:pct((peak-equity)/Math.max(1,peak))});
    });
    const finalPrice=Number(rows.at(-1).price);
    equity=cash+qty*finalPrice;
    if(qty>0){const pnl=(finalPrice-entry)*qty;if(pnl>0)wins++;}
    const ret=(equity-(Number(opts.startingCash||100000)))/Math.max(1,Number(opts.startingCash||100000));
    return {ok:true,observations:rows.length,startingCash:Number(opts.startingCash||100000),endingEquity:Number(equity.toFixed(2)),returnPct:pct(ret),trades,winRatePct:trades?Number((wins/Math.max(1,trades/2)*100).toFixed(2)):0,maxDrawdownPct:pct(maxDrawdown),openQty:qty,ledger,method:'bounded 20% allocation; deterministic signal; paper research only'};
  }
  function compare(series,strategies){
    return (strategies||[{name:'Adaptive Core'}]).map(s=>{
      const r=backtest(series,{startingCash:s.startingCash||100000,maxAllocation:s.maxAllocation||20000});
      return {...r,strategy:s.name};
    });
  }
  function adaptiveScore(agentStats){
    const xs=Object.values(agentStats||{}).filter(x=>x&&x.outcomes);
    if(!xs.length)return {score:50,confidence:50,reason:'No resolved outcomes yet.'};
    const accuracy=xs.reduce((a,x)=>a+Number(x.accuracy||0),0)/xs.length;
    const confidence=xs.reduce((a,x)=>a+Number(x.avgConfidence||50),0)/xs.length;
    const score=clamp(50+(accuracy-50)*.7+(confidence-50)*.3);
    return {score:Number(score.toFixed(1)),confidence:Number(confidence.toFixed(1)),accuracy:Number(accuracy.toFixed(1)),reason:'Adaptive weight is based on recorded outcomes, not invented performance.'};
  }
  window.FinPilotResearch={signal,backtest,compare,adaptiveScore};
})();