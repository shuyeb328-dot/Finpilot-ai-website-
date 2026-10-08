/* FinPilot Autonomous Agent Learning OS 2.0
   Background research + data quality + governed training queue.
*/
import pg from 'pg';
const {Pool}=pg;

export const AUTONOMOUS_AGENT_PROFILES=[
  {id:'CFO',priority:100,topics:['cash flow','capital allocation','liquidity','profit quality'],querySuffix:'official filings financial statements cash flow capital allocation risk'},
  {id:'Debt',priority:85,topics:['credit','interest rates','refinancing','duration'],querySuffix:'credit markets rates refinancing debt risk official sources'},
  {id:'Goals',priority:70,topics:['goal probability','time horizon','contributions','portfolio fit'],querySuffix:'portfolio suitability long term investing goal planning evidence'},
  {id:'Risk',priority:100,topics:['tail risk','drawdown','concentration','liquidity'],querySuffix:'market risk drawdown liquidity concentration stress testing'},
  {id:'Investment',priority:95,topics:['valuation','fundamentals','quality','expected return'],querySuffix:'valuation fundamentals earnings quality intrinsic value primary sources'},
  {id:'Markets',priority:95,topics:['regime','macro','volatility','market structure'],querySuffix:'market regime volatility macro market structure latest'},
  {id:'Tax',priority:95,topics:['tax treatment','jurisdiction','holding period','compliance'],querySuffix:'tax regulation official government guidance investment taxation'},
  {id:'Security',priority:100,topics:['fraud','privacy','prompt injection','provider risk'],querySuffix:'financial fraud cyber risk prompt injection data security'},
  {id:'Business',priority:80,topics:['companies','deals','competitive position','management'],querySuffix:'company earnings acquisitions competitive position management primary sources'},
  {id:'Assets',priority:75,topics:['real estate','commodities','alternative assets','liabilities'],querySuffix:'real estate commodities alternative assets valuation liquidity'},
  {id:'Research',priority:90,topics:['primary sources','contradiction','freshness','source diversity'],querySuffix:'financial research primary sources filings academic evidence contradiction'},
  {id:'RedTeam',priority:110,topics:['counterexamples','bias','failure modes','groupthink'],querySuffix:'financial AI failure modes adversarial testing bias manipulation'}
];

const intervalMs=Math.max(60000,Number(process.env.AUTO_RESEARCH_INTERVAL_MS||300000));
const maxResults=Math.max(3,Math.min(12,Number(process.env.AUTO_RESEARCH_RESULTS||8)));
const enabledByEnv=String(process.env.FINPILOT_AUTO_RESEARCH||'true').toLowerCase()!=='false';

const state={
  version:'2.0',enabled:enabledByEnv,mode:'IDLE_AGENT_AUTORESEARCH',intervalMs,
  running:false,cycle:0,cursor:0,activeAgent:null,lastCycleAt:null,lastSuccessAt:null,lastError:null,nextRunAt:null,
  stats:{cycles:0,queries:0,evidenceCollected:0,evidenceAccepted:0,candidates:0,trainingCases:0,duplicates:0,failed:0,primarySources:0,sourceDomains:0,contradictionFlags:0},
  agents:Object.fromEntries(AUTONOMOUS_AGENT_PROFILES.map(a=>[a.id,{status:'IDLE',jobs:0,lastResearchAt:null,lastTopic:null,lastQuality:null,lastCandidate:null}])),
  queue:[],candidates:[],trainingCases:[],evidence:[],liveTest:{running:false,lastRunAt:null,lastError:null,tests:0,averageScore:null,rankings:[],agents:{},improvement:{tests:0,completed:0,averageDelta:null,agents:[]}}
};

