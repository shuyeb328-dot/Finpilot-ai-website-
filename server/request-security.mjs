export const MAX_REQUEST_BODY_BYTES=512*1024;

/**
 * Same-origin writes are allowed. Cross-origin requests require an exact explicit
 * ALLOWED_ORIGIN match. Requests without Origin remain available to server-side clients.
 */
export function isAllowedRequestOrigin({origin,host,allowedOrigin='',requestProtocol=''}={}){
 if(origin===undefined||origin===null||String(origin).trim()==='')return true;
 const value=String(origin).trim();
 let parsed;
 try{parsed=new URL(value)}catch{return false}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==value||parsed.username||parsed.password)return false;
 if(String(allowedOrigin||'').trim()===value)return true;
 const requestHost=String(host||'').trim().toLowerCase();
 const protocol=String(requestProtocol||'').trim().replace(/:$/,'').toLowerCase();
 return Boolean(requestHost&&parsed.host.toLowerCase()===requestHost&&(!protocol||parsed.protocol===protocol+':'));
}
