import assert from 'node:assert/strict';
import {createProviderResponseCache} from '../server/provider-response-cache.mjs';

let now=1_791_523_200_000;
let calls=0,release;
const gate=new Promise(resolve=>{release=resolve});
const cache=createProviderResponseCache({ttlMs:5000,maxEntries:20,now:()=>now});

const firstPromise=cache.get('https://provider.test/ticker?symbol=BTC',async()=>{
  calls++;
  await gate;
  return {price:100, nested:{safe:true}};
});
const sharedPromise=cache.get('https://provider.test/ticker?symbol=BTC',async()=>{
  calls++;
  return {price:999};
});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(calls,1,'concurrent requests for the same provider URL should invoke one loader');
assert.equal(cache.stats().inflight,1);
release();
const [first,shared]=await Promise.all([firstPromise,sharedPromise]);

assert.equal(first.price,100);
assert.equal(shared.price,100);
assert.equal(first._finpilotCache.observedAt,new Date(now).toISOString());
assert.equal(shared._finpilotCache.observedAt,first._finpilotCache.observedAt);
assert.equal(shared._finpilotCache.shared,true,'coalesced calls should retain the original observation time');
assert.equal(first._finpilotCache.cacheHit,false);
assert.equal(Object.keys(first).includes('_finpilotCache'),false,'cache metadata must not leak into provider response JSON');
first.price=777;
assert.equal(first.nested.safe,true);

const hit=await cache.get('https://provider.test/ticker?symbol=BTC',async()=>({price:-1}));
assert.equal(hit.price,100,'callers must not mutate the cached response');
assert.equal(hit._finpilotCache.cacheHit,true);
assert.equal(hit._finpilotCache.ageMs,0);
assert.equal(cache.stats().hits,1);

now+=5001;
const refreshed=await cache.get('https://provider.test/ticker?symbol=BTC',async()=>{calls++;return {price:101};});
assert.equal(refreshed.price,101,'expired quote data must be fetched again');
assert.equal(refreshed._finpilotCache.observedAt,new Date(now).toISOString());
assert.equal(calls,2);

let failedCalls=0;
await assert.rejects(()=>cache.get('/unavailable',async()=>{failedCalls++;throw new Error('provider unavailable')}));
await assert.rejects(()=>cache.get('/unavailable',async()=>{failedCalls++;throw new Error('provider unavailable')}));
assert.equal(failedCalls,2,'failed responses must not be cached');

console.log('PASS provider response cache: concurrent dedupe, source time, expiry, clone safety, failure non-caching');
