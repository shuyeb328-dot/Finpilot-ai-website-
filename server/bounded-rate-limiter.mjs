export function createBoundedRateLimiter(options={}){
 const windowMs=positiveInteger(options.windowMs,60000,1000,3600000);
 const limit=positiveInteger(options.limit,240,1,100000);
 const maxClients=positiveInteger(options.maxClients,10000,100,100000);
 const sweepEvery=positiveInteger(options.sweepEvery,256,1,10000);
 const clock=typeof options.now==='function'?options.now:()=>Date.now();
 const entries=new Map();
 let calls=0;
 function sweep(now){
  for(const [key,value] of entries){
   if(now-value.started>=windowMs||now<value.started)entries.delete(key);
  }
  while(entries.size>maxClients){
   const oldest=entries.keys().next();
   if(oldest.done)break;
   entries.delete(oldest.value);
  }
 }
 function check(identifier){
  const now=Number(clock());
  const key=String(identifier??'unknown').slice(0,128)||'unknown';
  calls++;
  if(calls%sweepEvery===0||entries.size>=maxClients)sweep(now);
  let entry=entries.get(key);
  if(!entry||now-entry.started>=windowMs||now<entry.started)entry={started:now,count:0};
  entry.count++;
  entries.set(key,entry);
  while(entries.size>maxClients){
   const oldest=entries.keys().next();
   if(oldest.done)break;
   entries.delete(oldest.value);
  }
  return {allowed:entry.count<=limit,count:entry.count,remaining:Math.max(0,limit-entry.count),resetAt:entry.started+windowMs};
 }
 return {check,size:()=>entries.size,capacity:maxClients};
}
function positiveInteger(value,fallback,min,max){
 const n=Number(value);
 return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;
}
