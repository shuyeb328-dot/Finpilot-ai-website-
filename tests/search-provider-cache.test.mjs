import assert from 'node:assert/strict';

// Keep this offline regression test isolated even when the service has live provider keys.
for (const key of ['EXA_API_KEY','SERPAPI_API_KEY','BRAVE_SEARCH_API_KEY','TAVILY_API_KEY','GOOGLE_SEARCH_API_KEY','GOOGLE_SEARCH_ENGINE_ID']) delete process.env[key];
process.env.SEARCH_PROVIDER='google';
process.env.SEARCH_CACHE_TTL_MS='60000';

let fetchCalls=0;
let emptyMode=false;
let wrapperMode=false;
let rankingMode=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  fetchCalls++;
  const href=String(url);
  if(rankingMode && (href.includes('www.bing.com/search?') || href.includes('www.bing.com/news/search?') || href.includes('news.google.com/rss/search?'))){
    const published=new Date().toUTCString();
    const item=(title,link,description,date,source)=>'<item><title>'+title+'</title><link>'+link+'</link><description>'+description+'</description><pubDate>'+date+'</pubDate><source>'+source+'</source></item>';
    const generic=item('Microsoft Singapore','https://www.microsoft.com/en-sg/','Microsoft regional homepage.',published,'Microsoft');
    const story=item('Microsoft Q4 earnings and revenue top estimates','https://example.com/msft-earnings','Microsoft reported quarterly earnings and revenue above analyst expectations.',published,'Example Finance');
    const stale=item('Microsoft earnings report and quarterly outlook','https://example.com/msft-earnings-stale','Older review of Microsoft earnings and outlook.',new Date(Date.now()-65*86400000).toUTCString(),'Archive Finance');
    const rows=href.includes('www.bing.com/search?')?generic+stale:story+generic;
    return {ok:true,status:200,text:async()=>'<rss><channel>'+rows+'</channel></rss>'};
  }
  if(href.includes('api.exa.ai')) return {ok:false,status:402,text:async()=>''};
  await new Promise(resolve=>setTimeout(resolve,15));
  if(href.includes('www.bing.com/search?')){
    if(emptyMode)return {ok:true,status:200,text:async()=>'<rss><channel></channel></rss>'};
    const title=wrapperMode?'Resolved publisher story':'Quota test source';
    const snippet=wrapperMode?'Article-link resolver regression test with enough readable context.':'Evidence for the search cache test with enough context.';
    const xml=wrapperMode
      ? '<rss><channel><item><title>Resolved publisher story</title><link>https://example.com/finpilot-quota-test</link><description>Article-link resolver regression test with enough readable context.</description><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source>Example News</source></item></channel></rss>'
      : '<rss><channel><item><title>Quota test source</title><link>https://example.com/finpilot-quota-test</link><description>Evidence for the search cache test with enough context.</description><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source>Example News</source></item></channel></rss>';
    return {ok:true,status:200,text:async()=>xml};
  }
  if(href.includes('search.brave.com/search')){
    if(emptyMode)return {ok:true,status:200,text:async()=>'<html><body>No results</body></html>'};
    const title=wrapperMode?'Resolved publisher story':'Quota test source';
    const snippet=wrapperMode?'Article-link resolver regression test with enough readable context.':'Evidence for the search cache test with enough context.';
    return {ok:true,status:200,text:async()=>'<div class="snippet" data-type="web" data-pos="1"><div class="result-content"><a href="https://example.com/finpilot-quota-test"><h3>'+title+'</h3><div class="description">'+snippet+'</div></a></div></div>'};
  }
  if(href.includes('search.yahoo.com/search')){
    if(emptyMode)return {ok:true,status:200,text:async()=>'<html><body>No results</body></html>'};
    const title=wrapperMode?'Resolved publisher story':'Quota test source';
    const snippet=wrapperMode?'Article-link resolver regression test with enough readable context.':'Evidence for the search cache test with enough context.';
    return {ok:true,status:200,text:async()=>'<html><body><a class="ac-algo title" href="https://example.com/finpilot-quota-test">'+title+'</a><p class="compText">'+snippet+'</p></body></html>'};
  }
  if(href.includes('lite.duckduckgo.com')){
    if(emptyMode)return {ok:true,status:200,text:async()=>'<html><body>No results</body></html>'};
    const title=wrapperMode?'Resolved publisher story':'Quota test source';
    const snippet=wrapperMode?'Article-link resolver regression test with enough readable context.':'Evidence for the search cache test with enough context.';
    return {ok:true,status:200,text:async()=>'<html><body><a class="result-link" href="https://example.com/finpilot-quota-test">'+title+'</a><a class="result-snippet">'+snippet+'</a></body></html>'};
  }
  const xml=emptyMode
    ? '<rss><channel></channel></rss>'
    : wrapperMode
      ? '<rss><channel><item><title>Resolved publisher story</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3A%2F%2Fexample.com%2Ffinpilot-quota-test&amp;c=123</link><description>Article-link resolver regression test with enough readable context.</description><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source>Example News</source></item><item><title>Duplicate tracking variant</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3A%2F%2Fexample.com%2Ffinpilot-quota-test%3Futm_source%3Dtest&amp;c=456</link><description>Duplicate story with tracking parameters.</description><source>Another Source</source></item></channel></rss>'
      : '<rss><channel><item><title>Quota test source</title><link>https://example.com/finpilot-quota-test</link><description>Evidence for the search cache test with enough context.</description><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source>Example News</source></item><item><title>Duplicate tracking variant</title><link>https://example.com/finpilot-quota-test?utm_source=test#article</link><description>Duplicate tracking variant with enough readable context.</description><source>Another Source</source></item></channel></rss>';
  return {ok:true,status:200,text:async()=>xml};
};