let timer=null,dbPool=null,schemaReady=false;
const now=()=>new Date().toISOString();
const clean=(v,n=500)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
const hostOf=url=>{try{return new URL(url).hostname.replace(/^www\./i,'')}catch{return ''}};
function tier(row){
  const h=(hostOf(row.url)+' '+clean(row.title,160)).toLowerCase();
  if(/sec\.gov|sebi\.gov|rbi\.org|nseindia|bseindia|gov\.in|\.gov\.|investor relations|ir\./i.test(h))return 'PRIMARY';
  if(/reuters|bloomberg|wsj|ft\.com|financialtimes|cnbc|economist|moneycontrol|livemint/i.test(h))return 'HIGH_QUALITY_SECONDARY';
  return 'SECONDARY';
}
function freshness(row){
  const t=row.publishedAt?Date.parse(row.publishedAt):NaN;
  if(!Number.isFinite(t))return {score:55,label:'UNKNOWN_AGE',ageDays:null};
  const d=Math.max(0,(Date.now()-t)/86400000);
  if(d<=1)return {score:100,label:'FRESH',ageDays:+d.toFixed(2)};
  if(d<=7)return {score:85,label:'RECENT',ageDays:+d.toFixed(2)};
  if(d<=30)return {score:65,label:'AGING',ageDays:+d.toFixed(2)};
  return {score:35,label:'STALE',ageDays:+d.toFixed(2)};
}
function quality(row){
  const ts=tier(row)==='PRIMARY'?100:tier(row)==='HIGH_QUALITY_SECONDARY'?80:60;
  const fs=freshness(row).score;
  const txt=clean((row.title||'')+' '+(row.snippet||''),800);
  const useful=txt.length>=80?100:txt.length>=40?75:45;
  return Math.round(ts*.45+fs*.35+useful*.2);
}
const fp=row=>hostOf(row.url)+'|'+clean(row.title,180).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

