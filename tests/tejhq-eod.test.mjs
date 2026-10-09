import assert from 'node:assert/strict';
import {buildTejHqEodReport,fetchTejHqEod,clearTejHqEodCache} from '../server/tejhq-eod.mjs';

const now=Date.parse('2026-10-09T14:30:00Z');
const history={data:[
 {date:'2026-10-06',open:76.98,high:78.07,low:76.33,close:77.1,prev_close:76.5,volume:6659066},
 {date:'2026-10-07',open:76.9,high:77.2,low:76.04,close:76.15,prev_close:77.1,volume:5212579},
 {date:'2026-10-08',open:76.24,high:76.29,low:74.12,close:74.3,prev_close:76.15,volume:9189122}
]};
const status={trading_date:'2026-10-08',prices_published_at:'2026-10-08T21:08:48Z'};
const report=buildTejHqEodReport('IRFC',history,status,{now});
assert.equal(report.price,74.3);
assert.equal(report.previous,76.15);
assert.ok(report.changePct<0);
assert.equal(report.provider,'TejHQ public EOD');
assert.equal(report.latestTradingDate,'2026-10-08');
assert.equal(report.interval,'1d');
assert.equal(report.dataFreshness,'END_OF_DAY');
assert.equal(report.live,false);
assert.equal(report.executionEligible,false);
assert.equal(report.sourceTimestampType,'HISTORICAL_EOD');
assert.equal(report.asOf,'2026-10-08T21:08:48.000Z');
assert.equal(report.candles.length,3);

const mismatch=buildTejHqEodReport('IRFC',history,{trading_date:'2026-10-09',prices_published_at:'2026-10-09T21:08:48Z'},{now});
assert.equal(mismatch.asOf,null,'dataset publication time must not be attached to a different last-traded date');
assert.equal(mismatch.sourceTimestampType,'HISTORICAL_DATE_ONLY');
assert.equal(mismatch.executionEligible,false);

const futureFiltered=buildTejHqEodReport('IRFC',{data:[...history.data,{date:'2026-10-10',open:1,high:2,low:1,close:2,volume:1}]},status,{now});
assert.equal(futureFiltered.latestTradingDate,'2026-10-08','future or post-status candles must be excluded');

assert.throws(()=>buildTejHqEodReport('IRFC',{data:[]},status,{now}),/TEJHQ_EOD_HISTORY_INSUFFICIENT/);
assert.throws(()=>buildTejHqEodReport('IRFC',{data:[{date:'2026-10-08',open:76,high:70,low:74,close:75}]},status,{now}),/TEJHQ_EOD_HISTORY_INSUFFICIENT/);

clearTejHqEodCache();
let fetchCount=0;
const mockFetch=async url=>{
 fetchCount++;
 return {ok:true,status:200,json:async()=>String(url).includes('/v1/status')?status:history};
};
const fetched=await fetchTejHqEod('IRFC',{allowedSymbols:['IRFC'],fetchImpl:mockFetch,now,useCache:false});
assert.equal(fetched.price,74.3);
assert.equal(fetched.executionEligible,false);
assert.equal(fetchCount,2,'historical adapter fetches both bars and status so it can state provenance accurately');
await assert.rejects(()=>fetchTejHqEod('TSLA',{allowedSymbols:['IRFC'],fetchImpl:mockFetch,now,useCache:false}),/TEJHQ_EOD_NOT_INDIAN_INSTRUMENT/);
console.log('tejhq-eod: valid historical candles, source-date provenance, bounded data scope and non-live execution gate passed');
