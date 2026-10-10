import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/decision-core.js',import.meta.url),'utf8');
const context={window:{},Date,Math,String,Number,JSON};
context.window.FinPilotFoundation={quantumSearchSignal:(query)=>({intent:/market|invest|trading|options|futures/i.test(String(query||''))?'market':'research',confidence:70,evidenceCount:0,stance:'Mixed',freshness:'LIVE',route:[]})};
vm.runInNewContext(source,context);
const compute=context.window.FinPilotDecisionCore.computeExecutiveDecision;
assert.equal(typeof compute,'function');

const money=value=>'₹'+Number(value).toLocaleString('en-IN');
const fresh=()=> 'Fresh';
const live=claims=>claims.map((claim,i)=>({id:'w'+i,source:'SerpApi',claim,type:'Live web evidence',url:'https://source'+i+'.example/'+i}));

const run=(args)=>{
 const state={emergency:args.emergency,spending:args.spending,income:args.income,lastEvidenceSync:new Date().toISOString(),learning:{confidenceAdjustment:0},marketSnapshot:args.marketSnapshot,evidence:args.evidence||[]};
 return compute(state,args.findings||[],args.web||null,money,fresh);
};

const goodQuote=()=>({
 ticker:'IRFC',symbol:'IRFC',price:103,asOf:new Date().toISOString(),
 sourceTimestampType:'PROVIDER_TIMESTAMP',provider:'NSE public',executionEligible:true
});
const corroboratedWeb={query:'IRFC',provider:'public research',count:3,stance:'Positive',confidence:80,
 urls:['https://www.nseindia.com/example','https://www.screener.in/company/IRFC/','https://www.bseindia.com/example']};
const cases=[
 ['Liquidity gate',run({emergency:100000,spending:52000,income:90000}),d=>{assert.equal(d.executive.cfo.startsWith('Liquidity is the binding constraint'),true);assert.equal(d.decision,'CFO wins: strengthen liquidity before increasing risk');assert.ok(d.decisionGates.some(g=>g.id==='liquidity'&&g.blocking))}],
 ['High-severity risk gate',run({emergency:300000,spending:50000,income:90000,findings:[{severity:'HIGH',domain:'Debt'}]}),d=>{assert.equal(d.executive.cfo.includes('high-severity'),true);assert.equal(d.decision,'Risk gate wins: resolve the highest-severity finding before adding new risk');assert.ok(d.decisionGates.some(g=>g.id==='high_severity_findings'&&g.blocking))}],
 ['Positive headlines without quote are blocked',run({emergency:300000,spending:50000,income:90000,web:{...corroboratedWeb,urls:[]}}),d=>{assert.equal(d.webSignal.stance,'Positive');assert.equal(d.marketEvidence.quoteStatus,'NO_VERIFIED_QUOTE');assert.match(d.decision,/WAIT/);assert.ok(d.confidence<=40);assert.ok(d.decisionGates.some(g=>g.id==='market_quote'&&g.blocking))}],
 ['Cautious web risk still respects hard data gate',run({emergency:300000,spending:50000,income:90000,web:{...corroboratedWeb,stance:'Cautious'}}),d=>{assert.equal(d.webSignal.stance,'Cautious');assert.match(d.decision,/WAIT/);assert.ok(d.marketEvidence.blockingReason);assert.ok(d.executive.cfoConfidence>=0&&d.executive.cfoConfidence<=100)}],
 ['Fresh matching quote plus independent sources clears market gates',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote(),web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'VERIFIED_MATCHING_FRESH');assert.equal(d.marketEvidence.independentSourceCount,3);assert.ok(d.decisionGates.some(g=>g.id==='market_quote'&&g.status==='PASS'));assert.ok(d.decisionGates.some(g=>g.id==='source_diversity'&&g.status==='PASS'))}],
 ['Observation-only timestamp is blocked',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),sourceTimestampType:'OBSERVATION_TIMESTAMP'},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'PROVIDER_TIMESTAMP_REQUIRED');assert.match(d.decision,/WAIT/)}],
 ['Wrong symbol is blocked',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),ticker:'TCS'},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'SYMBOL_MISMATCH');assert.match(d.decision,/WAIT/)}],
 ['Stale quote is blocked',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),asOf:new Date(Date.now()-180000).toISOString()},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'QUOTE_STALE_OR_TIMESTAMP_INVALID');assert.match(d.decision,/WAIT/)}],
 ['Natural-language query extracts ticker after “Analyse”',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote(),web:{...corroboratedWeb,query:'Analyse IRFC for intraday trading with ₹1,000'}}),d=>{assert.equal(d.marketEvidence.requestedTicker,'IRFC');assert.equal(d.marketEvidence.quoteStatus,'VERIFIED_MATCHING_FRESH')}],
 ['Generic market request cannot use an unrelated cached quote',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote(),web:{...corroboratedWeb,query:'Can you analyse the market and help me invest?'}}),d=>{assert.equal(d.marketEvidence.requestedTicker,null);assert.equal(d.marketEvidence.quoteStatus,'REQUESTED_SYMBOL_UNRESOLVED');assert.match(d.decision,/WAIT/)}],
 ['Explicit false eligibility cannot be overridden by nested allow status',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),executionEligible:false,forecastEligible:true,marketDataOS:{decision:'ALLOW_ANALYSIS_AND_PAPER'}},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'QUOTE_NOT_EXECUTION_ELIGIBLE');assert.match(d.decision,/WAIT/)}]
];

for(const [name,result,check] of cases){check(result);console.log('PASS:',name)}
console.log('CEO/CFO/Judge automated tests: '+cases.length+'/'+cases.length+' passed with verified market quote, source-diversity and risk gates');
