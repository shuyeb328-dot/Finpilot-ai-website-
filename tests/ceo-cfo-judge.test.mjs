import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildMarketSnapshot} from '../server/market-snapshot.mjs';

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

const goodQuote=(overrides={})=>({
 ticker:'IRFC',symbol:'IRFC',price:103,asOf:new Date().toISOString(),
 sourceTimestampType:'PROVIDER_TIMESTAMP',provider:'NSE public',executionEligible:true,...overrides
});
const goodCanonicalSnapshot=(ticker='IRFC')=>{
 const now=Date.now();
 const sourceAsOf=new Date(now-10000).toISOString();
 const candles=[
  {time:new Date(now-120000).toISOString(),open:101,high:104,low:100,close:102,volume:1000},
  {time:new Date(now-60000).toISOString(),open:102,high:105,low:101,close:103,volume:1200}
 ];
 return buildMarketSnapshot({
  ticker,symbol:ticker,name:ticker,market:'INDIA_EQUITY',exchange:'NSE',currency:'INR',
  price:103,previous:101,changePct:1.98,dayHigh:105,dayLow:100,live:true,
  asOf:sourceAsOf,sourceTimestampType:'PROVIDER_TIMESTAMP',provider:'NSE public',candles
 },{requestedTicker:ticker,capturedAt:now,maxAgeMs:90000});
};
const corroboratedWeb={query:'IRFC',provider:'public research',count:3,stance:'Positive',confidence:80,
 urls:['https://www.nseindia.com/example','https://www.screener.in/company/IRFC/','https://www.bseindia.com/example']};
