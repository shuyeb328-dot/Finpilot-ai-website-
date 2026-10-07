import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/decision-core.js',import.meta.url),'utf8');
const context={window:{},Date,Math,String,Number,JSON};
vm.runInNewContext(source,context);
const compute=context.window.FinPilotDecisionCore.computeExecutiveDecision;
assert.equal(typeof compute,'function');

const money=value=>'₹'+Number(value).toLocaleString('en-IN');
const fresh=()=> 'Fresh';
const live=claims=>claims.map((claim,i)=>({id:'w'+i,source:'SerpApi',claim,type:'Live web evidence',url:'https://example.com/'+i}));

const run=(args)=>{
 const state={emergency:args.emergency,spending:args.spending,income:args.income,lastEvidenceSync:new Date().toISOString(),learning:{confidenceAdjustment:0}};
 return compute(state,args.findings||[],args.web||null,money,fresh);
};

const cases=[
 ['Liquidity gate',run({emergency:100000,spending:52000,income:90000}),d=>{assert.equal(d.executive.cfo.startsWith('Liquidity is the binding constraint'),true);assert.equal(d.decision,'CFO wins: strengthen liquidity before increasing risk')}],
 ['High-severity risk gate',run({emergency:300000,spending:50000,income:90000,findings:[{severity:'HIGH',domain:'Debt'}]}),d=>{assert.equal(d.executive.cfo.includes('high-severity'),true);assert.equal(d.decision,'Risk gate wins: resolve the highest-severity finding before adding new risk')}],
 ['Positive web CEO',run({emergency:300000,spending:50000,income:90000,web:{query:'IRFC',provider:'serpapi',count:3,stance:'Positive',confidence:80}}),d=>{assert.equal(d.webSignal.stance,'Positive');assert.ok(['Conditional opportunity: proceed only after fundamental and suitability checks','Judge: preserve flexibility and wait for stronger evidence'].includes(d.decision));assert.ok(d.executive.ceoConfidence>=0&&d.executive.ceoConfidence<=100);assert.ok(d.quantumSignal)}],
 ['Cautious web risk',run({emergency:300000,spending:50000,income:90000,web:{query:'IRFC',provider:'serpapi',count:3,stance:'Cautious',confidence:80}}),d=>{assert.equal(d.webSignal.stance,'Cautious');assert.equal(d.decision,'CFO/Risk wins: verify live negative signals before taking market risk');assert.ok(d.executive.cfoConfidence>=0&&d.executive.cfoConfidence<=100);assert.ok(d.quantumSignal)}]
];

for(const [name,result,check] of cases){check(result);console.log('PASS:',name)}
console.log('CEO/CFO/Judge automated tests: 4/4 passed with dynamic Quantum-aware scoring');