try{
  const {searchWeb}=await import('../server/search-provider.mjs');
  const [first,parallel]=await Promise.all([
    searchWeb('FinPilot quota cache test',{count:3}),
    searchWeb('  finpilot   QUOTA cache TEST  ',{count:3})
  ]);
  assert.equal(fetchCalls,5,'identical in-flight queries should share one five-source fan-out');
  assert.equal(first.results.length,1);
  assert.equal(first.results[0].url,'https://example.com/finpilot-quota-test','keep the clean source URL when duplicate tracking variants exist');
  assert.equal(first.live,true);
  assert.equal(first.provider,'multi-free-search');
  assert.deepEqual(first.providers,['bing-web-rss','bing-news-rss','google-news-rss','duckduckgo-html','yahoo-html']);
  assert.deepEqual(first.attemptedProviders,['bing-web-rss','bing-news-rss','google-news-rss','duckduckgo-html','yahoo-html']);
  assert.equal(first.results[0].engineAgreementCount,5,'matching URLs or exact titles should record which engines found the item');
  assert.ok(first.coalesced===true||parallel.coalesced===true,'one caller should identify coalesced request');

  const cached=await searchWeb('FINPILOT quota cache test',{count:3});
  assert.equal(fetchCalls,5,'repeat query within TTL should not fetch upstream again');
  assert.equal(cached.cached,true);
  assert.equal(cached.live,false,'cached evidence must not be presented as newly live');
  assert.equal(cached.originalLive,true);
  assert.equal(cached.freshness,'CACHED');
  assert.ok(cached.cacheAgeMs>=0);
  assert.equal(cached.results.length,1);

  // An explicit user refresh bypasses the successful-result cache and replaces it on success.
  const forced=await searchWeb('FINPILOT quota cache test',{count:3,forceRefresh:true});
  assert.equal(fetchCalls,10,'forceRefresh must make a new five-source request instead of reusing cache');
  assert.equal(forced.live,true,'forced refresh should preserve the provider live flag');
  assert.equal(forced.cached,false,'forced refresh must not label the new fetch cached');
  const updatedCache=await searchWeb('finpilot quota cache test',{count:3});
  assert.equal(fetchCalls,10,'successful forced refresh should repopulate the normal query cache');
  assert.equal(updatedCache.cached,true,'the result of a successful refresh should become cacheable');


  emptyMode=true;
  await assert.rejects(()=>searchWeb('FinPilot cache must not store empty results',{count:3}));
  const afterOneFailure=fetchCalls;
  await assert.rejects(()=>searchWeb('FinPilot cache must not store empty results',{count:3}));
  assert.equal(fetchCalls,afterOneFailure+5,'empty/error results must not be cached; each retry should try all enabled free providers');

  // In auto mode, a free RSS result must win without touching a configured metered provider.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='auto';
  process.env.EXA_API_KEY='test-metered-key';
  const freeFirst=await searchWeb('FinPilot free-first fallback test',{count:3});
  assert.equal(freeFirst.provider,'multi-free-search');
  assert.deepEqual(freeFirst.providers,['bing-web-rss','bing-news-rss','google-news-rss','duckduckgo-html','yahoo-html']);
  assert.equal(fetchCalls,5,'free multi-source search should satisfy auto search without calling a metered provider');

  // Even when a metered key exists, empty RSS results must not trigger paid calls by default.
  emptyMode=true;
  fetchCalls=0;
  process.env.SEARCH_ALLOW_PAID_FALLBACK='false';
  await assert.rejects(()=>searchWeb('FinPilot never spend by default test',{count:3}));
  assert.equal(fetchCalls,5,'failed free multi-source search should not call a metered provider by default');

  // Explicit provider mode may fall back to free RSS, but a billing error must not block that free fallback.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='exa';
  const afterBilling=await searchWeb('FinPilot free fallback after billing error',{count:3});
  assert.equal(afterBilling.provider,'multi-free-search');
  assert.equal(fetchCalls,6,'a billing error should stop paid retries while all free providers remain available');
  // Task-specific supplemental discovery must remain free-only even when paid fallback is enabled.
  emptyMode=false;
  fetchCalls=0;
  process.env.SEARCH_PROVIDER='exa';
  process.env.EXA_API_KEY='test-metered-key';
  process.env.SEARCH_ALLOW_PAID_FALLBACK='true';
  const explicitlyFree=await searchWeb('FinPilot explicit free-only supplemental discovery',{count:4,freeOnly:true,forceRefresh:true});
  assert.equal(explicitlyFree.provider,'multi-free-search','freeOnly must override the configured metered provider');
  assert.equal(fetchCalls,5,'freeOnly must use free sources only and never call metered providers');

  wrapperMode=true;
  fetchCalls=0;
  const resolved=await searchWeb('FinPilot Bing publisher URL resolution',{count:4,freeOnly:true,forceRefresh:true});
  assert.equal(resolved.provider,'multi-free-search');
  assert.equal(resolved.results.length,1,'Bing redirect variants resolving to the same publisher article must be deduplicated');
  assert.equal(resolved.results[0].url,'https://example.com/finpilot-quota-test','Bing RSS wrapper must resolve to the publisher HTTPS URL before article retrieval');
  assert.equal(fetchCalls,5,'publisher-link resolution must not trigger any extra provider requests beyond the bounded fan-out');

  // Query relevance must outrank raw engine agreement: the generic homepage appears in all three feeds,
  // while the earnings story appears in only two, but the earnings story must rank first.
  rankingMode=true;
  wrapperMode=false;
  fetchCalls=0;
  const ranked=await searchWeb('Microsoft earnings',{count:5,freeOnly:true,forceRefresh:true});
  assert.equal(ranked.live,true);
  assert.equal(fetchCalls,5,'ranking must not add extra provider requests');
  assert.match(ranked.results[0].title,/earnings/i,'query-relevant finance result should beat generic high-agreement result');
  const genericResult=ranked.results.find(x=>/Microsoft Singapore/i.test(x.title));
  assert.ok(genericResult,'fixture should include generic high-agreement result');
  assert.equal(genericResult.engineAgreementCount,5,'generic page fixture should retain its five-engine agreement');
  assert.ok(ranked.results[0].relevanceScore>genericResult.relevanceScore,'relevance score should place earnings result above generic result');
  assert.equal(ranked.results[0].engineAgreementCount,2,'earnings fixture has lower agreement, proving relevance ranks first');
  const staleResult=ranked.results.find(x=>x.url==='https://example.com/msft-earnings-stale');
  assert.ok(staleResult,'fixture should include a stale-but-relevant article');
  assert.ok(ranked.results[0].relevanceScore>staleResult.relevanceScore,'fresh relevant earnings result should outrank an older near-duplicate');
  assert.equal(ranked.results[0].relevanceSignals.allQueryTermsInTitle,true);
  assert.match(ranked.message,/heuristic ranking aids/i);
  rankingMode=false;

  console.log('PASS search provider cache + relevance ranking: in-flight dedupe, TTL cache labels, empty-result non-caching, free-first RSS sources, paid-fallback guard, clean source URLs and query relevance ahead of engine agreement');
}finally{
  globalThis.fetch=originalFetch;
}
