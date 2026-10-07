const TIMEOUT_MS=Number(process.env.SEARCH_TIMEOUT_MS||8000);
const jsonHeaders={'Accept':'application/json'};
function providerError(message){const e=new Error(message);e.code='SEARCH_PROVIDER_UNAVAILABLE';return e}
async function providerFetch(url,options={}){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),TIMEOUT_MS);
 try{const r=await fetch(url,{...options,signal:c.signal});if(!r.ok)throw providerError(`Search provider returned HTTP ${r.status}`);return await r.json()}
 catch(e){if(e.name==='AbortError')throw providerError('Search provider timed out');throw e}
 finally{clearTimeout(t)}
}
function normalize(items,provider){
 return (items||[]).map((x,i)=>({id:`${provider}-${i}-${Buffer.from(String(x.url||x.link||'' )).toString('base64url').slice(0,12)}`,title:String(x.title||x.name||'Untitled'),url:String(x.url||x.link||''),snippet:String(x.snippet||x.description||x.content||''),source:String(x.source||provider),publishedAt:x.publishedAt||x.published_date||x.date||null})).filter(x=>/^https?:\\/\\//i.test(x.url));
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
async function serpapi(q,count){
 const key=process.env.SERPAPI_API_KEY;
 if(!key) throw providerError('SERPAPI_API_KEY is not configured');
 const engine=process.env.SERPAPI_ENGINE||'google_news';
 const gl=process.env.SERPAPI_GL||'in';
 const hl=process.env.SERPAPI_HL||'en';
 const sort=process.env.SERPAPI_SORT||'1';
 const u=new URL('https://serpapi.com/search.json');
 u.searchParams.set('engine',engine);
 u.searchParams.set('api_key',key);
 u.searchParams.set('q',q);
 u.searchParams.set('gl',gl);
 u.searchParams.set('hl',hl);
 u.searchParams.set('so',sort);
 const d=await providerFetch(u.toString(),{headers:jsonHeaders});
 if(d.error) throw providerError(String(d.error));
 return normalize((d.news_results||[]).map(x=>({...x,url:x.link,source:x.source?.name||'Google News'})).slice(0,count),'serpapi');
}

export async function searchWeb(q,{count=8}={}){
 const requested=(process.env.SEARCH_PROVIDER||'auto').toLowerCase();
 const order=requested==='serpapi'?['serpapi']:requested==='brave'?['brave']:requested==='tavily'?['tavily']:requested==='google'?['google']:['serpapi','brave','tavily','google'];
 for(const p of order){
  try{
   let results=[];
   if(p==='brave'&&process.env.BRAVE_SEARCH_API_KEY)results=await brave(q,count);
   if(p==='tavily'&&process.env.TAVILY_API_KEY)results=await tavily(q,count);
   if(p==='google'&&process.env.GOOGLE_SEARCH_API_KEY&&process.env.GOOGLE_SEARCH_ENGINE_ID)results=await google(q,count);
   if(p==='serpapi'&&process.env.SERPAPI_API_KEY)results=await serpapi(q,count);
   if(results.length)return {provider:p,results,externalUrl:`https://www.google.com/search?q=${encodeURIComponent(q)}`,message:`${results.length} live result(s) returned by ${p}.`,live:true,fetchedAt:new Date().toISOString()};
  }catch(e){continue}
 }
 throw providerError('No working search provider is configured. Set SEARCH_PROVIDER and the matching server-side API key.');
}