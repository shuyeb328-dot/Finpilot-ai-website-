const COOLDOWNS=new Map();

function classifyCooldown(error){
 const message=String(error?.message||error||'').toUpperCase();
 if(/HTTP[_ ]?418|HTTP[_ ]?429|\b418\b|\b429\b|RATE.?LIMIT|TOO MANY REQUESTS|IP.?BAN|TEMPORARILY BLOCKED/.test(message)){
  const kind=/HTTP[_ ]?418|\b418\b|IP.?BAN/.test(message)?'HTTP_418':'RATE_LIMIT';
  return {kind,baseMs:kind==='HTTP_418'?60_000:30_000,maxMs:kind==='HTTP_418'?10*60_000:5*60_000};
 }
 return null;
}

export function recordProviderFailure(source,error,now=Date.now()){
 const key=String(source||'provider').trim().toLowerCase();
 const policy=classifyCooldown(error);
 if(!policy)return providerCooldownStatus(key,now);
 const previous=COOLDOWNS.get(key);
 const consecutiveFailures=previous?previous.consecutiveFailures+1:1;
 const durationMs=Math.min(policy.maxMs,policy.baseMs*Math.pow(2,Math.min(8,consecutiveFailures-1)));
 const state={source:key,kind:policy.kind,reason:String(error?.message||error||policy.kind).slice(0,180),consecutiveFailures,startedAt:new Date(now).toISOString(),untilMs:now+durationMs};
 COOLDOWNS.set(key,state);
 return {...state,active:true,retryAfterMs:durationMs};
}

export function providerCooldownStatus(source,now=Date.now()){
 const key=String(source||'provider').trim().toLowerCase();
 const state=COOLDOWNS.get(key);
 if(!state)return null;
 const retryAfterMs=Math.max(0,state.untilMs-now);
 if(retryAfterMs<=0)return null;
 return {...state,active:true,retryAfterMs};
}

export function activeProviderCooldowns(now=Date.now()){
 return [...COOLDOWNS.keys()].map(key=>providerCooldownStatus(key,now)).filter(Boolean).sort((a,b)=>a.source.localeCompare(b.source)).map(({source,kind,reason,consecutiveFailures,startedAt,untilMs,retryAfterMs})=>({source,kind,reason,consecutiveFailures,startedAt,until:new Date(untilMs).toISOString(),retryAfterMs}));
}

export function recordProviderSuccess(source){
 COOLDOWNS.delete(String(source||'provider').trim().toLowerCase());
}

export function resetProviderCooldownsForTests(){
 COOLDOWNS.clear();
}
