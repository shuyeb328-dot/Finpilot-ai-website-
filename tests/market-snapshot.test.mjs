import assert from 'node:assert/strict';
import {buildMarketSnapshot, normalizeMarketSymbol} from '../server/market-snapshot.mjs';

const capturedAt='2026-10-09T06:00:00.000Z';
const goodCandles=[
  {time:'2026-10-09T05:55:00.000Z',open:100,high:102,low:99,close:101,volume:900},
  {time:'2026-10-09T05:56:00.000Z',open:101,high:103,low:100,close:102,volume:1000},
  {time:'2026-10-09T05:57:00.000Z',open:102,high:104,low:101,close:103,volume:1100},
  {time:'2026-10-09T05:58:00.000Z',open:0,high:104,low:0,close:103,volume:1200}
];
const liveEquity={
  ticker:'IRFC',name:'Indian Railway Finance Corporation',market:'INDIA_EQUITY',exchange:'NSE',currency:'INR',
  price:103,previous:101,changePct:1.98,dayHigh:104,dayLow:99,rsi:57,sma20:101,sma50:99,
  support:99,resistance:104,live:true,asOf:'2026-10-09T05:59:30.000Z',provider:'Test provider',candles:goodCandles
};

assert.equal(normalizeMarketSymbol(' irfc.ns '),'IRFC','exchange suffix should not change instrument identity');
assert.equal(normalizeMarketSymbol('XRP'),'XRP','crypto ticker should normalize without changes');
assert.equal(normalizeMarketSymbol('BTCUSDT'),'BTC','USDT quote aliases must normalize to the base asset for snapshot matching');
assert.equal(normalizeMarketSymbol('ETHUSDT'),'ETH','USDT quote aliases must normalize consistently across crypto assets');

const valid=buildMarketSnapshot(liveEquity,{requestedTicker:'IRFC.NS',interval:'1m',capturedAt});
assert.equal(valid.schemaVersion,1,'snapshot schema must be versioned');
assert.match(valid.snapshotId,/^ms_[a-f0-9]{20}$/,'snapshot ID must be stable and auditable');
assert.equal(valid.quality.status,'VERIFIED_LIVE','fresh matching quote with valid candles should be eligible');
assert.equal(valid.quality.forecastEligible,true,'only validated data is eligible for forecasting');
assert.equal(valid.instrument.currency,'INR','equity currency should be preserved');
assert.equal(valid.candles.count,3,'invalid zero-price OHLC row must be removed');
assert.equal(valid.candles.rejectedCount,1,'rejected candle count should be visible');
assert.equal(valid.timing.ageMs,30_000,'snapshot age should be computed from source timestamp');

const stale=buildMarketSnapshot({...liveEquity,asOf:'2026-10-09T05:55:00.000Z'},{requestedTicker:'IRFC',capturedAt});
assert.equal(stale.quality.status,'STALE','stale quote must be labelled');
assert.equal(stale.quality.forecastEligible,false,'stale quote must block forecasts');

const mismatch=buildMarketSnapshot({...liveEquity,ticker:'RELIANCE'},{requestedTicker:'AXISBANK',capturedAt});
assert.equal(mismatch.quality.status,'SYMBOL_MISMATCH','different issuer must not be accepted');
assert.equal(mismatch.instrument.symbolMatches,false,'symbol mismatch must be explicit');

const badPrice=buildMarketSnapshot({...liveEquity,price:0},{requestedTicker:'IRFC',capturedAt});
assert.equal(badPrice.quality.status,'INVALID_PRICE','zero or missing prices must be rejected');

const delayed=buildMarketSnapshot({...liveEquity,live:false},{requestedTicker:'IRFC',capturedAt});
assert.equal(delayed.quality.status,'DELAYED','non-live quotes must be distinguished from live quotes');
assert.equal(delayed.quality.forecastEligible,false,'delayed quotes must not be forecast-eligible');

const noCandles=buildMarketSnapshot({...liveEquity,candles:[]},{requestedTicker:'IRFC',capturedAt});
assert.equal(noCandles.quality.status,'INCOMPLETE_CANDLES','missing series must be explicit');

const crypto=buildMarketSnapshot({...liveEquity,ticker:'XRP',market:'CRYPTO',exchange:'Binance',currency:undefined,price:0.53,candles:goodCandles.slice(0,3)},{requestedTicker:'XRP',capturedAt});
assert.equal(crypto.instrument.market,'CRYPTO','crypto asset class should be preserved');
assert.equal(crypto.instrument.currency,'USD','crypto currency should default to USD');
assert.equal(crypto.quality.forecastEligible,true,'fresh crypto snapshot should be eligible when OHLC and quote are valid');

const cryptoAlias=buildMarketSnapshot({...liveEquity,ticker:'BTC',name:'Bitcoin',market:'CRYPTO',exchange:'Kraken',currency:'USD',price:82354.5,live:true,asOf:capturedAt,provider:'Kraken public market data fallback',candles:goodCandles.slice(0,3)},{requestedTicker:'BTCUSDT',capturedAt});
assert.equal(cryptoAlias.instrument.symbolMatches,true,'BTCUSDT alias should match the canonical BTC provider symbol');
assert.equal(cryptoAlias.quality.status,'VERIFIED_LIVE','valid BTC provider data should remain forecast-eligible for BTCUSDT alias queries');
assert.equal(cryptoAlias.quality.forecastEligible,true,'quote suffix normalization must not suppress a valid crypto snapshot');

const unavailable=buildMarketSnapshot(null,{requestedTicker:'BTC',capturedAt});
assert.equal(unavailable.quality.status,'UNAVAILABLE','missing provider data must not create a fabricated quote');
assert.equal(unavailable.quality.forecastEligible,false,'unavailable market data must block forecast eligibility');

console.log('market-snapshot: 23 contract checks passed');
