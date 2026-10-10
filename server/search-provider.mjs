const TIMEOUT_MS=Number(process.env.SEARCH_TIMEOUT_MS||8000);
const jsonHeaders={'Accept':'application/json'};
function providerError(message,status){const e=new Error(message);e.code='SEARCH_PROVIDER_UNAVAILABLE';if(Number.isFinite(Number(status)))e.status=Number(status);return e}
async function providerFetch(url,options={}){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),TIMEOUT_MS);
 try{const r=await fetch(url,{...options,signal:c.signal});if(!r.ok)throw providerError(`Search provider returned HTTP ${r.status}`,r.status);return await r.json()}
 catch(e){if(e.name==='AbortError')throw providerError('Search provider timed out');throw e}
 finally{clearTimeout(t)}
}
function resolveBingArticleUrl(value){
 const raw=String(value||'');
 try{
  const wrapper=new URL(raw);
  if(!/(^|\.)bing\.com$/i.test(wrapper.hostname)||!/^\/news\/apiclick\.aspx$/i.test(wrapper.pathname))return raw;
  const destination=wrapper.searchParams.get('url');
  if(!destination)return raw;
  const target=new URL(destination);
  if(target.protocol!=='https:'||target.username||target.password||!target.hostname)return raw;
  target.hash='';
  return target.href;
 }catch{return raw}
}
function normalize(items,provider){
 const seen=new Set(),out=[];
 for(const [i,x] of (items||[]).entries()){
  const url=resolveBingArticleUrl(x.url||x.link||'');
  if(!/^https?:\/\//i.test(url))continue;
  let canonical=url;
  try{
   const u=new URL(url);u.hash='';
   for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['fbclid','gclid','mc_cid','mc_eid'].includes(k.toLowerCase()))u.searchParams.delete(k);
   canonical=u.toString();if(canonical.endsWith('/'))canonical=canonical.slice(0,-1);
  }catch{}
  if(seen.has(canonical))continue;
  seen.add(canonical);
  out.push({
   id:provider+'-'+i+'-'+Buffer.from(url).toString('base64url').slice(0,12),
   title:String(x.title||x.name||'Untitled'),
   url,
   snippet:String(x.snippet||x.description||x.content||x.summary||(Array.isArray(x.snippet_highlighted_words)?x.snippet_highlighted_words.join(' '):'' )||''),
   source:String(x.source?.name||x.source||provider),
   provider,
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
   const title=cleanText(val('title')),link=cleanText(val('link')),snippet=cleanText(val('description')),publishedAt=val('pubDate'),source=cleanText(val('source'))||'Google News';
   if(/^https?:\/\//i.test(link))items.push({title,url:link,snippet,source,publishedAt});
  }
  return normalize(items,'google-news-rss');
 }catch(e){if(e.name==='AbortError')throw providerError('Google News RSS timed out');throw e}
 finally{clearTimeout(timer)}
}

async function bingNewsRss(q,count){
 const u='https://www.bing.com/news/search?q='+encodeURIComponent(q)+'&format=rss&mkt=en-in';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(TIMEOUT_MS,7000));
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotSearch/1.0','Accept':'application/rss+xml,application/xml,text/xml'}});
  if(!r.ok)throw providerError('Bing News RSS returned HTTP '+r.status);
  const xml=await r.text(),items=[];
  const blocks=xml.match(/<item>[\s\S]*?<\/item>/gi)||[];
  for(const block of blocks.slice(0,count)){
   const val=tag=>{const m=block.match(new RegExp('<'+tag+'>([\\s\\S]*?)<\\/'+tag+'>','i'));return m?m[1].replace(/<!\[CDATA\[|\]\]>/g,'').trim():''};
   const title=cleanText(val('title')),link=cleanText(val('link')),snippet=cleanText(val('description')),publishedAt=cleanText(val('pubDate')),source=cleanText(val('source'))||'Bing News';
   if(/^https?:\/\//i.test(link))items.push({title,url:link,snippet,source,publishedAt});
  }
  return normalize(items,'bing-news-rss');
 }catch(e){if(e.name==='AbortError')throw providerError('Bing News RSS timed out');throw e}
 finally{clearTimeout(timer)}
}


function htmlAttribute(attributes,name){
 const value=String(attributes||'');
 const double=value.match(new RegExp(name+'="([^"]*)"','i'));
 if(double)return cleanText(double[1]);
 const single=value.match(new RegExp(name+"='([^']*)'",'i'));
 return cleanText(single?single[1]:'');
}
function resolveDuckDuckGoUrl(value){
 const raw=String(value||'').trim();
 try{
  const wrapper=new URL(raw.startsWith('//')?'https:'+raw:raw,'https://html.duckduckgo.com');
  if(!/(^|\.)duckduckgo\.com$/i.test(wrapper.hostname)||!/^\/l\/?$/i.test(wrapper.pathname))return wrapper.href;
  const destination=wrapper.searchParams.get('uddg');
  if(!destination)return wrapper.href;
  const target=new URL(destination);
  if(!/^https?:$/.test(target.protocol)||target.username||target.password||!target.hostname)return raw;
  target.hash='';
  return target.href;
 }catch{return raw}
}
async function duckduckgoHtml(q,count){
 const u='https://html.duckduckgo.com/html/?q='+encodeURIComponent(q);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(TIMEOUT_MS,7000));
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotFreeSearch/1.0','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw providerError('DuckDuckGo search returned HTTP '+r.status,r.status);
  const html=await r.text();
  const anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const titleAnchors=anchors.filter(([,attrs])=>/\bresult__a\b/i.test(htmlAttribute(attrs,'class')));
  const snippets=anchors.filter(([,attrs])=>/\bresult__snippet\b/i.test(htmlAttribute(attrs,'class'))).map(([,attrs,body])=>cleanText(body));
  if(!titleAnchors.length&&/captcha|anomaly detected|bots use duckduckgo/i.test(html))throw providerError('DuckDuckGo returned an automated-access challenge');
  const items=[];
  for(let i=0;i<titleAnchors.length&&items.length<count;i++){
   const [,attrs,body]=titleAnchors[i];
   const url=resolveDuckDuckGoUrl(htmlAttribute(attrs,'href'));
   const title=cleanText(body);
   if(!/^https?:\/\//i.test(url)||!title)continue;
   let source='DuckDuckGo';
   try{source=new URL(url).hostname.replace(/^www\./i,'')}catch{}
   items.push({title,url,snippet:snippets[i]||'',source,publishedAt:null});
  }
  return normalize(items,'duckduckgo-html');
 }catch(e){
  if(e.name==='AbortError')throw providerError('DuckDuckGo search timed out');
  throw e;
 }finally{clearTimeout(timer)}
}
function canonicalSearchUrl(value){
 try{
  const u=new URL(value);u.hash='';
  for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['fbclid','gclid','mc_cid','mc_eid'].includes(k.toLowerCase()))u.searchParams.delete(k);
  return u.href.replace(/\/$/,'');
 }catch{return String(value||'').trim()}
}
function normalizedTitle(value){
 return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function freeSearchLinks(q){
 const x=encodeURIComponent(q);
 return [
  {provider:'DuckDuckGo',url:'https://duckduckgo.com/?q='+x},
  {provider:'Bing News',url:'https://www.bing.com/news/search?q='+x},
  {provider:'Google News',url:'https://news.google.com/search?q='+x}
 ];
}
async function searchFreeMultiSource(q,count){
 const tasks=[
  {provider:'duckduckgo-html',run:()=>duckduckgoHtml(q,count)},
  {provider:'bing-news-rss',run:()=>bingNewsRss(q,count)},
  {provider:'google-news-rss',run:()=>googleNewsRss(q,count)}
 ];
 const attempts=await Promise.all(tasks.map(async task=>{
  try{return {provider:task.provider,results:await task.run(),error:null}}
  catch(e){return {provider:task.provider,results:[],error:String(e?.message||'provider request failed').slice(0,220)}}
 }));
 const results=[],byUrl=new Map(),byTitle=new Map();
 for(const attempt of attempts){
  for(const row of attempt.results){
   const urlKey=canonicalSearchUrl(row.url);
   const titleKey=normalizedTitle(row.title);
   const existing=byUrl.get(urlKey);
   if(existing){
    const group=byTitle.get(titleKey);
    existing.matchingEngines=[...new Set([...(existing.matchingEngines||[]),attempt.provider])];
    existing.engineAgreementCount=existing.matchingEngines.length;
    if(group){
     group.engines.add(attempt.provider);
     for(const member of group.results){member.matchingEngines=[...group.engines];member.engineAgreementCount=group.engines.size;}
    }
    continue;
   }
   const group=byTitle.get(titleKey)||{engines:new Set(),results:[]};
   group.engines.add(attempt.provider);
   const item={...row,matchingEngines:[...group.engines],engineAgreementCount:group.engines.size,agreementBasis:'URL_OR_EXACT_TITLE'};
   group.results.push(item);
   for(const member of group.results){member.matchingEngines=[...group.engines];member.engineAgreementCount=group.engines.size;}
   byTitle.set(titleKey,group);
   byUrl.set(urlKey,item);
   results.push(item);
  }
 }
 const providers=attempts.filter(x=>x.results.length>0).map(x=>x.provider);
 const providerErrors=attempts.filter(x=>x.error).map(x=>({provider:x.provider,error:x.error}));
 if(!results.length){
  const detail=providerErrors.length?' Search attempts: '+providerErrors.map(x=>x.provider+': '+x.error).join(' | '):'';
  throw providerError('No live results were returned by the free multi-source search.'+detail);
 }
 results.sort((a,b)=>(Number(b.engineAgreementCount)||1)-(Number(a.engineAgreementCount)||1));
 const limit=Math.min(20,Math.max(count,count*2));
 const visible=results.slice(0,limit);
 return {
  provider:providers.length>1?'multi-free-search':providers[0],
  providers,
  attemptedProviders:tasks.map(x=>x.provider),
  providerErrors,
  results:visible,
  externalUrl:'https://www.google.com/search?q='+encodeURIComponent(q),
  externalUrls:freeSearchLinks(q),
  message:'Free multi-source search returned '+visible.length+' result(s). Results came from '+providers.join(', ')+'. Matching engines indicate URL/title agreement only, not independent verification of the underlying claim.',
  live:true,
  fetchedAt:new Date().toISOString(),
  cached:false
 };
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
 const errors=[];
 let freeAttempted=false;
 async function tryFree(){
  if(freeAttempted)return null;
  freeAttempted=true;
  try{return await searchFreeMultiSource(q,count)}
  catch(e){errors.push('free multi-source: '+(e?.message||'provider request failed'));return null}
 }
 if(requested==='free'||requested==='auto'){
  const free=await tryFree();
  if(free)return free;
  if(requested==='free'||!allowPaidFallback){
   throw providerError('No live results were returned by the configured free search providers.'+(errors.length?' Search attempts: '+errors.join(' | '):''));
  }
 }
 const order=requested==='auto'?['exa','serpapi','brave','tavily','google']:[requested];
 for(const p of order){
  try{
   let results=[];
   if(p==='brave'&&process.env.BRAVE_SEARCH_API_KEY)results=await brave(q,count);
   if(p==='tavily'&&process.env.TAVILY_API_KEY)results=await tavily(q,count);
   if(p==='google'&&process.env.GOOGLE_SEARCH_API_KEY&&process.env.GOOGLE_SEARCH_ENGINE_ID)results=await google(q,count);
   if(p==='exa'&&process.env.EXA_API_KEY)results=await exa(q,count);
   if(p==='serpapi'&&process.env.SERPAPI_API_KEY)results=await serpapi(q,count);
   if(results.length)return {provider:p,providers:[p],results,externalUrl:'https://www.google.com/search?q='+encodeURIComponent(q),externalUrls:freeSearchLinks(q),message:results.length+' live result(s) returned by '+p+'.',live:true,fetchedAt:new Date().toISOString(),cached:false};
  }catch(e){
   errors.push(p+': '+(e?.message||'provider request failed'));
   const quotaOrBilling=e?.status===402||e?.status===429||/quota|billing|payment required|credits exhausted|rate limit/i.test(String(e?.message||''));
   if(quotaOrBilling)break;
  }
 }
 const free=await tryFree();
 if(free)return free;
 const detail=errors.length?' Search attempts: '+errors.join(' | '):'';
 throw providerError('No live results were returned by the configured search provider.'+detail);
}
export async function searchWeb(q,{count=8,forceRefresh=false,freeOnly=false}={}){
 const query=String(q??'').replace(/\s+/g,' ').trim();
 if(!query)throw providerError('Search query is empty.');
 const safeCount=Math.min(10,Math.max(1,Math.trunc(Number(count)||8)));
 const requested=freeOnly?'free':(process.env.SEARCH_PROVIDER||'auto').toLowerCase();
 const baseKey=searchCacheKey(query,safeCount,requested);
 const key=baseKey;
 if(forceRefresh)SEARCH_CACHE.delete(baseKey);
 if(!forceRefresh&&SEARCH_CACHE_TTL_MS>0){
  trimSearchCache();
  const hit=SEARCH_CACHE.get(baseKey);
  if(hit&&hit.expiresAt>Date.now()){
   SEARCH_CACHE.delete(baseKey);SEARCH_CACHE.set(baseKey,hit);
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
   SEARCH_CACHE.set(baseKey,{data:{...data},fetchedAtMs,expiresAt:fetchedAtMs+SEARCH_CACHE_TTL_MS});
   trimSearchCache();
  }
  return data;
 }finally{
  if(SEARCH_INFLIGHT.get(key)===request)SEARCH_INFLIGHT.delete(key);
 }
}
