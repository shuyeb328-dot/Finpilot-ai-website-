const TIMEOUT_MS=Number(process.env.SEARCH_TIMEOUT_MS||8000);
const configuredFreeTimeout=Number(process.env.FREE_SEARCH_TIMEOUT_MS||4500);
const FREE_SEARCH_TIMEOUT_MS=Number.isFinite(configuredFreeTimeout)?Math.min(6500,Math.max(2500,configuredFreeTimeout)):4500;
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
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(FREE_SEARCH_TIMEOUT_MS,5000));
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
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(FREE_SEARCH_TIMEOUT_MS,5000));
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
 const u='https://lite.duckduckgo.com/lite/?q='+encodeURIComponent(q);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FREE_SEARCH_TIMEOUT_MS);
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotFreeSearch/1.0','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw providerError('DuckDuckGo search returned HTTP '+r.status,r.status);
  const html=await r.text();
  const anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const titleAnchors=anchors.filter(([,attrs])=>/(?:^|\s)(?:result__a|result-link|ac-algo)(?:\s|$)/i.test(htmlAttribute(attrs,'class')));
  const snippets=anchors.filter(([,attrs])=>/(?:^|\s)(?:result__snippet|result-snippet|compText)(?:\s|$)/i.test(htmlAttribute(attrs,'class'))).map(([,attrs,body])=>cleanText(body));
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

const SEARCH_RANK_STOP_WORDS=new Set([
 'a','an','and','are','as','at','be','but','by','for','from','how','i','in','into','is','it','me','of','on','or','please','show','the','to','what','when','where','which','who','why','with',
 'latest','today','now','current','recent','news'
]);
const SEARCH_FINANCE_INTENT_RE=/\b(?:earnings?|revenue|profit|loss|guidance|forecast|outlook|eps|stock|stocks|shares?|share price|market|market cap|valuation|target price|price target|crypto|cryptocurrency|bitcoin|ethereum|options?|futures?|forex|fx|ipo|merger|acquisition|deal|sec filing|results|quarterly|dividend|yield|bond|treasury|interest rate|inflation|etf|index|indices|nasdaq|nyse|nifty|sensex|btc|eth|trading|analyst|investor)\b/i;
const SEARCH_FINANCE_SIGNAL_RE=/\b(?:earnings?|revenue|profit|loss|guidance|forecast|outlook|eps|shares?|stock|market cap|valuation|target price|price target|dividend|yield|quarterly results|quarter|analyst|sec filing|nasdaq|nyse|ipo|merger|acquisition|bitcoin|ethereum|cryptocurrency|etf|options?|futures?|treasury|inflation|interest rate|volume|price|trading)\b/i;
const SEARCH_RECENCY_INTENT_RE=/\b(?:latest|today|now|current|recent|news|earnings?|results|release|guidance|forecast|price|quote|market)\b/i;
function scoreSearchResult(row,query,now=Date.now()){
 const title=normalizedTitle(row.title);
 const snippet=normalizedTitle(row.snippet);
 const queryText=normalizedTitle(query);
 const queryTerms=[...new Set(queryText.split(/\s+/).filter(term=>term.length>1&&!SEARCH_RANK_STOP_WORDS.has(term)))];
 const titleWords=new Set(title.split(/\s+/).filter(Boolean));
 const snippetWords=new Set(snippet.split(/\s+/).filter(Boolean));
 const titleMatches=queryTerms.filter(term=>titleWords.has(term));
 const snippetOnlyMatches=queryTerms.filter(term=>snippetWords.has(term)&&!titleWords.has(term));
 const titleCoverage=queryTerms.length?titleMatches.length/queryTerms.length:0;
 const contentCoverage=queryTerms.length?(titleMatches.length+snippetOnlyMatches.length)/queryTerms.length:0;
 const financeQuery=SEARCH_FINANCE_INTENT_RE.test(query);
 const titleFinanceMatch=SEARCH_FINANCE_SIGNAL_RE.test(title);
 const financeTopicMatch=financeQuery&&SEARCH_FINANCE_SIGNAL_RE.test(title+' '+snippet);
 let score=titleMatches.length*4+titleCoverage*8+snippetOnlyMatches.length*1.5;
 if(queryTerms.length>=2&&titleCoverage===1)score+=6;
 if(queryText.length>=5&&title.includes(queryText))score+=1.5;
 if(financeTopicMatch)score+=4;
 if(financeQuery&&titleFinanceMatch)score+=2;
 const url=String(row.url||'');
 if(financeQuery&&/(?:^|[./_-])(?:account|login|signin|sign-in|support|help|privacy|terms|signup|register)(?:[./?_-]|$)/i.test(url))score-=5;
 const rawDate=row.publishedAt?Date.parse(row.publishedAt):NaN;
 const recencyDays=Number.isFinite(rawDate)?Math.max(0,(now-rawDate)/86400000):null;
 if(SEARCH_RECENCY_INTENT_RE.test(query)&&recencyDays!==null){
  if(recencyDays<=1)score+=3;
  else if(recencyDays<=7)score+=2.5;
  else if(recencyDays<=30)score+=1;
  else if(recencyDays<=90)score-=0.5;
  else if(recencyDays<=180)score-=1.5;
  else score-=3;
 }
 return {
  score:Number(score.toFixed(3)),
  signals:{
   queryTermsMatched:titleMatches.length+snippetOnlyMatches.length,
   queryTermsTotal:queryTerms.length,
   queryTermsInTitle:titleMatches.length,
   allQueryTermsInTitle:queryTerms.length>0&&titleCoverage===1,
   financeTopicMatch,
   recencyDays:recencyDays===null?null:Number(recencyDays.toFixed(2))
  }
 };
}

