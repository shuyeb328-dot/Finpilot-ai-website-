const TICKER_RE=/^[A-Z0-9][A-Z0-9._:-]{0,23}$/;
const SYMBOL_RE=/^[A-Z0-9][A-Z0-9._:/-]{0,47}$/;
const MAX_PRICE=1e15;
const MAX_AGE_MS=7*24*60*60*1000;
const MAX_FUTURE_MS=5*60*1000;

function optionalNumber(value,name,min,max){
 if(value===undefined||value===null||value==='')return {ok:true,value:null};
 const n=Number(value);
 if(!Number.isFinite(n)||n<min||n>max)return {ok:false,error:'INVALID_'+name.toUpperCase()};
 return {ok:true,value:n};
}
function cleanText(value,maxLength){
 return String(value??'').replace(/[\\u0000-\\u001f\\u007f]/g,' ').replace(/\\s+/g,' ').trim().slice(0,maxLength);
}

/**
 * Validates client-reported market history input. Client-supplied provider labels
 * are always marked unverified: this endpoint has no provider signature/authentication.
 */
export function normalizeMarketTick(input,nowMs=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,error:'INVALID_PAYLOAD'};
 const ticker=cleanText(input.ticker,24).toUpperCase();
 if(!TICKER_RE.test(ticker))return {ok:false,error:'INVALID_TICKER'};
 const symbol=cleanText(input.symbol||ticker,48).toUpperCase();
 if(!SYMBOL_RE.test(symbol))return {ok:false,error:'INVALID_SYMBOL'};
 const price=optionalNumber(input.price,'price',Number.MIN_VALUE,MAX_PRICE);
 if(!price.ok)return price;
 const change=optionalNumber(input.changePct??input.change_pct,'change_pct',-100,10000);
 if(!change.ok)return change;
 const volume=optionalNumber(input.volume,'volume',0,1e18);
 if(!volume.ok)return volume;
 const high=optionalNumber(input.high,'high',Number.MIN_VALUE,MAX_PRICE);
 if(!high.ok)return high;
 const low=optionalNumber(input.low,'low',Number.MIN_VALUE,MAX_PRICE);
 if(!low.ok)return low;
 if(high.value!==null&&low.value!==null&&high.value<low.value)return {ok:false,error:'INVALID_PRICE_RANGE'};
 if(high.value!==null&&high.value<price.value)return {ok:false,error:'HIGH_BELOW_LAST_PRICE'};
 if(low.value!==null&&low.value>price.value)return {ok:false,error:'LOW_ABOVE_LAST_PRICE'};
 let observedMs=nowMs;
 const rawTime=input.time??input.observedAt??input.observed_at;
 if(rawTime!==undefined&&rawTime!==null&&rawTime!==''){
  observedMs=typeof rawTime==='number'?(rawTime<1e12?rawTime*1000:rawTime):Date.parse(String(rawTime));
 }
 if(!Number.isFinite(observedMs))return {ok:false,error:'INVALID_OBSERVED_AT'};
 if(observedMs<nowMs-MAX_AGE_MS)return {ok:false,error:'STALE_MARKET_TICK'};
 if(observedMs>nowMs+MAX_FUTURE_MS)return {ok:false,error:'FUTURE_MARKET_TICK'};
 const claimedSource=cleanText(input.source,64);
 const source=claimedSource
  ? 'Client-reported (unverified; claimed provider: '+claimedSource+')'
  : 'Client-reported (unverified; provider not supplied)';
 return {ok:true,value:{
  ticker,symbol,price:price.value,changePct:change.value,volume:volume.value,
  high:high.value,low:low.value,time:new Date(observedMs).toISOString(),
  source,sourceVerified:false
 }};
}
