import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/paper-engine.js',import.meta.url),'utf8');
const context={window:{},Date,Math,Number,String,Boolean,Object,Array,JSON,console};
vm.runInNewContext(source,context);
const core=context.window.FinPilotPaperCore;
assert.ok(core,'paper core must load');

function fresh(){
  const state={};
  core.ensure(state);
  const a=core.ensureAgent(state.paperTrading,{id:'a1',name:'Risk Agent',role:'Risk'});
  return {state,a};
}

// Agent reasoning + Round Table
{
  const {state,a}=fresh();
  const t=core.think(a,{symbol:'IRFC',price:150,momentum:30,quality:80,valuation:75,risk:35,evidence:85});
  assert.ok(['BUY','HOLD','SELL'].includes(t.action));
  assert.equal(t.steps.length,5);
  assert.ok(t.invalidation);
  const round=core.roundTable(state,{symbol:'IRFC',price:150,momentum:30,quality:80,valuation:75,risk:35,evidence:85});
  assert.equal(round.symbol,'IRFC');
  assert.equal(round.vote.buy+round.vote.sell+round.vote.hold,state.paperTrading.agents.length);
  assert.ok(round.confidence>0);
}

// Market order: fill, fee, slippage, position and ledger
{
  const {state,a}=fresh();
  const before=a.cash;
  const o=core.paperOrder(state,'a1','IRFC','BUY',10,150,'test');
  assert.equal(o.status,'FILLED');
  assert.equal(o.virtualOnly,true);
  assert.equal(a.positions[0].qty,10);
  assert.ok(a.cash < before-1500);
  assert.ok(state.paperTrading.fees>0);
  assert.ok(state.paperTrading.slippage>0);
  assert.equal(state.paperTrading.orders[0].status,'FILLED');
}

// Limit order trigger + amend + cancel
{
  const {state,a}=fresh();
  const o=core.placeOrder(state,'a1','IRFC','BUY',5,'LIMIT',140,null,null,'limit');
  assert.equal(o.status,'OPEN');
  core.amendOrder(state,o.id,{limitPrice:139});
  assert.equal(o.limitPrice,139);
  assert.equal(o.amendments,1);
  core.processOpenOrders(state,{IRFC:140});
  assert.equal(o.status,'OPEN');
  core.processOpenOrders(state,{IRFC:139});
  assert.equal(o.status,'FILLED');
  assert.equal(a.positions[0].qty,5);
  const c=core.placeOrder(state,'a1','TCS','BUY',1,'LIMIT',100,null,null,'cancel');
  core.cancelOrder(state,c.id);
  assert.equal(c.status,'CANCELLED');
}

// Stop order trigger
{
  const {state,a}=fresh();
  core.paperOrder(state,'a1','IRFC','BUY',10,100,'entry');
  const stop=core.placeOrder(state,'a1','IRFC','SELL',10,'STOP',0,95,null,'stop');
  core.processOpenOrders(state,{IRFC:94});
  assert.equal(stop.status,'FILLED');
  assert.equal(a.positions.length,0);
}

// Bracket/OCO lifecycle: target fills and stop is cancelled
{
  const {state,a}=fresh();
  const entry=core.placeBracket(state,'a1','IRFC','BUY',10,'MARKET',100,95,110,'bracket');
  assert.equal(entry.status,'FILLED');
  const children=state.paperTrading.openOrders.filter(o=>o.bracketGroup===entry.bracketGroup);
  assert.equal(children.length,2);
  const target=children.find(o=>o.bracketRole==='TARGET');
  const stop=children.find(o=>o.bracketRole==='STOP');
  assert.ok(target&&stop);
  core.processOpenOrders(state,{IRFC:110});
  assert.equal(target.status,'FILLED');
  assert.equal(stop.status,'CANCELLED');
  assert.equal(a.positions.length,0);
}