function resolveYahooSearchUrl(value){
 const raw=String(value||'').trim();
 try{
  const url=new URL(raw,'https://search.yahoo.com');
  if(!/(^|\.)yahoo\.com$/i.test(url.hostname))return url.href;
  const direct=url.searchParams.get('RU')||url.searchParams.get('ru')||url.searchParams.get('url');
  if(direct){
   try{
    const target=new URL(decodeURIComponent(direct));
    if(/^https?:$/.test(target.protocol)&&!target.username&&!target.password)return target.href;
   }catch{}
  }
  const wrapped=raw.match(/\/RU=([^/]+)(?:\/RK=|\/RS=|\/RG=|$)/i);
  if(wrapped){
   const target=new URL(decodeURIComponent(wrapped[1].replace(/&amp;/gi,'&')));
   if(/^https?:$/.test(target.protocol)&&!target.username&&!target.password)return target.href;
  }
  return url.href;
 }catch{return raw}
}
async function yahooHtml(q,count){
 const u='https://search.yahoo.com/search?p='+encodeURIComponent(q);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FREE_SEARCH_TIMEOUT_MS);
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotFreeSearch/1.0','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw providerError('Yahoo Search returned HTTP '+r.status,r.status);
  const html=await r.text();
  const anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const titleAnchors=anchors.filter(([,attrs])=>/(?:^|\s)(?:ac-algo|title|algo-link|result-link)(?:\s|$)/i.test(htmlAttribute(attrs,'class')));
  if(!titleAnchors.length&&/captcha|automated queries|unusual traffic/i.test(html))throw providerError('Yahoo Search returned an automated-access challenge');
  const items=[];
  for(const [,attrs,body] of titleAnchors){
   if(items.length>=count)break;
   const url=resolveYahooSearchUrl(htmlAttribute(attrs,'href'));
   const title=cleanText(body);
   if(!/^https?:\/\//i.test(url)||!title)continue;
   let host='Yahoo Search';
   try{host=new URL(url).hostname.replace(/^www\./i,'')}catch{}
   if(/(^|\.)yahoo\.com$/i.test(host))continue;
   items.push({title,url,snippet:'',source:host,publishedAt:null});
  }
  return normalize(items,'yahoo-html');
 }catch(e){
  if(e.name==='AbortError')throw providerError('Yahoo Search timed out');
  throw e;
 }finally{clearTimeout(timer)}
}


