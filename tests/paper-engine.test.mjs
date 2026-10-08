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

console.log('Paper engine execution tests passed');
