// Shared short-lived cache for identical provider JSON URLs. Successful data only;
// metadata records the first observation time so a cache hit cannot look newly fetched.
export function createProviderResponseCache({ttlMs=5000,maxEntries=300,now=()=>Date.now()}={}) {
  const ttl=Math.max(0,Number(ttlMs)||0);
  const capacity=Math.max(10,Math.min(2000,Math.trunc(Number(maxEntries)||300)));
  const values=new Map();
  const inflight=new Map();
  const counters={hits:0,misses:0,coalesced:0,loads:0,errors:0};

  function purge() {
    const time=now();
    for(const [key,entry] of values) if(entry.expiresAt<=time) values.delete(key);
    while(values.size>capacity) values.delete(values.keys().next().value);
  }

  function copyWithMeta(value,fetchedAtMs,{cacheHit=false,shared=false}={}) {
    let result=value;
    if(value&&typeof value==='object') {
      result=structuredClone(value);
      Object.defineProperty(result,'_finpilotCache',{
        enumerable:false,
        configurable:false,
        value:{
          observedAt:new Date(fetchedAtMs).toISOString(),
          fetchedAtMs,
          ageMs:Math.max(0,now()-fetchedAtMs),
          cacheHit,
          shared
        }
      });
    }
    return result;
  }

  async function get(key,loader) {
    const normalized=String(key??'');
    if(!normalized) throw new TypeError('provider cache key is required');
    if(typeof loader!=='function') throw new TypeError('provider cache loader must be a function');
    purge();

    const hit=values.get(normalized);
    if(hit&&hit.expiresAt>now()) {
      values.delete(normalized);
      values.set(normalized,hit);
      counters.hits++;
      return copyWithMeta(hit.value,hit.fetchedAtMs,{cacheHit:true});
    }

    const pending=inflight.get(normalized);
    if(pending) {
      counters.coalesced++;
      const resolved=await pending;
      return copyWithMeta(resolved.value,resolved.fetchedAtMs,{shared:true});
    }

    counters.misses++;
    const request=(async()=>{
      counters.loads++;
      try {
        const value=await loader();
        const fetchedAtMs=now();
        if(ttl>0 && value!==undefined && value!==null) {
          values.set(normalized,{value:structuredClone(value),fetchedAtMs,expiresAt:fetchedAtMs+ttl});
          purge();
        }
        return {value,fetchedAtMs};
      } catch(error) {
        counters.errors++;
        throw error;
      }
    })();
    inflight.set(normalized,request);
    try {
      const resolved=await request;
      return copyWithMeta(resolved.value,resolved.fetchedAtMs);
    } finally {
      if(inflight.get(normalized)===request) inflight.delete(normalized);
    }
  }

  function stats() {
    purge();
    return {...counters,entries:values.size,inflight:inflight.size,ttlMs:ttl,maxEntries:capacity};
  }

  return {get,stats};
}
