import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTradingViewAlertInbox} from '../server/tradingview-alert-inbox.mjs';

let now=Date.parse('2026-10-10T12:00:00.000Z');
const secret='finpilot-test-secret-value-2026-long-enough';
const inbox=createTradingViewAlertInbox({getToken:()=>secret,now:()=>now,maxEntries:10,ttlMs:60_000});
const noConfig=createTradingViewAlertInbox({getToken:()=>'',now:()=>now});
assert.equal(noConfig.status().configured,false);
assert.equal(noConfig.ingest({token:'anything'}).statusCode,503);

const status=inbox.status();
assert.equal(status.configured,true);
assert.equal(status.execution,'SIGNAL_ONLY');
assert.equal(status.persistent,false);
assert.equal(inbox.ingest({token:'wrong-secret',ticker:'AAPL',action:'BUY'}).statusCode,401);
assert.equal(inbox.ingest({token:secret,ticker:'javascript:alert(1)',action:'BUY'}).error,'INVALID_ALERT_SYMBOL');
assert.equal(inbox.ingest({token:secret,ticker:'AAPL',action:'HOLD MAYBE'}).error,'INVALID_ALERT_ACTION');
assert.equal(inbox.ingest({token:secret,ticker:'AAPL',action:'BUY',timestamp:'not-a-date'}).error,'INVALID_OR_EXPIRED_ALERT_TIMESTAMP');

const valid={
 token:secret,ticker:'NASDAQ:AAPL',action:'buy',strategy:'FinPilot breakout',
 interval:'60',price:'201.45',timestamp:new Date(now).toISOString(),alertId:'alert-001'
};
const accepted=inbox.ingest(valid);
assert.equal(accepted.ok,true);
assert.equal(accepted.status, 'RECEIVED_UNVERIFIED');
assert.equal(accepted.executionEligible,false);
assert.equal(accepted.orderSubmitted,false);
const listed=inbox.list(secret);
assert.equal(listed.ok,true);
assert.equal(listed.count,1);
assert.equal(listed.items[0].symbol,'NASDAQ:AAPL');
assert.equal(listed.items[0].action,'BUY');
assert.equal(listed.items[0].statedPrice,201.45);
assert.equal(listed.items[0].trust,'UNVERIFIED_SIGNAL');
assert.equal(listed.items[0].source,'TRADINGVIEW_WEBHOOK');
assert.equal(listed.items[0].executionEligible,false);
assert.equal(listed.items[0].orderSubmitted,false);
assert.equal(JSON.stringify(listed).includes(secret),false,'secret must never appear in returned inbox records');
assert.equal(inbox.list('not-the-secret').statusCode,401);

const duplicate=inbox.ingest(valid);
assert.equal(duplicate.ok,true);
assert.equal(duplicate.duplicate,true);
assert.equal(inbox.status().queueSize,1);

assert.equal(inbox.ingest({...valid,alertId:'old-alert',timestamp:new Date(now-120_000).toISOString()}).error,'INVALID_OR_EXPIRED_ALERT_TIMESTAMP');
assert.equal(inbox.ingest({...valid,alertId:'future-alert',timestamp:new Date(now+6*60_000).toISOString()}).error,'INVALID_OR_EXPIRED_ALERT_TIMESTAMP');

for(let i=0;i<12;i++)inbox.ingest({...valid,alertId:'unique-'+i,timestamp:new Date(now+i).toISOString(),ticker:'AAPL'});
assert.equal(inbox.status().queueSize,10,'inbox remains bounded at maxEntries');
now+=61_000;
assert.equal(inbox.status().queueSize,0,'alerts expire from the in-memory inbox');
assert.equal(inbox.status().persistent,false,'storage contract must not claim durability');
const server=fs.readFileSync(new URL('../server/server.mjs',import.meta.url),'utf8');
assert.ok(server.includes("u.pathname==='/api/tradingview-alert'"),'webhook POST route should exist');
assert.ok(server.includes("u.pathname==='/api/tradingview-alerts'"),'authenticated inbox GET route should exist');
assert.ok(server.includes("req.headers['x-finpilot-webhook-token']"),'inbox route should authenticate reads');
assert.ok(server.includes("req.headers['content-type']"),'webhook route should require JSON');
console.log('TradingView alert inbox: auth, bounds, dedupe, timestamps, secret redaction and signal-only execution checks passed.');
