import assert from 'node:assert/strict';

// Keep this offline regression test isolated even when the service has live provider keys.
for (const key of ['EXA_API_KEY','SERPAPI_API_KEY','BRAVE_SEARCH_API_KEY','TAVILY_API_KEY','GOOGLE_SEARCH_API_KEY','GOOGLE_SEARCH_ENGINE_ID']) delete process.env[key];
process.env.SEARCH_PROVIDER='google';
process.env.SEARCH_CACHE_TTL_MS='60000';

let fetchCalls=0;
let emptyMode=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  fetchCalls++;
  await new Promise(resolve=>setTimeout(resolve,15));
  const xml=emptyMode
    ? '<rss><channel></channel></rss>'
    : '<rss><channel><item><title>Quota test source</title><link>https://example.com/finpilot-quota-test</link><description>Evidence for the search cache test with enough context.</description><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source>Example News</source></item></channel></rss>';
  return {ok:true,status:200,text:async()=>xml};
};

try{
  const {searchWeb}=await import('../server/search-provider.mjs');
  const [first,parallel]=await Promise.all([
    searchWeb('FinPilot quota cache test',{count:3}),
    searchWeb('  finpilot   QUOTA cache TEST  ',{count:3})
  ]);
  assert.equal(fetchCalls,1,'identical in-flight queries should share one upstream fetch');
  assert.equal(first.results.length,1);
  assert.equal(first.live,true);
  assert.ok(first.coalesced===true||parallel.coalesced===true,'one caller should identify coalesced request');

  const cached=await searchWeb('FINPILOT quota cache test',{count:3});
  assert.equal(fetchCalls,1,'repeat query within TTL should not fetch upstream again');
  assert.equal(cached.cached,true);
  assert.equal(cached.live,false,'cached evidence must not be presented as newly live');
  assert.equal(cached.originalLive,true);
  assert.equal(cached.freshness,'CACHED');
  assert.ok(cached.cacheAgeMs>=0);
  assert.equal(cached.results.length,1);

  emptyMode=true;
  await assert.rejects(()=>searchWeb('FinPilot cache must not store empty results',{count:3}));
  const afterOneFailure=fetchCalls;
  await assert.rejects(()=>searchWeb('FinPilot cache must not store empty results',{count:3}));
  assert.equal(fetchCalls,afterOneFailure+1,'empty/error results must not be cached');
  console.log('PASS search provider cache: in-flight dedupe, TTL cache labels, empty-result non-caching');
}finally{
  globalThis.fetch=originalFetch;
}
