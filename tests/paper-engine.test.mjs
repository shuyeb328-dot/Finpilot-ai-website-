import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/paper-engine.js',import.meta.url),'utf8');
const context={window:{},Date,Math,Number,String,Boolean,Object,Array,JSON,console};
vm.runInNewContext(source,context);
const core=context.window.FinPilotPaperCore;
assert.ok(core,'paper core must load');

const state={};
core.ensure(state);
const a=core.ensureAgent(state.paperTrading,{id:'a1',name:'Risk Agent',role:'Risk'});
const t=core.think(a,{symbol:'IRFC',price:150,momentum:30,quality:80,valuation:75,risk:35,evidence:85});
assert.ok(['BUY','HOLD','SELL'].includes(t.action));
assert.ok(t.steps.length===5);
assert.ok(t.invalidation);

const round=core.roundTable(state,{symbol:'IRFC',price:150,momentum:30,quality:80,valuation:75,risk:35,evidence:85});
assert.equal(round.symbol,'IRFC');
assert.equal(round.vote.buy+round.vote.sell+round.vote.hold,state.paperTrading.agents.length);
assert.ok(round.confidence>0);

const before=state.paperTrading.agents[0].cash;
core.paperOrder(state,'a1','IRFC','BUY',10,150,'test');
assert.equal(state.paperTrading.agents[0].cash,before-1500);
assert.equal(state.paperTrading.agents[0].positions[0].qty,10);

console.log('Paper engine tests passed');
