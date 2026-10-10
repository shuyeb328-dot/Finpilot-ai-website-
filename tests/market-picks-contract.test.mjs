import assert from 'node:assert/strict';
import {
  buildMarketPicksEnvelope,
  normalizeMarketPicksMarket,
  resolveMarketPicksUniverse
} from '../server/market-picks-contract.mjs';

assert.deepEqual(normalizeMarketPicksMarket('', false), {ok:true, market:'INDIA'});
assert.deepEqual(normalizeMarketPicksMarket('', true), {ok:true, market:'AUTO'});
assert.equal(normalizeMarketPicksMarket('United States', true).market, 'US');
assert.equal(normalizeMarketPicksMarket('nonsense', true).error, 'UNSUPPORTED_MARKET');

const globalUniverse = resolveMarketPicksUniverse({
  market:'US',
  requestedTickers:[],
  indiaTickers:['RELIANCE','TCS'],
  globalStockTestSet:[['United States','AAPL'],['United States','MSFT'],['India','RELIANCE.NS']]
});
assert.deepEqual(globalUniverse, ['AAPL','MSFT'], 'US default universe must not fall back to Indian equities');
assert.deepEqual(resolveMarketPicksUniverse({
  market:'INDIA', requestedTickers:[], indiaTickers:['TCS','RELIANCE'], globalStockTestSet:[]
}), ['TCS','RELIANCE']);
assert.deepEqual(resolveMarketPicksUniverse({
  market:'US', requestedTickers:['msft',' MSFT ','aapl'], indiaTickers:['RELIANCE'], globalStockTestSet:[]
}), ['MSFT','AAPL'], 'explicit tickers are normalized and de-duplicated');

const now = Date.parse('2026-10-10T08:14:10.000Z');
const staleMicrosoft = {
  ticker:'MSFT',symbol:'MSFT',name:'Microsoft Corporation',market:'GLOBAL_EQUITY',
  exchange:'NMS',listingExchange:'NASDAQ',score:74,price:535.07,
  live:false,executionEligible:false,sourceTimestampType:'PROVIDER_TIMESTAMP',
  asOf:'2026-10-09T20:00:01.000Z',provider:'Yahoo Finance chart adapter'
};
const result = buildMarketPicksEnvelope([staleMicrosoft], {market:'AUTO',limit:5,nowMs:now,maxAgeMs:90000});
assert.equal(result.market, 'GLOBAL_EQUITY', 'the wrapper market must match the actual returned candidate');
assert.equal(result.live, false, 'a stale candidate must never make the response live');
assert.equal(result.verified, false);
assert.equal(result.executionEligible, false);
assert.equal(result.asOf, staleMicrosoft.asOf, 'asOf must reflect source time rather than request time');
assert.equal(result.retrievedAt, new Date(now).toISOString(), 'request time must be separately identified');
assert.equal(result.freshCount, 0);
assert.equal(result.staleOrUnverifiedCount, 1);

const indiaRow = {
  ticker:'RELIANCE',symbol:'RELIANCE.NS',market:'INDIA_EQUITY',exchange:'NSE/BSE',
  score:80,live:true,executionEligible:false,sourceTimestampType:'PROVIDER_TIMESTAMP',
  asOf:new Date(now - 1000).toISOString(),provider:'Yahoo Finance chart adapter'
};
const usRow = {
  ...staleMicrosoft,ticker:'AAPL',symbol:'AAPL',exchange:'NMS',listingExchange:'NASDAQ',
  asOf:new Date(now - 1000).toISOString(),live:true,executionEligible:false
};
const genericExchangeUsRow = {...usRow,ticker:'MSFT',symbol:'MSFT',exchange:'GLOBAL',listingExchange:'',live:false};
const genericExchangeResult = buildMarketPicksEnvelope([indiaRow,genericExchangeUsRow], {
  market:'US',nowMs:now,maxAgeMs:90000,usTickers:['AAPL','MSFT','NVDA']
});
assert.deepEqual(genericExchangeResult.candidates.map(row => row.ticker), ['MSFT'],
  'known US registry symbols must survive a provider that labels the exchange generically');
assert.equal(genericExchangeResult.market, 'GLOBAL_EQUITY');
assert.equal(genericExchangeResult.live, false, 'known US symbol must still be stale when its source time is stale');

const usOnly = buildMarketPicksEnvelope([indiaRow, usRow], {market:'US',nowMs:now,maxAgeMs:90000});
assert.deepEqual(usOnly.candidates.map(row => row.ticker), ['AAPL'], 'US filter must reject Indian candidates');
assert.equal(usOnly.market, 'GLOBAL_EQUITY');
assert.equal(usOnly.live, true, 'live denotes fresh provider-timestamped data, not paper-execution eligibility');
assert.equal(usOnly.executionEligible, false, 'freshness must not override the unofficial-source execution guard');

const mixed = buildMarketPicksEnvelope([indiaRow, usRow], {market:'AUTO',nowMs:now,maxAgeMs:90000});
assert.equal(mixed.market, 'MIXED', 'multi-market results must not be labelled as a single market');
assert.equal(mixed.count, 2);

const unknownSourceTime = buildMarketPicksEnvelope([{...usRow,asOf:null}], {market:'AUTO',nowMs:now});
assert.equal(unknownSourceTime.asOf, null, 'unknown source timestamps must not be replaced with retrieval time');
assert.equal(unknownSourceTime.live, false);
console.log('market-picks-contract: market filtering, source freshness, and metadata checks passed');


const wronglyEligibleButStale = buildMarketPicksEnvelope([{
  ...staleMicrosoft,
  live:true,
  executionEligible:true,
  asOf:'2026-10-09T20:00:01.000Z'
}], {market:'US',limit:5,nowMs:now,maxAgeMs:90000});
assert.equal(wronglyEligibleButStale.live,false);
assert.equal(wronglyEligibleButStale.verified,false,'stale source timestamps must override a caller/provider executionEligible claim');
assert.equal(wronglyEligibleButStale.executionEligible,false,'stale market picks cannot pass execution eligibility');