// Risk exit + mark-to-market
{
  const {state,a}=fresh();
  core.paperOrder(state,'a1','IRFC','BUY',10,100,'entry');
  core.attachRisk(a.positions[0],95,110);
  const mtm=core.markToMarket(state,{IRFC:110});
  assert.equal(mtm.equity>0,true);
  assert.equal(a.positions.length,0);
}

// DAY expiry
{
  const {state}=fresh();
  const o=core.placeOrder(state,'a1','IRFC','BUY',1,'LIMIT',90,null,null,'day','DAY',Date.now()-1);
  core.expirePaperOrders(state,Date.now());
  assert.equal(o.status,'EXPIRED');
  assert.equal(state.paperTrading.openOrders.length,0);
}

// Pre-trade risk gate + fractional crypto sizing
{
  const {state,a}=fresh();
  assert.equal(core.qtyStep('BTC'),0.0001);
  assert.equal(core.qtyStep('IRFC'),1);
  const gate=core.preTradeCheck(state,{agentId:'a1',symbol:'BTC',side:'BUY',qty:0.1,entryPrice:80000,marketMeta:{verified:true,available:true,providerCount:2,receivedAt:new Date().toISOString()}});
  assert.ok(['PASS','WARN'].includes(gate.status));
  assert.equal(gate.metrics.qty,0.1);
  assert.equal(gate.metrics.qtyStep,0.0001);
  assert.equal(gate.virtualOnly,true);
  assert.throws(()=>core.paperOrder(state,'a1','BTC','BUY',0.1,80000,'risk',{orderType:'MARKET',enforceRisk:true,marketMeta:{verified:false,available:false}}),/Pre-trade risk block/);
  const stale=core.preTradeCheck(state,{agentId:'a1',symbol:'BTC',side:'BUY',qty:0.1,entryPrice:80000,marketMeta:{verified:true,available:true,providerCount:2,receivedAt:new Date(Date.now()-31000).toISOString()}});
  assert.equal(stale.status,'BLOCK');
  assert.ok(stale.reasons.some(x=>x.includes('stale')));
}

// Reconciliation: summary must remain finite and virtual-only
{
  const {state}=fresh();
  core.paperOrder(state,'a1','IRFC','BUY',10,100,'entry');
  core.markToMarket(state,{IRFC:105});
  const summary=core.accountSummary(state);
  const risk=core.riskReport(state);
  for(const v of [summary.cash,summary.equity,summary.realizedPnl,summary.unrealizedPnl,summary.exposure,risk.exposurePct]) assert.ok(Number.isFinite(v));
  assert.equal(summary.virtualOnly,true);
  assert.equal(risk.virtualOnly,true);
}

