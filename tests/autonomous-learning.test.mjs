import assert from 'node:assert/strict';
import {AUTONOMOUS_AGENT_PROFILES,runCycle,status} from '../server/autonomous-learning.mjs';

assert.equal(AUTONOMOUS_AGENT_PROFILES.length,12);
assert.ok(AUTONOMOUS_AGENT_PROFILES.some(x=>x.id==='Research'));
assert.ok(AUTONOMOUS_AGENT_PROFILES.some(x=>x.id==='RedTeam'));

const r=await runCycle({
  searchWeb:async()=>({provider:'test',results:[
    {title:'Official filing evidence',url:'https://www.sec.gov/example-filing',snippet:'Primary filing with material financial evidence.',publishedAt:new Date().toISOString(),source:'SEC'},
    {title:'Independent market analysis',url:'https://www.reuters.com/example',snippet:'Independent evidence with recent market context.',publishedAt:new Date().toISOString(),source:'Reuters'},
    {title:'Official filing evidence',url:'https://www.sec.gov/example-filing',snippet:'Duplicate source should be removed.',publishedAt:new Date().toISOString(),source:'SEC'}
  ]}),
  getSchedulerState:()=>({running:0,maxConcurrency:5,queue:[]}),
  emitEvent:()=>{},
  audit:()=>{}
});
assert.equal(r.ok,true);
assert.equal(r.status,'COMPLETED');
const s=status();
assert.ok(s.evidenceCount>=2);
assert.ok(s.candidateCount>=1);
assert.ok(s.trainingCaseCount>=1);
assert.equal(s.agents.CFO.status,'IDLE');
console.log('Autonomous Learning OS contract passed');
