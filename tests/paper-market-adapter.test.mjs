import assert from 'node:assert/strict';
import fs from 'node:fs';

const lab=fs.readFileSync(new URL('../public/paper-lab.js',import.meta.url),'utf8');
const pro=fs.readFileSync(new URL('../public/paper-pro.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server/server.mjs',import.meta.url),'utf8');

function extractFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,name+' must exist');
  const open=source.indexOf('{',start);
  let depth=0,quote='',escaped=false;
  for(let i=open;i<source.length;i++){
    const c=source[i];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(c==='\\'){escaped=true;continue;}
      if(c===quote)quote='';
      continue;
    }
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('Could not parse '+name+' body');
}

const arena=extractFunction(lab,'paperMarketMeta');
for(const field of [
  "m?.verified===true",
  "m?.live===true",
  "m?.executionEligible===true",
  "m?.sourceTimestampType==='PROVIDER_TIMESTAMP'",
  "v.status==='VERIFIED'",
  "v.available===true",
  "v.priceAgreement===true",
  "v.primaryProviderTimestampValid===true",
  "sourceAsOf:sourceAsOf||undefined",
  "providerCount:Number(v.providerCount||m?.providerCount||0)"
])assert.ok(arena.includes(field),'Paper Arena must enforce and preserve '+field);

const tower=extractFunction(pro,'paperProMarketMeta');
for(const field of [
  "m?.verified===true",
  "m?.executionEligible===true",
  "m?.sourceTimestampType==='PROVIDER_TIMESTAMP'",
  "v.status==='VERIFIED'",
  "v.available===true",
  "v.priceAgreement===true",
  "v.primaryProviderTimestampValid===true",
  "sourceAsOf:sourceAsOf||undefined"
])assert.ok(tower.includes(field),'Execution Control Tower must enforce and preserve '+field);

assert.ok(lab.includes("os?.sourceTimestampType==='PROVIDER_TIMESTAMP'"),'Initial quote load must require a provider timestamp');
assert.ok(lab.includes("market.sourceTimestampType=d.sourceTimestampType||'UNKNOWN_TIMESTAMP'"),'Stream refresh must preserve provider timestamp type');
assert.ok(server.includes("sourceTimestampType:d?.sourceTimestampType||'UNKNOWN_TIMESTAMP'"),'Server market stream must include provider timestamp type');
console.log('paper market adapter: explicit source verification, provider timestamp and freshness requirements passed');