/* Execution 2.0 regression coverage */
{
  const {state,a}=fresh();
  const marketMeta={verified:true,available:true,providerCount:2,receivedAt:new Date().toISOString()};
  const limit=core.placeOrder(state,'a1','BTC','BUY',0.1,'LIMIT',80000,null,null,'fractional risk-gated limit','GTC',null,0,{enforceRisk:true,marketMeta,clientOrderId:'reg-btc-limit-1'});
  assert.equal(limit.status,'OPEN');
  assert.equal(limit.qty,0.1);
  core.processOpenOrders(state,{BTC:79900});
  assert.equal(limit.status,'FILLED');
  assert.equal(limit.filledQty,0.1);
  assert.equal(a.positions[0].qty,0.1);
  assert.equal(state.paperTrading.orders.filter(x=>x.id===limit.id).length,1);
}
{
  const {state,a}=fresh();
  const before=core.paperOrder(state,'a1','BTC','BUY',0.25,80000,'fractional entry');
  const bracket=core.placeBracket(state,'a1','BTC','BUY',0.25,'MARKET',80000,79000,82000,'fractional bracket');
  assert.equal(a.positions[0].qty,0.5);
  const children=state.paperTrading.openOrders.filter(o=>o.bracketGroup===bracket.bracketGroup);
  assert.equal(children.length,2);
  assert.equal(children.every(o=>o.qty===0.25),true);
  assert.equal(before.status,'FILLED');
}
{
  const {state,a}=fresh();
  a.cash=10000;
  const meta={verified:true,available:true,providerCount:2,receivedAt:new Date().toISOString()};
  const first=core.placeOrder(state,'a1','BTC','BUY',0.1,'LIMIT',80000,null,null,'reserve 1','GTC',null,0,{enforceRisk:true,marketMeta:meta,clientOrderId:'reserve-1'});
  assert.equal(first.status,'OPEN');
  assert.throws(()=>core.placeOrder(state,'a1','BTC','BUY',0.1,'LIMIT',80000,null,null,'reserve 2','GTC',null,0,{enforceRisk:true,marketMeta:meta,clientOrderId:'reserve-2'}),/buying power|Insufficient/);
}
{
  const {state,a}=fresh();
  core.paperOrder(state,'a1','BTC','BUY',0.5,80000,'fractional amend base');
  const o=core.placeOrder(state,'a1','BTC','SELL',0.5,'LIMIT',82000,null,null,'fractional exit');
  assert.equal(o.qty,0.5);
  core.amendOrder(state,o.id,{qty:0.25,limitPrice:81000});
  assert.equal(o.qty,0.25);
  assert.equal(o.remainingQty,0.25);
}
{
  const {state}=fresh();
  core.paperOrder(state,'a1','BTC','BUY',0.1,80000,'FOK base');
  const o=core.placeOrder(state,'a1','BTC','SELL',0.1,'LIMIT',79000,null,null,'FOK test','FOK');
  core.processOpenOrders(state,{BTC:79000});
  assert.equal(o.status,'FILLED');
  assert.equal(state.paperTrading.openOrders.length,0);
}
{
  const {state,a}=fresh();
  const marketMeta={verified:true,available:true,providerCount:2,receivedAt:new Date().toISOString()};
  const id='idempotent-market-1';
  const a1=core.placeOrder(state,'a1','BTC','BUY',0.1,'MARKET',80000,null,null,'idempotent','GTC',null,0,{enforceRisk:true,marketMeta,clientOrderId:id});
  const cashAfter=a.cash;
  const a2=core.placeOrder(state,'a1','BTC','BUY',0.1,'MARKET',80000,null,null,'idempotent retry','GTC',null,0,{enforceRisk:true,marketMeta,clientOrderId:id});
  assert.equal(a2.id,a1.id);
  assert.equal(a.cash,cashAfter);
  assert.equal(state.paperTrading.orders.filter(x=>x.id===a1.id).length,1);
}


/* Execution 3.0 regression coverage: lifecycle, stale quote guard, replace/cancel, reduce-only */
{
  const {state,a}=fresh();
  const meta={verified:true,available:true,providerCount:2,receivedAt:new Date().toISOString(),seq:'exec3-1'};
  const o=core.placeOrder(state,'a1','BTC','BUY',0.1,'LIMIT',80000,null,null,'execution 3','GTC',null,0,{enforceRisk:true,marketMeta:meta});
  assert.equal(o.status,'OPEN');
  core.processOpenOrders(state,{BTC:79900},meta);
  assert.equal(o.status,'FILLED');
  assert.equal(o.filledQty,0.1);
  const exit=core.placeOrder(state,'a1','BTC','SELL',0.1,'LIMIT',81000,null,null,'execution 3 exit');
  core.amendOrder(state,exit.id,{qty:0.05,limitPrice:80500});
  assert.equal(exit.status,'OPEN');
  assert.equal(exit.qty,0.05);
  assert.equal(exit.amendments,1);
  const replaced=core.replaceOrder(state,exit.id,{limitPrice:80600});
  assert.equal(replaced.limitPrice,80600);
  core.cancelOrder(state,exit.id);
  assert.equal(exit.status,'CANCELLED');
  assert.equal(state.paperTrading.openOrders.length,0);
}
{
  const {state}=fresh();
  const stale={verified:true,available:true,providerCount:2,receivedAt:new Date(Date.now()-31000).toISOString(),seq:'exec3-stale'};
  core.paperOrder(state,'a1','BTC','BUY',0.1,80000,'entry');
  const o=core.placeOrder(state,'a1','BTC','SELL',0.1,'LIMIT',79000,null,null,'stale');
  core.processOpenOrders(state,{BTC:79000},stale);
  assert.equal(o.status,'OPEN');
  assert.throws(()=>core.paperOrder(state,'a1','BTC','BUY',0.01,80000,'invalid reduce',{reduceOnly:true}),/Reduce-only BUY/);
  const rec=core.reconcileOrders(state);
  assert.equal(rec.openOrders,1);
  assert.equal(rec.partial,0);
}

