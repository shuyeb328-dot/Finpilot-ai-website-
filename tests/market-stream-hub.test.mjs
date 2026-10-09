import assert from 'node:assert/strict';
import {createMarketStreamHub} from '../server/market-stream-hub.mjs';

let fetches=0,release;
const gate=new Promise(resolve=>{release=resolve});
const hub=createMarketStreamHub({
  pollMs:1000,
  heartbeatMs:1000,
  loadSnapshot:async key=>{
    fetches++;
    await gate;
    return {key,price:123.45,asOf:'2026-10-09T00:00:00.000Z'};
  },
  signature:value=>JSON.stringify([value.key,value.price,value.asOf])
});
const a=[],b=[],errors=[];
const unsubscribeA=hub.subscribe('BTC\u001f1m',{onData:value=>a.push(value),onError:error=>errors.push(error)});
const unsubscribeB=hub.subscribe('BTC\u001f1m',{onData:value=>b.push(value),onError:error=>errors.push(error)});

assert.equal(fetches,1,'two subscribers for one ticker/interval must share an upstream poll');
assert.deepEqual(hub.stats(),{channels:1,subscribers:2,polling:1});
release();
await new Promise(resolve=>setTimeout(resolve,0));

assert.equal(a.length,1,'first listener receives the shared snapshot');
assert.equal(b.length,1,'second listener receives the same shared snapshot');
assert.deepEqual(a[0],b[0],'all subscribers receive identical sequence and provenance');
assert.equal(a[0].seq,1);
assert.equal(errors.length,0);

unsubscribeA();
assert.deepEqual(hub.stats(),{channels:1,subscribers:1,polling:0});
unsubscribeB();
assert.deepEqual(hub.stats(),{channels:0,subscribers:0,polling:0});
unsubscribeB();
console.log('PASS market stream hub: shared polling, fan-out, sequence consistency, and cleanup');
