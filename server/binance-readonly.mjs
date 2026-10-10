import {createHmac,timingSafeEqual} from 'node:crypto';
const BASE_URL='https://api.binance.com';
const MIN_TOKEN_LENGTH=32;
export function binanceReadOnlyStatus(env=process.env){
 const key=String(env.BINANCE_API_KEY||''),secret=String(env.BINANCE_API_SECRET||''),token=String(env.FINPILOT_BINANCE_CONNECTOR_TOKEN||'');
 return {configured:Boolean(key&&secret),connectorProtected:token.length>=MIN_TOKEN_LENGTH,mode:'READ_ONLY',permissionsRequested:['account balances','account metadata'],trading:false,transfers:false,withdrawals:false};
}
function safeEqual(a,b){const x=Buffer.from(String(a||''),'utf8'),y=Buffer.from(String(b||''),'utf8');return x.length===y.length&&timingSafeEqual(x,y);}
export function isBinanceConnectorAuthorized(provided,expected){
 if(typeof expected!=='string'||expected.length<MIN_TOKEN_LENGTH)return false;
 return safeEqual(String(provided||'').replace(/^Bearer\s+/i,''),expected);
}
export async function checkBinanceReadOnlyAccount({env=process.env,fetchImpl=fetch,now=()=>Date.now()}={}){
 const key=String(env.BINANCE_API_KEY||''),secret=String(env.BINANCE_API_SECRET||'');
 if(!key||!secret)return {ok:false,status:'NOT_CONFIGURED',error:'BINANCE_CREDENTIALS_NOT_CONFIGURED'};
 const params=new URLSearchParams({omitZeroBalances:'true',recvWindow:'5000',timestamp:String(now())});
 params.set('signature',createHmac('sha256',secret).update(params.toString()).digest('hex'));
 let response;
 try{response=await fetchImpl(BASE_URL+'/api/v3/account?'+params.toString(),{method:'GET',headers:{'X-MBX-APIKEY':key,'Accept':'application/json'},signal:AbortSignal.timeout(8000)});}
 catch{return {ok:false,status:'UNAVAILABLE',error:'BINANCE_NETWORK_OR_TIMEOUT'};}
 if(response.status===401||response.status===403)return {ok:false,status:'AUTH_FAILED',error:'BINANCE_AUTH_OR_PERMISSION_REJECTED'};
 if(response.status===429||response.status===418)return {ok:false,status:'RATE_LIMITED',error:'BINANCE_RATE_LIMITED'};
 if(!response.ok)return {ok:false,status:'UPSTREAM_ERROR',error:'BINANCE_HTTP_'+response.status};
 let data;try{data=await response.json()}catch{return {ok:false,status:'INVALID_RESPONSE',error:'BINANCE_INVALID_JSON'};}
 if(!data||!Array.isArray(data.balances))return {ok:false,status:'INVALID_RESPONSE',error:'BINANCE_ACCOUNT_SCHEMA_UNEXPECTED'};
 const balances=data.balances.filter(x=>x&&typeof x.asset==='string').map(x=>({asset:x.asset,free:/^\d+(?:\.\d+)?$/.test(String(x.free))?String(x.free):'0',locked:/^\d+(?:\.\d+)?$/.test(String(x.locked))?String(x.locked):'0'}));
 return {ok:true,status:'CONNECTED',provider:'Binance Spot Account API',accountType:typeof data.accountType==='string'?data.accountType:null,canTrade:Boolean(data.canTrade),canWithdraw:Boolean(data.canWithdraw),canDeposit:Boolean(data.canDeposit),permissionsWarning:Boolean(data.canTrade||data.canWithdraw),balanceCount:balances.length,balances,checkedAt:new Date(now()).toISOString(),executionEnabled:false,note:'Read-only verification only; FinPilot does not place orders or move funds.'};
}
