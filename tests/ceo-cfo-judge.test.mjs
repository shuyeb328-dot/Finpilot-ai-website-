import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function extractFunction(name){
  const marker='function '+name+'(',start=html.indexOf(marker);
  assert.notEqual(start,-1,'Production function '+name+' was not found');
  const bodyStart=html.indexOf('{',start);
  let depth=0,quote=null,escaped=false;
  for(let i=bodyStart;i<html.length;i++){
    const ch=html[i];
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote=null;continue}
    if(ch==="'"||ch=='"'||ch.charCodeAt(0)===96){quote=ch;continue}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error('Could not extract function '+name);
}

const productionCode=extractFunction('liveWebSignal')+'\n'+extractFunction('runRoundTable');
const run=Function('ctx','const {state,Math,Date,String,Number,RegExp,JSON,money,sourceAge,refreshBrain,save,toast,show}=ctx;'+productionCode+'\nreturn runRoundTable();');

function runDecision({emergency,spending=52000,income=90000,findings=[],evidence=[],lastSearchEvidence=null}){
  const ctx={state:{emergency,spending,income,findings,evidence,lastSearchEvidence,lastEvidenceSync:new Date().toISOString(),decisionHistory:[],memory:[],learning:{confidenceAdjustment:0},decision:null},Math,Date,String,Number,RegExp,JSON,money:value=>'₹'+Number(value).toLocaleString('en-IN'),sourceAge:()=> 'Fresh',refreshBrain:()=>{},save:()=>{},toast:()=>{},show:()=>{}};
  run(ctx);
  return ctx.state.decision;
}

function liveEvidence(claims){return claims.map((claim,i)=>({id:'web-'+i,source:'SerpApi',claim,confidence:72,type:'Live web evidence',url:'https://example.com/'+i,freshness:'Fresh',time:new Date().toISOString()}));}

const cases=[
 {name:'Liquidity gate',args:{emergency:100000,spending:52000,income:90000},expect:d=>{assert.equal(d.executive.cfo.startsWith('Liquidity is the binding constraint'),true);assert.equal(d.decision,'CFO wins: strengthen liquidity before increasing risk')}},
 {name:'High-severity risk gate',args:{emergency:300000,spending:50000,income:90000,findings:[{domain:'Debt',severity:'HIGH',title:'High-APR debt needs priority',detail:'High-interest debt should be addressed first.'}]},expect:d=>{assert.equal(d.executive.cfo.startsWith('Resolve the high-severity financial findings'),true);assert.equal(d.decision,'Risk gate wins: resolve the highest-severity finding before adding new risk')}},
 {name:'Positive web CEO',args:{emergency:300000,spending:50000,income:90000,evidence:liveEvidence(['IRFC gains after a major loan agreement','IRFC signs a large renewable energy contract','Railway stocks show strong growth and profit outlook']),lastSearchEvidence:{query:'IRFC',provider:'serpapi',count:3,time:new Date().toISOString()}},expect:d=>{assert.equal(d.webSignal.stance,'Positive');assert.equal(d.executive.ceo.startsWith('Opportunity exists'),true);assert.equal(d.decision,'CEO wins: protect surplus while allocating selectively toward goals')}},
 {name:'Cautious web risk',args:{emergency:300000,spending:50000,income:90000,evidence:liveEvidence(['IRFC falls after a warning','IRFC faces downgrade risk and debt concerns','Analysts report weak outlook and losses']),lastSearchEvidence:{query:'IRFC',provider:'serpapi',count:3,time:new Date().toISOString()}},expect:d=>{assert.equal(d.webSignal.stance,'Cautious');assert.equal(d.decision,'CFO/Risk wins: verify live negative signals before taking market risk')}}
];

for(const c of cases){const d=runDecision(c.args);c.expect(d);console.log('PASS:',c.name)}
console.log('CEO/CFO/Judge automated tests: 4/4 passed');
