const TIMEOUT_MS=Number(process.env.SEARCH_TIMEOUT_MS||8000);
const jsonHeaders={'Accept':'application/json'};
function providerError(message,status){const e=new Error(message);e.code='SEARCH_PROVIDER_UNAVAILABLE';if(Number.isFinite(Number(status)))e.status=Number(status);return e}
async function providerFetch(url,options={}){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),TIMEOUT_MS);
 try{const r=await fetch(url,{...options,signal:c.signal});if(!r.ok)throw providerError(`Search provider returned HTTP ${r.status}`,r.status);return await r.json()}
 catch(e){if(e.name==='AbortError')throw providerError('Search provider timed out');throw e}
 finally{clearTimeout(t)}
}
function normalize(items,provider){
 const seen=new Set(),out=[];
 for(const [i,x] of (items||[]).entries()){
  const url=String(x.url||x.link||'');
  if(!/^https?:\/\//i.test(url))continue;
  let canonical=url;
  try{
   const u=new URL(url);u.hash='';
   for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['fbclid','gclid','mc_cid','mc_eid'].includes(k.toLowerCase()))u.searchParams.delete(k);
   canonical=u.toString().replace(/\\/$/,'');
  }catch{}
  if(seen.has(canonical))continue;
  seen.add(canonical);
  out.push({
   id:provider+'-'+i+'-'+Buffer.from(url).toString('base64url').slice(0,12),
   title:String(x.title||x.name||'Untitled'),
   url,
   snippet:String(x.snippet||x.description||x.content||x.summary||(Array.isArray(x.snippet_highlighted_words)?x.snippet_highlighted_words.join(' '):'' )||''),
   source:String(x.source?.name||x.source||provider),
   publishedAt:x.publishedAt||x.published_date||x.date||null
  });
 }
 return out;
}
function cleanText(v){
 return String(v||'')
  .replace(/<[^>]*>/g,' ')
  .replace(/&nbsp;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;/g,"'")
  .replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>')
  .replace(/&#x27;/gi,"'")
  .replace(/&#x2F;/gi,'/')
  .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
  .replace(/<[^>]*>/g,' ')
  .replace(/\s+/g,' ').trim();
}
async function fetchPageText(url){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),2500);
 try{
  const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotEvidence/1.0','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)return '';
  const html=await r.text();
  const metas=[...html.matchAll(/<meta\s+[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["'][^>]*>/gi)];
  for(const m of metas){const s=cleanText(m[1]);if(s.length>40)return s.slice(0,500);}
  const reverse=[...html.matchAll(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/gi)];
  for(const m of reverse){const s=cleanText(m[1]);if(s.length>40)return s.slice(0,500);}
  return '';
 }catch{return ''}finally{clearTimeout(t)}
}
async function enrichResults(results){
 return await Promise.all(results.map(async x=>{
  if(x.snippet)return x;
  const snippet=await fetchPageText(x.url);
  return snippet?{...x,snippet}:x;
 }));
}
async function brave(q,count){
 const d=await providerFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`,{headers:{...jsonHeaders,'X-Subscription-Token':process.env.BRAVE_SEARCH_API_KEY}});
 return normalize(d.web?.results,'brave');
}
async function tavily(q,count){
 const d=await providerFetch('https://api.tavily.com/search',{method:'POST',headers:{...jsonHeaders,'Content-Type':'application/json'},body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query:q,max_results:count,include_answer:false})});
 return normalize(d.results,'tavily');
}
async function google(q,count){
 const u=`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_SEARCH_API_KEY)}&cx=${encodeURIComponent(process.env.GOOGLE_SEARCH_ENGINE_ID)}&num=${Math.min(10,count)}&q=${encodeURIComponent(q)}`;
 const d=await providerFetch(u,{headers:jsonHeaders}); return normalize(d.items,'google');
}
async function exa(q,count){
 const key=process.env.EXA_API_KEY;
 if(!key) throw providerError('EXA_API_KEY is not configured');
 const d=await providerFetch('https://api.exa.ai/search',{method:'POST',headers:{...jsonHeaders,'Content-Type':'application/json','x-api-key':key},body:JSON.stringify({query:q,numResults:Math.min(10,count),type:'auto',contents:{highlights:{maxCharacters:1200}}})});
 return normalize((d.results||[]).map(x=>({title:x.title,url:x.url,snippet:Array.isArray(x.highlights)?x.highlights.join(' '):(x.text||x.summary||''),source:'Exa',publishedAt:x.publishedDate||x.published_date||null})),'exa');
}

async function serpapi(q,count){
 const key=process.env.SERPAPI_API_KEY;
 if(!key) throw providerError('SERPAPI_API_KEY is not configured');
 const engine=process.env.SERPAPI_ENGINE||'google_news';
 const gl=process.env.SERPAPI_GL||'in';
 const hl=process.env.SERPAPI_HL||'en';
 const u=new URL('https://serpapi.com/search.json');
 u.searchParams.set('engine',engine);
 u.searchParams.set('api_key',key);
 u.searchParams.set('q',q);
 u.searchParams.set('gl',gl);
 u.searchParams.set('hl',hl);
 const d=await providerFetch(u.toString(),{headers:jsonHeaders});
 if(d.error) throw providerError(String(d.error));
 const results=normalize((d.news_results||[]).map(x=>({...x,url:x.link,source:x.source?.name||'Google News'})).slice(0,count),'serpapi');
 return enrichResults(results);
}

async function googleNewsRss(q,count){
 const u='https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=en-IN&gl=IN&ceid=IN:en';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(TIMEOUT_MS,7000));
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotSearch/1.0','Accept':'application/rss+xml,application/xml,text/xml'}});
  if(!r.ok)throw providerError('Google News RSS returned HTTP '+r.status);
  const xml=await r.text(),items=[];
  const blocks=xml.match(/<item>[\s\S]*?<\/item>/gi)||[];
  for(const block of blocks.slice(0,count)){
   const val=tag=>{const m=block.match(new RegExp('<'+tag+'>([\\s\\S]*?)<\\/'+tag+'>','i'));return m?m[1].replace(/<!\[CDATA\[|\]\]>/g,'').trim():''};
   const title=cleanText(val('title')),link=val('link'),snippet=cleanText(val('description')),publishedAt=val('pubDate'),source=cleanText(val('source'))||'Google News';
   if(/^https?:\/\//i.test(link))items.push({title,url:link,snippet,source,publishedAt});
  }
  return normalize(items,'google-news-rss');
 }catch(e){if(e.name==='AbortError')throw providerError('Google News RSS timed out');throw e}
 finally{clearTimeout(timer)}
}

const configuredSearchCacheTtl=Number(process.env.SEARCH_CACHE_TTL_MS);
const SEARCH_CACHE_TTL_MS=Number.isFinite(configuredSearchCacheTtl)
 ?Math.max(0,Math.min(60*60*1000,configuredSearchCacheTtl))
 :10*60*1000;
const SEARCH_CACHE_MAX=300;
const SEARCH_CACHE=new Map();
const SEARCH_INFLIGHT=new Map();

function searchCacheKey(q,count,requested){
 const providers=[
  Boolean(process.env.EXA_API_KEY),Boolean(process.env.SERPAPI_API_KEY),
  Boolean(process.env.BRAVE_SEARCH_API_KEY),Boolean(process.env.TAVILY_API_KEY),
  Boolean(process.env.GOOGLE_SEARCH_API_KEY&&process.env.GOOGLE_SEARCH_ENGINE_ID)
 ].map(x=>x?'1':'0').join('');
 const paidFallback=String(process.env.SEARCH_ALLOW_PAID_FALLBACK||'false').toLowerCase()==='true'?'paid-fallback-on':'paid-fallback-off';
 return [requested,paidFallback,q.toLowerCase().replace(/\s+/g,' ').trim(),count,providers].join('|');
}
function trimSearchCache(){
 const now=Date.now();
 for(const [key,value] of SEARCH_CACHE)if(value.expiresAt<=now)SEARCH_CACHE.delete(key);
 while(SEARCH_CACHE.size>SEARCH_CACHE_MAX)SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
}
async function searchWebUncached(q,count,requested){
 const allowPaidFallback=String(process.env.SEARCH_ALLOW_PAID_FALLBACK||'false').toLowerCase()==='true';
 // Keep the default search path free: use Google News RSS first and do not call metered APIs unless explicitly enabled.
 const order=requested==='free'?['google-news-rss']:requested==='auto'&&!allowPaidFallback?['google-news-rss']:requested==='auto'?['google-news-rss','exa','serpapi','brave','tavily','google']:requested==='exa'?['exa','google-news-rss']:requested==='serpapi'?['serpapi','exa','google-news-rss']:requested==='brave'?['brave','exa','google-news-rss']:requested==='tavily'?['tavily','exa','google-news-rss']:requested==='google'?['google','exa','google-news-rss']:['google-news-rss'];
 const errors=[];let paidProviderBlocked=false;
 for(const p of order){
  if(paidProviderBlocked&&p!=='google-news-rss')continue;
  try{
   let results=[];
   if(p==='brave'&&process.env.BRAVE_SEARCH_API_KEY)results=await brave(q,count);
   if(p==='tavily'&&process.env.TAVILY_API_KEY)results=await tavily(q,count);
   if(p==='google'&&process.env.GOOGLE_SEARCH_API_KEY&&process.env.GOOGLE_SEARCH_ENGINE_ID)results=await google(q,count);
   if(p==='exa'&&process.env.EXA_API_KEY)results=await exa(q,count);
   if(p==='serpapi'&&process.env.SERPAPI_API_KEY)results=await serpapi(q,count);
   if(p==='google-news-rss')results=await googleNewsRss(q,count);
   if(results.length)return {provider:p,results,externalUrl:'https://www.google.com/search?q='+encodeURIComponent(q),message:results.length+' live result(s) returned by '+p+'.',live:true,fetchedAt:new Date().toISOString(),cached:false};
  }catch(e){errors.push(p+': '+(e?.message||'provider request failed'));const quotaOrBilling=e?.status===402||e?.status===429||/quota|billing|payment required|credits exhausted|rate limit/i.test(String(e?.message||''));if(quotaOrBilling&&p!=='google-news-rss'){paidProviderBlocked=true;}continue}
 }
 const detail=errors.length?' Search attempts: '+errors.join(' | '):'';
 throw providerError('No live results were returned by the configured search provider.'+detail);
}

export async function searchWeb(q,{count=8}={}){
 const query=String(q??'').replace(/\s+/g,' ').trim();
 if(!query)throw providerError('Search query is empty.');
 const safeCount=Math.min(10,Math.max(1,Math.trunc(Number(count)||8)));
 const requested=(process.env.SEARCH_PROVIDER||'auto').toLowerCase();
 const key=searchCacheKey(query,safeCount,requested);
 if(SEARCH_CACHE_TTL_MS>0){
  trimSearchCache();
  const hit=SEARCH_CACHE.get(key);
  if(hit&&hit.expiresAt>Date.now()){
   SEARCH_CACHE.delete(key);SEARCH_CACHE.set(key,hit);
   const cacheAgeMs=Math.max(0,Date.now()-hit.fetchedAtMs);
   return {...hit.data,live:false,cached:true,originalLive:hit.data.live===true,
    freshness:'CACHED',cacheAgeMs,
    message:'Cached '+hit.data.results.length+' result(s) from '+hit.data.provider+'; original fetch '+Math.round(cacheAgeMs/1000)+' second(s) ago.'};
  }
 }
 const pending=SEARCH_INFLIGHT.get(key);
 if(pending){
  const data=await pending;
  return {...data,coalesced:true,cached:false};
 }
 const request=searchWebUncached(query,safeCount,requested);
 SEARCH_INFLIGHT.set(key,request);
 try{
  const data=await request;
  if(SEARCH_CACHE_TTL_MS>0&&Array.isArray(data.results)&&data.results.length){
   const fetchedAtMs=Date.now();
   SEARCH_CACHE.set(key,{data:{...data},fetchedAtMs,expiresAt:fetchedAtMs+SEARCH_CACHE_TTL_MS});
   trimSearchCache();
  }
  return data;
 }finally{
  if(SEARCH_INFLIGHT.get(key)===request)SEARCH_INFLIGHT.delete(key);
 }
}