const cases=[
 ['Liquidity gate',run({emergency:100000,spending:52000,income:90000}),d=>{assert.equal(d.executive.cfo.startsWith('Liquidity is the binding constraint'),true);assert.equal(d.decision,'CFO wins: strengthen liquidity before increasing risk');assert.ok(d.decisionGates.some(g=>g.id==='liquidity'&&g.blocking))}],
 ['High-severity risk gate',run({emergency:300000,spending:50000,income:90000,findings:[{severity:'HIGH',domain:'Debt'}]}),d=>{assert.equal(d.executive.cfo.includes('high-severity'),true);assert.equal(d.decision,'Risk gate wins: resolve the highest-severity finding before adding new risk');assert.ok(d.decisionGates.some(g=>g.id==='high_severity_findings'&&g.blocking))}],
 ['Positive headlines without quote are blocked',run({emergency:300000,spending:50000,income:90000,web:{...corroboratedWeb,urls:[]}}),d=>{assert.equal(d.webSignal.stance,'Positive');assert.equal(d.marketEvidence.quoteStatus,'NO_VERIFIED_QUOTE');assert.match(d.decision,/WAIT/);assert.ok(d.confidence<=40);assert.ok(d.decisionGates.some(g=>g.id==='market_quote'&&g.blocking))}],
 ['Market quote gate becomes an explicit Data Auditor veto',run({emergency:300000,spending:50000,income:90000,web:{...corroboratedWeb,urls:[]}}),d=>{const auditor=d.debate.initialPositions.find(p=>p.role==='Data Auditor');assert.equal(auditor.decisionEffect,'VETO');assert.ok(auditor.challenge);assert.ok(auditor.response.includes('cannot override')) ;assert.equal(d.debate.finalResolution.capitalAllocationStatus,'BLOCKED')}],
 ['Cautious web risk still respects hard data gate',run({emergency:300000,spending:50000,income:90000,web:{...corroboratedWeb,stance:'Cautious'}}),d=>{assert.equal(d.webSignal.stance,'Cautious');assert.match(d.decision,/WAIT/);assert.ok(d.marketEvidence.blockingReason);assert.ok(d.executive.cfoConfidence>=0&&d.executive.cfoConfidence<=100)}],
 ['Canonical nested market snapshot clears gates when verified',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodCanonicalSnapshot(),web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'VERIFIED_MATCHING_FRESH');assert.equal(d.marketEvidence.ticker,'IRFC');assert.equal(d.marketEvidence.provider,'NSE public');assert.equal(d.marketEvidence.sourceTimestampType,'PROVIDER_TIMESTAMP');assert.equal(d.marketEvidence.independentSourceCount,3);assert.ok(d.decisionGates.some(g=>g.id==='market_quote'&&g.status==='PASS'));assert.ok(d.decisionGates.some(g=>g.id==='source_diversity'&&g.status==='PASS'))}],
 ['Observation-only timestamp is blocked',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),sourceTimestampType:'OBSERVATION_TIMESTAMP'},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'PROVIDER_TIMESTAMP_REQUIRED');assert.match(d.decision,/WAIT/)}],
 ['Wrong symbol is blocked',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),ticker:'TCS'},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'SYMBOL_MISMATCH');assert.match(d.decision,/WAIT/)}],
 ['Stale quote is blocked',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),asOf:new Date(Date.now()-180000).toISOString()},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'QUOTE_STALE_OR_TIMESTAMP_INVALID');assert.match(d.decision,/WAIT/)}],
 ['Natural-language query extracts ticker after “Analyse”',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote(),web:{...corroboratedWeb,query:'Analyse IRFC for intraday trading with ₹1,000'}}),d=>{assert.equal(d.marketEvidence.requestedTicker,'IRFC');assert.equal(d.marketEvidence.quoteStatus,'VERIFIED_MATCHING_FRESH')}],
 ['Generic market request cannot use an unrelated cached quote',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote(),web:{...corroboratedWeb,query:'Can you analyse the market and help me invest?'}}),d=>{assert.equal(d.marketEvidence.requestedTicker,null);assert.equal(d.marketEvidence.quoteStatus,'REQUESTED_SYMBOL_UNRESOLVED');assert.match(d.decision,/WAIT/)}],
 ['Explicit false eligibility cannot be overridden by nested allow status',run({emergency:300000,spending:50000,income:90000,marketSnapshot:{...goodQuote(),executionEligible:false,forecastEligible:true,marketDataOS:{decision:'ALLOW_ANALYSIS_AND_PAPER'}},web:corroboratedWeb}),d=>{assert.equal(d.marketEvidence.quoteStatus,'QUOTE_NOT_EXECUTION_ELIGIBLE');assert.match(d.decision,/WAIT/)}],
 ['Known company alias resolves Tesla to TSLA',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote({ticker:'TSLA',symbol:'TSLA',provider:'Yahoo Finance'}),web:{...corroboratedWeb,query:'Analyse Tesla stock for next 30 days'}}),d=>{assert.equal(d.marketEvidence.requestedTicker,'TSLA');assert.equal(d.marketEvidence.quoteStatus,'VERIFIED_MATCHING_FRESH')}],
 ['Common Indian ticker alias resolves SBI to SBIN',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote({ticker:'SBIN',symbol:'SBIN'}),web:{...corroboratedWeb,query:'Analyse SBI stock'}}),d=>{assert.equal(d.marketEvidence.requestedTicker,'SBIN');assert.equal(d.marketEvidence.quoteStatus,'VERIFIED_MATCHING_FRESH')}],
 ['Multi-instrument comparison is blocked until comparative evidence exists',run({emergency:300000,spending:50000,income:90000,marketSnapshot:goodQuote({ticker:'TCS',symbol:'TCS'}),web:{...corroboratedWeb,query:'Compare TCS and Infosys'}}),d=>{assert.equal(d.marketEvidence.quoteStatus,'MULTIPLE_INSTRUMENTS_REQUIRE_COMPARATIVE_EVIDENCE');assert.match(d.decision,/WAIT/) }]
];

for(const [name,result,check] of cases){
 check(result);
 assert.equal(result.debate?.mode,'DETERMINISTIC_EVIDENCE_RULES',name+' must produce an honest deterministic debate trace');
 assert.equal(result.debate?.initialPositions?.length,7,name+' must record all seven decision roles');
 assert.equal(result.debate?.rounds?.length,3,name+' must include initial positions, cross-examination and veto reconciliation');
 assert.ok(result.debate.initialPositions.every(p=>p.challenge&&p.response&&Array.isArray(p.evidence)),name+' must include each role\'s challenge, response and evidence basis');
 assert.equal(result.debate.finalResolution.automaticExecution,false,name+' must never auto-execute a financial action');
 if(result.decisionGates.some(g=>g.blocking)) {
   assert.ok(result.debate.hardVetoes.length>0,name+' must retain hard safety vetoes');
   assert.equal(result.debate.finalResolution.capitalAllocationStatus,'BLOCKED',name+' must not allocate capital while a hard gate blocks');
 }
 console.log('PASS:',name);
}
console.log('CEO/CFO/Judge automated tests: '+cases.length+'/'+cases.length+' passed with verified market quote, source-diversity and risk gates');
