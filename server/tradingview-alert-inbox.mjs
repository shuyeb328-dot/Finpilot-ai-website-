import {createHash,timingSafeEqual} from 'node:crypto';

const DEFAULT_MAX_ENTRIES=200;
const DEFAULT_TTL_MS=24*60*60*1000;

function boundedText(value,max=120){
 return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
}
function constantTimeMatch(provided,expected){
 const a=Buffer.from(String(provided??''),'utf8');
 const b=Buffer.from(String(expected??''),'utf8');
 if(!a.length||!b.length||a.length!==b.length)return false;
 return timingSafeEqual(a,b);
}
function validToken(provider,expected){
 const actual=String(provider??'');
 const wanted=String(expected??'');
 return constantTimeMatch(actual,wanted);
}
function safeNumber(value){
 if(value===undefined||value===null||String(value).trim()==='')return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>0?n:null;
}
function prune(entries,now,ttlMs){
 for(let i=entries.length-1;i>=0;i--){
  const t=Date.parse(entries[i].receivedAt);
  if(!Number.isFinite(t)||now-t>ttlMs)entries.splice(i,1);
 }
}
function signalKey({symbol,action,strategy,timeframe,alertTime,statedPrice,externalId}){
 const material=externalId
  ?['external',externalId,symbol,action].join('|')
  :[symbol,action,strategy,timeframe,alertTime||'',statedPrice??''].join('|');
 return createHash('sha256').update(material).digest('hex').slice(0,24);
}

/**
 * Authenticated TradingView alert inbox. Signals are intentionally not market quotes
 * and can never authorize or submit paper/live orders.
 */
export function createTradingViewAlertInbox(options={}){
 const getToken=typeof options.getToken==='function'?options.getToken:()=>options.token??'';
 const now=typeof options.now==='function'?options.now:()=>Date.now();
 const maxEntries=Math.max(10,Math.min(1000,Math.trunc(Number(options.maxEntries)||DEFAULT_MAX_ENTRIES)));
 const ttlMs=Math.max(60_000,Math.min(7*24*60*60*1000,Math.trunc(Number(options.ttlMs)||DEFAULT_TTL_MS)));
 const entries=[];
 let accepted=0, rejected=0, duplicates=0;
 function currentToken(){return String(getToken()??'').trim();}
 function configured(){return currentToken().length>=24;}
 function authorize(provided){
  const secret=currentToken();
  if(secret.length<24)return {ok:false,statusCode:503,error:'TRADINGVIEW_WEBHOOK_NOT_CONFIGURED',message:'Set FINPILOT_TRADINGVIEW_WEBHOOK_TOKEN to a random secret of at least 24 characters.'};
  if(!validToken(provided,secret))return {ok:false,statusCode:401,error:'TRADINGVIEW_WEBHOOK_UNAUTHORIZED'};
  return {ok:true};
 }
 function ingest(payload={}){
  const auth=authorize(payload?.token);
  if(!auth.ok){rejected++;return auth;}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)){rejected++;return {ok:false,statusCode:400,error:'ALERT_JSON_OBJECT_REQUIRED'};}
  const symbol=boundedText(payload.ticker??payload.symbol??payload.tickerid,32).toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9._:!+-]{0,31}$/.test(symbol)){rejected++;return {ok:false,statusCode:400,error:'INVALID_ALERT_SYMBOL'};}
  const rawAction=boundedText(payload.action??payload.side??payload.signal,24).toUpperCase();
  const action=rawAction==='BUY'||rawAction==='LONG'?'BUY':rawAction==='SELL'||rawAction==='SHORT'?'SELL':rawAction==='HOLD'?'HOLD':'';
  if(!action){rejected++;return {ok:false,statusCode:400,error:'INVALID_ALERT_ACTION',allowed:['BUY','SELL','HOLD','LONG','SHORT']};}
  const strategy=boundedText(payload.strategy??payload.strategyName??'TradingView alert',100)||'TradingView alert';
  const timeframe=boundedText(payload.interval??payload.timeframe??'',24);
  const rawTime=payload.timestamp??payload.time??payload.alertTime;
  let alertTime=null;
  if(rawTime!==undefined&&rawTime!==null&&String(rawTime).trim()!==''){
   const ms=Date.parse(String(rawTime));
   const at=Number(now());
   if(!Number.isFinite(ms)||ms>at+5*60_000||at-ms>ttlMs){rejected++;return {ok:false,statusCode:400,error:'INVALID_OR_EXPIRED_ALERT_TIMESTAMP'};}
   alertTime=new Date(ms).toISOString();
  }
  const statedPrice=safeNumber(payload.price??payload.close);
  const receivedMs=Number(now());
  prune(entries,receivedMs,ttlMs);
  const externalId=boundedText(payload.alertId??payload.eventId??payload.id??'',100);
  const id='tv_'+signalKey({symbol,action,strategy,timeframe,alertTime,statedPrice,externalId});
  const prior=entries.find(x=>x.id===id);
  if(prior){duplicates++;return {ok:true,duplicate:true,alertId:id,status:prior.status,executionEligible:false,orderSubmitted:false};}
  const item={
   id,symbol,action,strategy,timeframe,
   alertTime,statedPrice,
   receivedAt:new Date(receivedMs).toISOString(),
   source:'TRADINGVIEW_WEBHOOK',
   trust:'UNVERIFIED_SIGNAL',
   status:'RECEIVED_UNVERIFIED',
   executionEligible:false,
   orderSubmitted:false,
   note:'Alert is a strategy signal, not a verified quote. Refresh and verify FinPilot market data, review risk, and submit a paper order manually.'
  };
  entries.unshift(item);
  if(entries.length>maxEntries)entries.length=maxEntries;
  accepted++;
  return {ok:true,duplicate:false,alertId:id,status:item.status,executionEligible:false,orderSubmitted:false,queueSize:entries.length};
 }
 function list(provided){
  const auth=authorize(provided);
  if(!auth.ok){rejected++;return auth;}
  prune(entries,Number(now()),ttlMs);
  return {ok:true,items:entries.map(x=>({...x})),count:entries.length,maxEntries,persistence:'PROCESS_MEMORY',persistent:false,execution:'SIGNAL_ONLY'};
 }
 function status(){
  prune(entries,Number(now()),ttlMs);
  return {ok:true,configured:configured(),queueSize:entries.length,maxEntries,ttlMs,persistence:'PROCESS_MEMORY',persistent:false,accepted, rejected,duplicates,execution:'SIGNAL_ONLY'};
 }
 return {ingest,list,status};
}
