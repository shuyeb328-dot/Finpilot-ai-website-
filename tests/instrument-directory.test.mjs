import assert from 'node:assert/strict';
import {lookupLocalInstruments} from '../server/instrument-directory.mjs';

function one(query) {
  const matches=lookupLocalInstruments(query);
  assert.equal(matches.length,1,`expected one exact local identity match for ${query}`);
  return matches[0];
}

const msft=one('MSFT');
assert.equal(msft.symbol,'MSFT');
assert.equal(msft.longName,'Microsoft Corporation');
assert.equal(msft.quoteType,'EQUITY');
assert.equal(msft.identitySource,'FINPILOT_LOCAL_REGISTRY');
assert.equal(msft.liveQuoteValidated,false);
assert.equal(Object.hasOwn(msft,'price'),false,'local identity results must never fabricate a quote price');

const microsoft=one('Microsoft');
assert.equal(microsoft.symbol,'MSFT');
assert.equal(one('MSFT stock analysis').symbol,'MSFT','analysis intent words should not prevent exact ticker lookup');

const reliance=one('RELIANCE');
assert.equal(reliance.symbol,'RELIANCE.NS','Indian base symbols should resolve to the curated NSE ticker');
assert.equal(one('RELIANCE.NS').symbol,'RELIANCE.NS');

const nifty=one('Nifty 50');
assert.equal(nifty.symbol,'^NSEI');
assert.equal(nifty.quoteType,'INDEX');

const btc=one('Bitcoin');
assert.equal(btc.symbol,'BTC');
assert.equal(btc.quoteType,'CRYPTOCURRENCY');

assert.deepEqual(lookupLocalInstruments('notarealticker123'),[],'unknown tickers must not be guessed');
assert.deepEqual(lookupLocalInstruments(''),[],'empty input should not resolve');
assert.deepEqual(lookupLocalInstruments('x'.repeat(101)),[],'oversized input should not resolve');

console.log('instrument-directory: exact identity, local fallback, aliases, and quote-separation checks passed');
