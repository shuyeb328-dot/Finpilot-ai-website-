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
  if(String(url).includes('api.exa.ai')) return {ok:false,status:402,text:async()=>''};
  await new Promise(resolve=>setTimeout(resolve,15));
  const xml=emptyMode
    ? '<rss><channel></channel></rss>'
    : '<rss><channel><item><title>Quota test source</title><link>https://example.com/finpilot-quota-test</link><description>Evidence for the search cache test with enough context.</description><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source>Example News</source></item><item><title>Duplicate tracking variant</title><link>https://example.com/finpilot-quota-test?utm_source=test#article</link><description>Duplicate story with tracking parameters.</description><source>Another Source</source></item></channel></rss>';
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
  assert.equal(first.results[0].url,'https://example.com/finpilot-quota-test','keep the clean source URL when duplicate tracking variants exist');
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

  // An explicit user refresh bypasses the successful-result cache and replaces it on success.
  const forced=await searchWeb('FINPILOT quota cache test',{count:3,forceRefresh:true});
  assert.equal(fetchCalls,2,'forceRefresh must make a new free-source request instead of reusing cache');
  assert.equal(forced.live,true,'forced refresh should preserve the provider live flag');
  assert.equal(forced.cached,false,'forced refresh must not label the new fetch cached');
  const updatedCache=await searchWeb('finpilot quota cache test',{count:3});
  assert.equal(fetchCalls,2,'successful forced refresh should repopulate the normal query cache');
  assert.equal(updatedCache.cached,true,'the result of a successful refresh should become cacheable');


  emptyMode=true;
  await assert.rejects(()=>searchWeb('FinPilot cache must not store empty results',{count:3}));
  const afterOneFailure=fetchCalls;
  await assert.rejects(()=>searchWeb('FinPilot cache must not store empty results',{count:3}));
  assert.equal(fetchCalls,afterOneFailure+1,'empty/error results must not be cached');

  // In auto mode, a free RSS result must win without touching a configured metered provider.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='auto';
  process.env.EXA_API_KEY='test-metered-key';
  const freeFirst=await searchWeb('FinPilot free-first fallback test',{count:3});
  assert.equal(freeFirst.provider,'google-news-rss');
  assert.equal(fetchCalls,1,'free RSS should satisfy auto search before any metered provider is called');

  // Even when a metered key exists, empty RSS results must not trigger paid calls by default.
  emptyMode=true;
  fetchCalls=0;
  process.env.SEARCH_ALLOW_PAID_FALLBACK='false';
  await assert.rejects(()=>searchWeb('FinPilot never spend by default test',{count:3}));
  assert.equal(fetchCalls,1,'failed free RSS should not call a metered provider unless fallback is explicitly enabled');

  // Explicit provider mode may fall back to free RSS, but a billing error must not block that free fallback.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='exa';
  const afterBilling=await searchWeb('FinPilot free fallback after billing error',{count:3});
  assert.equal(afterBilling.provider,'google-news-rss');
  assert.equal(fetchCalls,2,'a billing error should stop paid retries but still allow one free RSS fallback');
  // Task-specific supplemental discovery must be free-only even if paid fallback is configured.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='exa';
  process.env.EXA_API_KEY='test-metered-key';
  process.env.SEARCH_ALLOW_PAID_FALLBACK='true';
  const explicitlyFree=await searchWeb('FinPilot explicit free-only supplemental discovery',{count:4,freeOnly:true,forceRefresh:true});
  assert.equal(explicitlyFree.provider,'google-news-rss','freeOnly must force the public RSS source even if EXA is configured');
  assert.equal(fetchCalls,1,'freeOnly must not call any metered provider');
  // Task-specific supplemental discovery must remain free-only even when paid fallback is enabled.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='exa';
  process.env.EXA_API_KEY='test-metered-key';
  process.env.SEARCH_ALLOW_PAID_FALLBACK='true';
  const explicitlyFree=await searchWeb('FinPilot explicit free-only supplemental discovery',{count:4,freeOnly:true,forceRefresh:true});
  assert.equal(explicitlyFree.provider,'google-news-rss','freeOnly must override the configured metered provider');
  assert.equal(fetchCalls,1,'freeOnly must not call metered providers');
  console.log('PASS search provider cache: in-flight dedupe, TTL cache labels, empty-result non-caching, free-first auto search, paid-fallback guard, billing-error free fallback');
}finally{
  globalThis.fetch=originalFetch;
}