/* Execution 4.0: tick-aware bid/ask, realistic spread/impact, deduped ticks */
{
  const {state,a}=fresh();
  const meta={verified:true,executionEligible:true,providerCount:2,receivedAt:new Date().toISOString(),sourceAsOf:new Date().toISOString(),seq:'tick-limit-1',bid:99.2,ask:99.5};
  const o=core.placeOrder(state,'a1','IRFC','BUY',10,'LIMIT',100,null,null,'bid/ask limit');
  assert.equal(o.status,'OPEN');
  const tick=core.processMarketTick(state,{symbol:'IRFC',price:99.35,bid:99.2,ask:99.5,receivedAt:meta.receivedAt,sourceAsOf:meta.sourceAsOf,seq:meta.seq,status:'LIVE',verified:true,executionEligible:true,providerCount:2});
  assert.equal(tick.ok,true);
  assert.equal(o.status,'FILLED');
  assert.equal(a.positions[0].qty,10);
  assert.ok(Number(o.quoteAsk)>0);
  assert.ok(Number(o.spreadBps)>0);
  const beforeOrders=state.paperTrading.orders.length;
  const again=core.processMarketTick(state,{symbol:'IRFC',price:99.3,bid:99.1,ask:99.4,receivedAt:meta.receivedAt,sourceAsOf:meta.sourceAsOf,seq:meta.seq,status:'LIVE',verified:true,executionEligible:true,providerCount:2});
  assert.equal(again.fills.length,0);
  assert.equal(state.paperTrading.orders.length,beforeOrders);
}
{
  const {state,a}=fresh();
  const now=new Date().toISOString();
  const marketMeta={verified:true,available:true,executionEligible:true,providerCount:2,receivedAt:now,sourceAsOf:now,bid:99,ask:101};
  const o=core.paperOrder(state,'a1','IRFC','BUY',10,100,'realistic market',{orderType:'MARKET',realistic:true,marketMeta});
  assert.equal(o.status,'FILLED');
  assert.ok(o.fillPrice>100);
  assert.ok(o.quoteAsk===101);
  assert.ok(o.executionLatencyMs>=0);
  assert.ok(o.marketImpactBps>=0);
  assert.equal(o.virtualOnly,true);
}
{
  const {state,a}=fresh();
  core.paperOrder(state,'a1','IRFC','BUY',10,100,'tick position');
  const baseLast=a.positions[0].last;
  const staleTick=core.processMarketTick(state,{symbol:'IRFC',price:120,bid:119.9,ask:120.1,receivedAt:new Date().toISOString(),sourceAsOf:new Date(Date.now()-31000).toISOString(),seq:'stale-1',status:'STALE',verified:true,executionEligible:false});
  assert.equal(staleTick.fills.length,0);
  assert.equal(a.positions[0].last,baseLast);
  const liveTick=core.processMarketTick(state,{symbol:'IRFC',price:120,bid:119.9,ask:120.1,receivedAt:new Date().toISOString(),sourceAsOf:new Date().toISOString(),seq:'live-1',status:'LIVE',verified:true,executionEligible:true});
  assert.equal(liveTick.ok,true);
  assert.equal(a.positions[0].last,120);
  assert.ok(state.paperTrading.journal.some(x=>x.type==='MARKET_TICK'&&x.seq==='live-1'));
}


console.log('Paper engine execution tests passed');
