/* Scheduled trigger for the AI OS shadow-training cycle.
 * The web service owns provider adapters and PostgreSQL persistence. This job
 * triggers one bounded cycle and fails closed on HTTP/storage/provider errors.
 * It never submits orders or promotes agents.
 */
const base=String(process.env.FINPILOT_MARKET_API_BASE||'').replace(/\/+$/,'');
const token=String(process.env.FINPILOT_AI_OS_WORKER_TOKEN||'');
if(!base||!/^https:\/\//i.test(base)||!token){
  console.error('AI OS worker is not configured: HTTPS base URL and worker token are required.');
  process.exit(2);
}
const controller=new AbortController();
const timeout=setTimeout(()=>controller.abort(),120_000);
try{
  const response=await fetch(base+'/api/ai-os/market-training/cycle',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','x-finpilot-worker-token':token},
    body:JSON.stringify({source:'github-actions-scheduled-worker'}),
    signal:controller.signal
  });
  const text=await response.text();
  let result;
  try{result=JSON.parse(text)}catch{throw new Error('Training endpoint returned invalid JSON (HTTP '+response.status+').')}
  if(!response.ok||result.ok!==true){
    console.error(JSON.stringify({ok:false,status:response.status,error:result.error||'CYCLE_FAILED',summary:result.summary||null}));
    process.exitCode=1;
  }else{
    const s=result.summary||{};
    console.log(JSON.stringify({ok:true,cycle:result.cycle,trigger:result.trigger,watchlist:result.watchlist,summary:{accepted:s.accepted,duplicates:s.duplicates,rejected:s.rejected,forecastsCreated:s.forecastsCreated,forecastsSettled:s.forecastsSettled,failedSymbols:s.failedSymbols,persistence:s.persistence,persistent:s.persistent,automaticExecution:false}}));
    if(s.persistent!==true||s.persistence!=='POSTGRES'||Number(s.failedSymbols)>0)process.exitCode=1;
  }
}catch(error){
  console.error('AI OS shadow cycle failed:',String(error?.name==='AbortError'?'request timed out':error?.message||error));
  process.exitCode=1;
}finally{clearTimeout(timeout)}