function normalize(rows,profile,query){
  const seen=new Set(),out=[];
  for(const raw of Array.isArray(rows)?rows:[]){
    if(!raw?.url||!/^https?:\/\//i.test(raw.url))continue;
    const row={title:clean(raw.title,220),url:raw.url,snippet:clean(raw.snippet||raw.description||'',900),source:clean(raw.source||hostOf(raw.url),100),publishedAt:raw.publishedAt||raw.publishedDate||null};
    const fingerprint=fp(row);if(!fingerprint||seen.has(fingerprint))continue;seen.add(fingerprint);
    out.push({...row,fingerprint,domain:hostOf(row.url),sourceTier:tier(row),freshness:freshness(row),qualityScore:quality(row),agent:profile.id,topic:profile.topics[state.cycle%profile.topics.length],query,collectedAt:now()});
  }
  return out.sort((a,b)=>b.qualityScore-a.qualityScore);
}
function pickAgent(){
  const nowMs=Date.now();
  const ranked=AUTONOMOUS_AGENT_PROFILES.map((p,i)=>{
    const a=state.agents[p.id];
    const age=a.lastResearchAt?Math.min(10,(nowMs-Date.parse(a.lastResearchAt))/3600000):12;
    const quality=a.lastQuality==null?0:Number(a.lastQuality);
    const weakness=Math.max(0,(80-quality)/4);
    const priority=Number(p.priority||50)/20;
    const fairness=((state.cursor+i)%AUTONOMOUS_AGENT_PROFILES.length)*0.001;
    return {p,score:priority+age+weakness+fairness};
  }).filter(x=>state.agents[x.p.id].status==='IDLE').sort((a,b)=>b.score-a.score);
  const chosen=(ranked[0]||{p:AUTONOMOUS_AGENT_PROFILES[state.cursor%AUTONOMOUS_AGENT_PROFILES.length]}).p;
  state.cursor=(AUTONOMOUS_AGENT_PROFILES.findIndex(x=>x.id===chosen.id)+1)%AUTONOMOUS_AGENT_PROFILES.length;
  return chosen;
}
function free(getSchedulerState){
  if(!state.enabled||state.running)return false;
  const s=getSchedulerState?.()||{running:0,maxConcurrency:5,queue:[]};
  const spare=Math.max(0,Number(s.maxConcurrency||5)-Number(s.running||0));
  const urgent=(s.queue||[]).filter(x=>Number(x.priority||0)>=140).length;
  return spare>=1&&urgent===0;
}
async function db(){
  if(!process.env.DATABASE_URL)return null;
  if(dbPool)return dbPool;
  dbPool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:2,idleTimeoutMillis:30000});
  try{
    await dbPool.query('CREATE TABLE IF NOT EXISTS finpilot_learning_evidence (id BIGSERIAL PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, agent TEXT NOT NULL, topic TEXT, query TEXT, title TEXT, url TEXT, source TEXT, source_tier TEXT, published_at TIMESTAMPTZ, quality_score DOUBLE PRECISION, payload JSONB, collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await dbPool.query('CREATE TABLE IF NOT EXISTS finpilot_learning_candidates (id BIGSERIAL PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, agent TEXT NOT NULL, topic TEXT, status TEXT NOT NULL, quality_score DOUBLE PRECISION, evidence_count INT, primary_count INT, diversity_count INT, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await dbPool.query('CREATE TABLE IF NOT EXISTS finpilot_agent_live_benchmarks (id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, agent TEXT NOT NULL, topic TEXT, score DOUBLE PRECISION, rank_no INT, status TEXT, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await dbPool.query('CREATE INDEX IF NOT EXISTS finpilot_agent_live_benchmarks_agent_idx ON finpilot_agent_live_benchmarks(agent,created_at DESC)');
    schemaReady=true;
  }catch(e){schemaReady=false;state.lastError='DB schema: '+e.message}
  return schemaReady?dbPool:null;
}
async function persistEvidence(rows){
  const pool=await db();if(!pool)return;
  for(const r of rows)try{await pool.query(
    'INSERT INTO finpilot_learning_evidence(fingerprint,agent,topic,query,title,url,source,source_tier,published_at,quality_score,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (fingerprint) DO NOTHING',
    [r.fingerprint,r.agent,r.topic,r.query,r.title,r.url,r.source,r.sourceTier,r.publishedAt?new Date(r.publishedAt):null,r.qualityScore,r]
  )}catch{}
}
async function persistCandidate(c){
  const pool=await db();if(!pool)return;
  try{await pool.query(
    'INSERT INTO finpilot_learning_candidates(fingerprint,agent,topic,status,quality_score,evidence_count,primary_count,diversity_count,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (fingerprint) DO NOTHING',
    [c.fingerprint,c.agent,c.topic,c.status,c.qualityScore,c.evidenceCount,c.primaryCount,c.sourceDiversity,c]
  )}catch{}
}


function liveAgentScore(rows){
  if(!rows.length)return {score:0,qualityScore:0,primaryRate:0,diversity:0,freshnessScore:0,evidence:0,contradiction:0};
  const qualityScore=Math.round(rows.reduce((n,x)=>n+x.qualityScore,0)/rows.length);
  const primaryRate=Math.round(rows.filter(x=>x.sourceTier==='PRIMARY').length/rows.length*100);
  const diversity=new Set(rows.map(x=>x.domain).filter(Boolean)).size;
  const diversityScore=Math.min(100,diversity*12.5);
  const freshnessScore=Math.round(rows.reduce((n,x)=>n+x.freshness.score,0)/rows.length);
  const text=rows.map(x=>(x.title+' '+x.snippet).toLowerCase()).join(' ');
  const pos=(text.match(/growth|gain|increase|upgrade|bullish|outperform|record/g)||[]).length;
  const neg=(text.match(/loss|decline|downgrade|bearish|risk|warning|lawsuit|fraud/g)||[]).length;
  const contradiction=Math.abs(pos-neg)>=3?1:0;
  const score=Math.max(0,Math.min(100,Math.round(qualityScore*.35+primaryRate*.25+diversityScore*.15+freshnessScore*.15+Math.min(100,rows.length*5)*.10-(contradiction?8:0))));
  return {score,qualityScore,primaryRate,diversity,diversityScore,freshnessScore,evidence:rows.length,contradiction};
}
async function persistLiveBenchmarkRows(runId,rows){
  const pool=await db();if(!pool)return;
  for(const r of rows)try{await pool.query(
    'INSERT INTO finpilot_agent_live_benchmarks(run_id,agent,topic,score,rank_no,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [runId,r.agent,r.topic,r.score,r.rank,r.status,r]
  )}catch{}
}
export async function runLiveAgentComparison({searchWeb,emitEvent,audit,improveWeak=true}={}){
  if(state.liveTest.running)return {ok:true,status:'RUNNING',liveTest:state.liveTest};
  if(typeof searchWeb!=='function')return {ok:false,status:'ERROR',error:'SEARCH_ENGINE_UNAVAILABLE'};
  state.liveTest.running=true;state.liveTest.lastError=null;
  const runId='live-'+Date.now().toString(36);
  const results=[];
  const profiles=[...AUTONOMOUS_AGENT_PROFILES];
  const concurrency=3;
  let nextProfileIndex=0;
  async function worker(){
    while(true){
      const idx=nextProfileIndex++;
      if(idx>=profiles.length)return;
      const profile=profiles[idx];
      const topic=profile.topics[state.cycle%profile.topics.length];
      const queries=[
        topic+' '+profile.querySuffix+' latest',
        topic+' counter evidence risks failures contradictions latest'
      ];
      try{
        const responses=await Promise.all(queries.map(q=>searchWeb(q,{count:maxResults}).catch(e=>({provider:'error',results:[],error:e.message}))));
        const merged=[];for(let i=0;i<responses.length;i++)for(const item of (responses[i]?.results||[]))merged.push({...item,queryLabel:queries[i]});
        const rows=normalize(merged,profile,queries[0]);
        const s=liveAgentScore(rows);
        results.push({runId,agent:profile.id,topic,score:s.score,status:s.score>=85?'ELITE':s.score>=75?'READY':s.score>=65?'REVIEW':'WEAK',provider:[...new Set(responses.map(x=>x?.provider).filter(Boolean))].join(','),...s});
      }catch(e){results.push({runId,agent:profile.id,topic,score:0,status:'ERROR',provider:'unknown',error:e.message,evidence:0,qualityScore:0,primaryRate:0,diversity:0,freshnessScore:0,contradiction:0})}
    }
  }
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  results.sort((a,b)=>b.score-a.score);
  results.forEach((r,i)=>{r.rank=i+1;r.delta=state.liveTest.agents[r.agent]?.score==null?null:r.score-state.liveTest.agents[r.agent].score});
  const avg=results.length?Math.round(results.reduce((n,x)=>n+x.score,0)/results.length):0;
  let improvement={tests:0,completed:0,averageDelta:null,agents:[]};
  if(improveWeak){
    const weak=results.slice(-4);
    const improvements=[];
    for(const base of weak){
      const profile=profiles.find(p=>p.id===base.agent);
      if(!profile)continue;
      const gap=base.primaryRate<40?'primary-source coverage':base.freshnessScore<60?'freshness':base.diversity<12?'source diversity':'evidence quality and contradiction checking';
      const iq=[
        base.topic+' '+profile.querySuffix+' official primary source regulator filing latest',
        base.topic+' '+profile.querySuffix+' independent evidence contradiction risk latest',
        base.topic+' '+gap+' finance evidence latest'
      ];
      try{
        const rr=await Promise.all(iq.map(q=>searchWeb(q,{count:maxResults}).catch(e=>({provider:'error',results:[],error:e.message}))));
        const merged=[];for(let i=0;i<rr.length;i++)for(const item of (rr[i]?.results||[]))merged.push({...item,queryLabel:iq[i]});
        const rows=normalize(merged,profile,iq[0]);
        const extra=liveAgentScore(rows);
        const delta=extra.score-base.score;
        const candidate={
          id:'live-improve-'+Date.now().toString(36)+'-'+profile.id,
          fingerprint:'LIVE_IMPROVEMENT|'+profile.id+'|'+Date.now().toString(36),
          agent:profile.id,topic:base.topic,query:iq.join(' | '),
          status:extra.score>=70?'PENDING_TRAINING_VALIDATION':'NEEDS_MORE_EVIDENCE',
          qualityScore:extra.qualityScore,evidenceCount:extra.evidence,primaryCount:Math.round(extra.primaryRate/100*extra.evidence),
          sourceDiversity:extra.diversity,freshnessScore:extra.freshnessScore,contradictionSignals:extra.contradiction,
          learningObjective:'Improve '+profile.id+' on '+gap+' using targeted fresh evidence.',
          successCondition:'Outperform baseline evidence benchmark without weakening safety or source discipline.',
          createdAt:now()
        };
        const freshRows=rows.filter(r=>!state.evidence.some(e=>e.fingerprint===r.fingerprint));
        state.evidence.unshift(...freshRows);state.evidence=state.evidence.slice(0,1000);await persistEvidence(freshRows);
        state.candidates.unshift(candidate);state.candidates=state.candidates.slice(0,250);state.stats.candidates++;
        if(candidate.status==='PENDING_TRAINING_VALIDATION'){
          const tc={id:'tc-live-'+Date.now().toString(36)+'-'+profile.id,agent:profile.id,topic:base.topic,
            prompt:'Targeted improvement case: '+gap+'. Compare baseline evidence quality against the targeted research, identify what changed, and state what the agent must learn without directly changing production behavior.',
            sourceCandidate:candidate.id,status:'QUEUED',createdAt:now()};
          state.trainingCases.unshift(tc);state.trainingCases=state.trainingCases.slice(0,250);state.queue.unshift({...tc,priority:profile.priority+10});state.queue=state.queue.slice(0,250);state.stats.trainingCases++;
        }
        improvements.push({agent:profile.id,before:base.score,after:extra.score,delta,status:candidate.status,gap,evidence:extra.evidence,primaryRate:extra.primaryRate,diversity:extra.diversity,freshnessScore:extra.freshnessScore});
      }catch(e){
        improvements.push({agent:profile.id,before:base.score,after:base.score,delta:0,status:'ERROR',gap,error:e.message});
      }
    }
    const completed=improvements.filter(x=>x.status!=='ERROR');
    const avgDelta=completed.length?Math.round(completed.reduce((n,x)=>n+x.delta,0)/completed.length):null;
    improvement={tests:improvements.length,completed:completed.length,averageDelta:avgDelta,agents:improvements};
  }
  state.liveTest={running:false,lastRunAt:now(),lastError:results.some(x=>x.status==='ERROR')?'ONE_OR_MORE_AGENT_TESTS_FAILED':null,tests:results.length,averageScore:avg,
    rankings:results.map(x=>({agent:x.agent,score:x.score,rank:x.rank,status:x.status,delta:x.delta,evidence:x.evidence,primaryRate:x.primaryRate,diversity:x.diversity,freshnessScore:x.freshnessScore})),
    agents:Object.fromEntries(results.map(x=>[x.agent,x])),improvement};
  await persistLiveBenchmarkRows(runId,results);
  audit?.('AUTONOMOUS_AGENT_LIVE_COMPARISON',{runId,tests:results.length,averageScore:avg,winner:results[0]?.agent||null,weakest:results.at(-1)?.agent||null});
  emitEvent?.('AGENT_LIVE_COMPARISON',{runId,tests:results.length,averageScore:avg,winner:results[0]?.agent||null,weakest:results.at(-1)?.agent||null},80);
  return {ok:true,status:'COMPLETED',runId,tests:results.length,averageScore:avg,rankings:state.liveTest.rankings,agents:state.liveTest.agents,improvement:state.liveTest.improvement};
}
export async function runCycle({searchWeb,emitEvent,audit,getSchedulerState}={}){
  if(!free(getSchedulerState))return {ok:true,status:'DEFERRED_BUSY'};
  const profile=pickAgent();
  state.running=true;state.cycle++;state.activeAgent=profile.id;state.lastError=null;
  state.agents[profile.id].status='RESEARCHING';state.agents[profile.id].jobs++;
  const topic=profile.topics[state.cycle%profile.topics.length];
  const query=topic+' '+profile.querySuffix+' latest';
  state.nextRunAt=new Date(Date.now()+state.intervalMs).toISOString();
  try{
    const querySet=[
      query,
      topic+' official filing regulator government primary source latest',
      topic+' independent market analysis evidence latest',
      topic+' bearish risk warning contradiction fraud failure case latest'
    ];
    const results=await Promise.all(querySet.map(q=>searchWeb(q,{count:maxResults}).catch(e=>({provider:'error',results:[],error:e.message}))));
    state.stats.searched++;
    state.stats.queries+=querySet.length;
    const merged=[];
    for(let i=0;i<results.length;i++){
      const rr=results[i];
      for(const item of (rr?.results||[]))merged.push({...item,queryLabel:querySet[i]});
    }
    const rows=normalize(merged,profile,query);
    const old=new Set(state.evidence.map(x=>x.fingerprint));
    const fresh=rows.filter(x=>!old.has(x.fingerprint));
    state.stats.duplicates+=Math.max(0,rows.length-fresh.length);
    state.stats.evidenceCollected+=rows.length;
    state.stats.evidenceAccepted+=fresh.length;
    state.evidence.unshift(...fresh);state.evidence=state.evidence.slice(0,1000);
    await persistEvidence(fresh);
    const primary=fresh.filter(x=>x.sourceTier==='PRIMARY').length;
    const diversity=new Set(fresh.map(x=>x.domain).filter(Boolean)).size;
    const freshnessScore=fresh.length?Math.round(fresh.reduce((n,x)=>n+x.freshness.score,0)/fresh.length):0;
    const avg=rows.length?Math.round(rows.reduce((n,x)=>n+x.qualityScore,0)/rows.length):0;
    const positive=(rows.map(x=>(x.title+' '+x.snippet).toLowerCase()).join(' ').match(/growth|gain|increase|upgrade|bullish|outperform|record/g)||[]).length;
    const negative=(rows.map(x=>(x.title+' '+x.snippet).toLowerCase()).join(' ').match(/loss|decline|downgrade|bearish|risk|warning|lawsuit|fraud/g)||[]).length;
    const contradiction=Math.abs(positive-negative)>=3?1:0;
    state.stats.primarySources+=primary;
    state.stats.sourceDomains+=diversity;
    state.stats.contradictionFlags+=contradiction;
    const validated=rows.length>=6&&primary>=1&&diversity>=3&&avg>=70&&freshnessScore>=55&&contradiction===0;
    const candidate={
      id:'lc-'+Date.now().toString(36),
      fingerprint:profile.id+'|'+topic+'|'+rows.map(x=>x.fingerprint).sort().join('|').slice(0,900),
      agent:profile.id,topic,query,status:validated?'PENDING_TRAINING_VALIDATION':'NEEDS_MORE_EVIDENCE',
      qualityScore:avg,evidenceCount:rows.length,primaryCount:primary,sourceDiversity:diversity,freshnessScore,contradictionSignals:contradiction,queryCount:querySet.length,providers:[...new Set(results.map(x=>x?.provider).filter(Boolean))],source:'multi-query-research',
      evidence:rows.slice(0,12).map(x=>({title:x.title,url:x.url,sourceTier:x.sourceTier,qualityScore:x.qualityScore,publishedAt:x.publishedAt,queryLabel:x.queryLabel||null})),
      learningObjective:'Upgrade '+profile.id+' knowledge on '+topic+' using verified, fresh evidence.',
      successCondition:'Pass multi-query source-quality, freshness, diversity, contradiction and benchmark gates before promotion.',
      createdAt:now()
    };
    if(!state.candidates.some(x=>x.fingerprint===candidate.fingerprint)){
      state.candidates.unshift(candidate);state.candidates=state.candidates.slice(0,250);state.stats.candidates++;await persistCandidate(candidate);
    }else state.stats.duplicates++;
    if(validated){
      const tc={id:'tc-'+Date.now().toString(36),agent:profile.id,topic,
        prompt:'Review the collected evidence for '+topic+'. Separate facts from inference, identify conflicts, state uncertainty, and propose what the agent should learn.',
        sourceCandidate:candidate.id,status:'QUEUED',createdAt:now()};
      state.trainingCases.unshift(tc);state.trainingCases=state.trainingCases.slice(0,250);state.queue.unshift({...tc,priority:profile.priority});state.queue=state.queue.slice(0,250);state.stats.trainingCases++;
    }
    state.lastCycleAt=now();state.lastSuccessAt=state.lastCycleAt;state.stats.cycles++;
    const a=state.agents[profile.id];a.lastResearchAt=state.lastSuccessAt;a.lastTopic=topic;a.lastQuality=avg;a.lastCandidate=candidate.id;a.status='IDLE';
    const providerSummary=[...new Set(results.map(x=>x?.provider).filter(Boolean))].join(',')||'unknown';
    try{emitEvent?.('AUTONOMOUS_RESEARCH_UPDATE',{agent:profile.id,topic,provider:providerSummary,evidenceCount:rows.length,accepted:fresh.length,qualityScore:avg,candidateStatus:candidate.status},75)}catch(eventError){console.error('[AUTONOMOUS_RESEARCH_EVENT_ERROR]',eventError?.message||String(eventError))}
    try{audit?.('AUTONOMOUS_RESEARCH_COMPLETE',{agent:profile.id,topic,provider:providerSummary,evidenceCount:rows.length,accepted:fresh.length,qualityScore:avg,candidateStatus:candidate.status})}catch(auditError){console.error('[AUTONOMOUS_RESEARCH_AUDIT_ERROR]',auditError?.message||String(auditError))}
    return {ok:true,status:'COMPLETED',agent:profile.id,topic,provider:providerSummary,evidence:rows.length,accepted:fresh.length,qualityScore:avg,candidateStatus:candidate.status};
  }catch(e){
    state.stats.failed++;state.lastError=e?.message||String(e);state.agents[profile.id].status='IDLE';
    try{audit?.('AUTONOMOUS_RESEARCH_ERROR',{agent:profile.id,topic,error:state.lastError,stack:String(e?.stack||'').split('\n').slice(0,4)})}catch{}
    console.error('[AUTONOMOUS_RESEARCH_ERROR]',JSON.stringify({agent:profile.id,topic,error:state.lastError,stack:String(e?.stack||'').split('\n').slice(0,4)}));
    return {ok:false,status:'ERROR',agent:profile.id,topic,error:state.lastError};
  }finally{
    state.running=false;state.activeAgent=null;state.nextRunAt=new Date(Date.now()+state.intervalMs).toISOString();
  }
}
export function status(){
  return {version:state.version,enabled:state.enabled,mode:state.mode,running:state.running,cycle:state.cycle,intervalMs:state.intervalMs,
    activeAgent:state.activeAgent,lastCycleAt:state.lastCycleAt,lastSuccessAt:state.lastSuccessAt,lastError:state.lastError,nextRunAt:state.nextRunAt,
    stats:{...state.stats},agents:Object.fromEntries(Object.entries(state.agents).map(([k,v])=>[k,{...v}])),
    queueCount:state.queue.length,candidateCount:state.candidates.length,evidenceCount:state.evidence.length,trainingCaseCount:state.trainingCases.length,
    recentCandidates:state.candidates.slice(0,12),recentTrainingCases:state.trainingCases.slice(0,12),recentEvidence:state.evidence.slice(0,12)};
}
export function queue(limit=40){return state.queue.slice(0,Math.max(1,Math.min(100,Number(limit)||40)))}
export function enable(value){
  state.enabled=Boolean(value);
  if(!state.enabled&&timer){clearInterval(timer);timer=null}
  if(state.enabled&&!timer)startTimer();
  state.nextRunAt=state.enabled?new Date(Date.now()+state.intervalMs).toISOString():null;
  return status();
}
function startTimer(){
  if(timer)clearInterval(timer);
  timer=setInterval(()=>{if(state.enabled)runCycle(globalThis.__finpilotAutonomousDeps||{}).catch(()=>{})},state.intervalMs);
}
export function init(deps){
  globalThis.__finpilotAutonomousDeps=deps||{};
  state.nextRunAt=state.enabled?new Date(Date.now()+state.intervalMs).toISOString():null;
  if(state.enabled)startTimer();
  return status();
}
export function cycleNow(deps){
  globalThis.__finpilotAutonomousDeps={...(globalThis.__finpilotAutonomousDeps||{}),...(deps||{})};
  return runCycle(globalThis.__finpilotAutonomousDeps);
}
