import assert from 'node:assert/strict';
import {AUTONOMOUS_AGENT_PROFILES,runCycle,runLiveAgentComparison,status} from '../server/autonomous-learning.mjs';

assert.equal(AUTONOMOUS_AGENT_PROFILES.length,12);
assert.ok(AUTONOMOUS_AGENT_PROFILES.some(x=>x.id==='Research'));
assert.ok(AUTONOMOUS_AGENT_PROFILES.some(x=>x.id==='RedTeam'));

const groups=[
  [
    {title:'Official filing A',url:'https://www.sec.gov/a',snippet:'Primary filing with material capital allocation evidence.',publishedAt:new Date().toISOString(),source:'SEC'},
    {title:'Official filing B',url:'https://www.rbi.org.in/b',snippet:'Primary official policy and liquidity evidence.',publishedAt:new Date().toISOString(),source:'RBI'}
  ],
  [
    {title:'Independent analysis A',url:'https://www.reuters.com/a',snippet:'Independent recent analysis with market context.',publishedAt:new Date().toISOString(),source:'Reuters'},
    {title:'Independent analysis B',url:'https://www.bloomberg.com/b',snippet:'Independent recent analysis of capital allocation.',publishedAt:new Date().toISOString(),source:'Bloomberg'}
  ],
  [
    {title:'Industry evidence A',url:'https://www.ft.com/a',snippet:'Recent evidence on investment decisions and liquidity.',publishedAt:new Date().toISOString(),source:'FT'},
    {title:'Company investor relations',url:'https://ir.example.com/c',snippet:'Recent investor relations disclosure on capital plans.',publishedAt:new Date().toISOString(),source:'Company IR'}
  ],
  [
    {title:'Independent evidence C',url:'https://www.cnbc.com/c',snippet:'Recent balanced market evidence without a strong contradiction.',publishedAt:new Date().toISOString(),source:'CNBC'},
    {title:'Government guidance',url:'https://www.gov.in/d',snippet:'Recent government guidance relevant to financial decisions.',publishedAt:new Date().toISOString(),source:'Gov'}
  ]
];
let qi=0;
const r=await runCycle({
  searchWeb:async()=>({provider:'test',results:groups[qi++]||[]}),
  getSchedulerState:()=>({running:0,maxConcurrency:5,queue:[]}),
  emitEvent:()=>{},
  audit:()=>{}
});
assert.equal(r.ok,true);
assert.equal(r.status,'COMPLETED');
assert.equal(r.evidence,8);
assert.equal(r.accepted,8);
assert.equal(r.candidateStatus,'PENDING_TRAINING_VALIDATION');
assert.ok(r.qualityScore>=70);

const live=await runLiveAgentComparison({
  searchWeb:async(q)=>({provider:'test',results:[
    {title:'Primary evidence',url:'https://www.sec.gov/'+encodeURIComponent(q.slice(0,18)),snippet:'Official recent evidence from a primary source with risk context.',publishedAt:new Date().toISOString(),source:'SEC'},
    {title:'Independent evidence',url:'https://www.reuters.com/'+encodeURIComponent(q.slice(18,36)),snippet:'Independent recent evidence for comparison and uncertainty.',publishedAt:new Date().toISOString(),source:'Reuters'},
    {title:'Government evidence',url:'https://www.gov.in/'+encodeURIComponent(q.slice(36,54)),snippet:'Official guidance relevant to the research question.',publishedAt:new Date().toISOString(),source:'Gov'}
  ]}),
  emitEvent:()=>{},
  audit:()=>{}
});
assert.equal(live.ok,true);
assert.equal(live.status,'COMPLETED');
assert.equal(live.tests,12);
assert.equal(live.rankings.length,12);
assert.equal(new Set(live.rankings.map(x=>x.agent)).size,12);
assert.equal(live.rankings[0].rank,1);
assert.equal(live.rankings[11].rank,12);
assert.ok(live.averageScore>0);

const s=status();
assert.ok(s.evidenceCount>=8);
assert.ok(s.candidateCount>=1);
assert.ok(s.trainingCaseCount>=1);
assert.equal(s.agents.CFO.status,'IDLE');
console.log('Autonomous Learning OS + 12-agent live comparison contract passed');
