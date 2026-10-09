import assert from 'node:assert/strict';
import {fetchNasdaqEod} from '../server/nasdaq-eod.mjs';

const fixture = {
  ok: true,
  status: {rCode: 200, bCodeMessage: null},
  data: {tradesTable: {rows: [
    {date:'10/08/2026', open:'$336.815', high:'$341.57', low:'$335.90', close:'$340.42', volume:'35,332,450'},
    {date:'10/07/2026', open:'$336.96', high:'$338.67', low:'$332.78', close:'$336.67', volume:'34,147,860'},
    {date:'invalid', open:'$', high:'bad', low:'—', close:'', volume:'-'}
  ]}}
};
let calledUrl = '';
let calledOptions;
const fetchImpl = async (url, options) => {
  calledUrl = url;
  calledOptions = options;
  return {ok:true, status:200, json:async()=>fixture};
};
const result = await fetchNasdaqEod('AAPL',{fetchImpl,now:new Date('2026-10-09T17:00:00Z')});
assert.match(calledUrl,/api\.nasdaq\.com\/api\/quote\/AAPL\/historical\?assetclass=stocks&fromdate=2026-06-11&todate=2026-10-09&limit=100/);
assert.equal(calledOptions.headers.Origin,'https://www.nasdaq.com');
assert.equal(result.rows.length,2);
assert.equal(result.rows[0].time,'2026-10-07T00:00:00.000Z');
assert.equal(result.rows[1].time,'2026-10-08T00:00:00.000Z');
assert.equal(result.rows[1].close,340.42);
assert.equal(result.rows[1].volume,35332450);
assert.equal(result.live,false);
assert.equal(result.executionEligible,false);
assert.equal(result.executionEligibilityReason,'HISTORICAL_DATA_ANALYSIS_ONLY');
assert.equal(result.sourceTimestampType,'HISTORICAL_EOD');
assert.equal(result.asOf,'2026-10-08T00:00:00.000Z');

await assert.rejects(()=>fetchNasdaqEod('RELIANCE.NS',{fetchImpl}),/NASDAQ_PUBLIC_US_SYMBOL_ONLY/);
await assert.rejects(()=>fetchNasdaqEod('AAPL',{fetchImpl:async()=>({ok:true,json:async()=>({status:{rCode:400,bCodeMessage:[{errorMessage:'fromdate missing'}]}})})}),/fromdate missing/);
await assert.rejects(()=>fetchNasdaqEod('AAPL',{fetchImpl:async()=>({ok:false,status:429})}),/NASDAQ_PUBLIC_HTTP_429/);
await assert.rejects(()=>fetchNasdaqEod('AAPL',{fetchImpl:async()=>({ok:true,json:async()=>({status:{rCode:200},data:{tradesTable:{rows:[]}}})})}),/NASDAQ_PUBLIC_INSUFFICIENT_VALID_CANDLES/);

console.log('Nasdaq EOD fallback checks passed.');