function braveResultBlocks(html,limit){
 const tags=/<\/?div\b[^>]*>/gi, starts=[...html.matchAll(/<div\b(?=[^>]*\bdata-type=["']web["'])[^>]*>/gi)], blocks=[];
 for(const start of starts){
  if(blocks.length>=limit)break;
  tags.lastIndex=start.index;
  let depth=0,match,end=-1;
  while((match=tags.exec(html))){
   const raw=match[0];
   if(/^<\/div/i.test(raw))depth--;
   else if(!/\/\s*>$/.test(raw))depth++;
   if(depth===0){end=tags.lastIndex;break;}
  }
  if(end>start.index){
   const block=html.slice(start.index,end);
   if(!blocks.includes(block))blocks.push(block);
  }
 }
 return blocks;
}
function braveTitle(block){
 const h=block.match(/<h[1-5]\b[^>]*>([\s\S]*?)<\/h[1-5]>/i);
 if(h){const title=cleanText(h[1]);if(title.length>2&&title.length<300)return title;}
 const els=[...block.matchAll(/<(?:div|span)\b([^>]*)>([\s\S]*?)<\/(?:div|span)>/gi)];
 for(const [,attrs,body] of els){
  if(!/(?:^|\s)(?:title|result-title|snippet-title|heading)(?:\s|$)/i.test(htmlAttribute(attrs,'class')))continue;
  const title=cleanText(body);
  if(title.length>2&&title.length<300)return title;
 }
 return '';
}
function braveSnippet(block,title){
 const els=[...block.matchAll(/<(?:p|div|span)\b([^>]*)>([\s\S]*?)<\/(?:p|div|span)>/gi)];
 for(const [,attrs,body] of els){
  if(!/(?:description|snippet-content|snippet-description|result-description|snippet-text)/i.test(htmlAttribute(attrs,'class')))continue;
  const value=cleanText(body);
  if(value.length>35&&value!==title)return value.slice(0,700);
 }
 for(const [,attrs,body] of els){
  const cls=htmlAttribute(attrs,'class');
  const value=cleanText(body);
  if(/(?:result-content|site-name|site-info|breadcrumb|favicon|title)/i.test(cls))continue;
  if(value.length>65&&value!==title&&!value.includes(title))return value.slice(0,700);
 }
 return '';
}
function resolveBraveUrl(value){
 const raw=String(value||'').trim();
 try{
  const target=new URL(raw,'https://search.brave.com');
  if(!/^https?:$/.test(target.protocol)||target.username||target.password)return '';
  if(/(^|\.)search\.brave\.com$/i.test(target.hostname))return '';
  if(/(^|\.)brave\.com$/i.test(target.hostname))return '';
  return target.href;
 }catch{return ''}
}
async function braveHtml(q,count){
 const u='https://search.brave.com/search?q='+encodeURIComponent(q)+'&source=web';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FREE_SEARCH_TIMEOUT_MS);
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotFreeSearch/1.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw providerError('Brave Search returned HTTP '+r.status,r.status);
  const html=await r.text();
  if(/verify you are human|captcha|automated traffic|unusual traffic/i.test(html))throw providerError('Brave Search returned an automated-access challenge');
  const blocks=braveResultBlocks(html,count*2);
  const items=[];
  for(const block of blocks){
   if(items.length>=count)break;
   const anchors=[...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
   const valid=anchors.map(([,attrs,body])=>({url:resolveBraveUrl(htmlAttribute(attrs,'href')),body})).filter(x=>x.url);
   if(!valid.length)continue;
   const title=braveTitle(block)||cleanText(valid[0].body).slice(0,240);
   if(!title||title.length<3)continue;
   const url=valid.find(x=>cleanText(x.body).toLowerCase().includes(title.toLowerCase()))?.url||valid[0].url;
   const snippet=braveSnippet(block,title);
   let source='Brave Search';
   try{source=new URL(url).hostname.replace(/^www\./i,'')}catch{}
   items.push({title,url,snippet,source,publishedAt:null});
  }
  // If the current HTML layout changes, fail closed rather than treating navigation links as results.
  if(!items.length&&blocks.length===0)throw providerError('Brave Search markup changed or no web result blocks were found');
  return normalize(items,'brave-html');
 }catch(e){
  if(e.name==='AbortError')throw providerError('Brave Search timed out');
  throw e;
 }finally{clearTimeout(timer)}
}


async function bingWebHtml(q,count){
 const u='https://www.bing.com/search?q='+encodeURIComponent(q)+'&setlang=en';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FREE_SEARCH_TIMEOUT_MS);
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotFreeSearch/1.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw providerError('Bing Web search returned HTTP '+r.status,r.status);
  const html=await r.text();
  if(/verify you are human|captcha|unusual traffic/i.test(html))throw providerError('Bing Web search returned an automated-access challenge');
  const starts=[...html.matchAll(/<li\b(?=[^>]*\bclass=["'][^"']*\bb_algo\b[^"']*["'])[^>]*>/gi)];
  const items=[];
  for(let i=0;i<starts.length&&items.length<count;i++){
   const start=starts[i].index;
   const end=starts[i+1]?.index??html.length;
   const block=html.slice(start,end);
   const anchor=block.match(/<h2\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i);
   if(!anchor)continue;
   const rawUrl=htmlAttribute(anchor[1],'href');
   let url='';
   try{
    const target=new URL(rawUrl,u);
    if(!/^https?:$/.test(target.protocol)||target.username||target.password)continue;
    if(/(^|\.)bing\.com$/i.test(target.hostname))continue;
    url=target.href;
   }catch{continue}
   const title=cleanText(anchor[2]);
   if(!title||title.length<3)continue;
   const paragraphs=[...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(x=>cleanText(x[1])).filter(x=>x.length>25&&x!==title);
   let source='Bing Web';
   try{source=new URL(url).hostname.replace(/^www\./i,'')}catch{}
   items.push({title,url,snippet:paragraphs[0]||'',source,publishedAt:null});
  }
  return normalize(items,'bing-html');
 }catch(e){
  if(e.name==='AbortError')throw providerError('Bing Web search timed out');
  throw e;
 }finally{clearTimeout(timer)}
}


async function bingWebRss(q,count){
 const u='https://www.bing.com/search?q='+encodeURIComponent(q)+'&format=rss&setlang=en';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FREE_SEARCH_TIMEOUT_MS);
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 FinPilotFreeSearch/1.0','Accept':'application/rss+xml,application/xml,text/xml'}});
  if(!r.ok)throw providerError('Bing Web RSS returned HTTP '+r.status,r.status);
  const xml=await r.text();
  if(/verify you are human|captcha|unusual traffic/i.test(xml))throw providerError('Bing Web RSS returned an automated-access challenge');
  const blocks=xml.match(/<item\b[\s\S]*?<\/item>/gi)||[];
  const items=[];
  for(const block of blocks.slice(0,count)){
   const val=tag=>{
    const lower=block.toLowerCase(),open='<'+tag.toLowerCase()+'>',close='</'+tag.toLowerCase()+'>';
    const from=lower.indexOf(open);
    if(from<0)return '';
    const contentStart=from+open.length;
    const to=lower.indexOf(close,contentStart);
    if(to<0)return '';
    return block.slice(contentStart,to).replace(/<!\[CDATA\[/gi,'').replace(/\]\]>/g,'').trim();
   };
   const title=cleanText(val('title'));
   const rawUrl=cleanText(val('link'));
   const snippet=cleanText(val('description'));
   const publishedAt=cleanText(val('pubDate'))||null;
   const source=cleanText(val('source'))||'Bing Web';
   if(!title)continue;
   let url='';
   try{
    const parsed=new URL(rawUrl);
    if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password)continue;
    url=parsed.href;
   }catch{continue}
   items.push({title,url,snippet,source,publishedAt});
  }
  const results=normalize(items,'bing-web-rss');
  if(!results.length&&blocks.length===0)throw providerError('Bing Web RSS returned no parseable RSS items');
  return results;
 }catch(e){
  if(e.name==='AbortError')throw providerError('Bing Web RSS timed out');
  throw e;
 }finally{clearTimeout(timer)}
}

function freeSearchLinks(q){
 const x=encodeURIComponent(q);
 return [
  {provider:'Bing Web',url:'https://www.bing.com/search?q='+x},
  {provider:'DuckDuckGo',url:'https://duckduckgo.com/?q='+x},
  {provider:'Brave Search',url:'https://search.brave.com/search?q='+x},
  {provider:'Yahoo Search',url:'https://search.yahoo.com/search?p='+x},
  {provider:'Bing News',url:'https://www.bing.com/news/search?q='+x},
  {provider:'Google News',url:'https://news.google.com/search?q='+x}
 ];
}
async function searchFreeMultiSource(q,count){
 const tasks=[
  {provider:'bing-web-rss',run:()=>bingWebRss(q,count)},
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
 for(const item of results){
  const ranking=scoreSearchResult(item,q);
  item.relevanceScore=ranking.score;
  item.relevanceSignals=ranking.signals;
  item.relevanceBasis='QUERY_TERMS_FINANCE_TOPIC_RECENCY';
 }
 results.sort((a,b)=>
  (Number(b.relevanceScore)||0)-(Number(a.relevanceScore)||0)||
  (Number(b.engineAgreementCount)||1)-(Number(a.engineAgreementCount)||1)||
  ((Number.isFinite(Date.parse(b.publishedAt||''))?Date.parse(b.publishedAt):0)-(Number.isFinite(Date.parse(a.publishedAt||''))?Date.parse(a.publishedAt):0))
 );
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
  message:'Free multi-source search returned '+visible.length+' result(s), ranked by query-term relevance, finance-topic fit, available publication recency, then URL/title agreement. Relevance scores are heuristic ranking aids, not confidence probabilities. Matching engines indicate URL/title agreement only, not independent verification of the underlying claim.',
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
