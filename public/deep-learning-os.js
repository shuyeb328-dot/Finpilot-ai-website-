/* FinPilot Deep Learning OS
   Adaptive, auditable learning layer for every agent.
   This is an online learning/calibration system, not a claim of training a foundation model.
   It learns from FinPilot outcomes, evidence quality and agent disagreement while keeping
   high-impact actions approval-gated.
*/
(function(){
'use strict';
const VERSION='DLO-1.0';
const KEY='finpilot_deep_learning_v1';
const AGENTS=['CEO','CFO','Risk','Judge','Market','Portfolio','Budget','Goals','Debt','Research','Investment','Markets','Tax','Security','Business','Assets','RedTeam'];
const FEATURES=['evidence','freshness','sentiment','market','risk','liquidity','disagreement','dataDepth'];
const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
function load(){
  try{return JSON.parse(localStorage.getItem(KEY)||'null')||{version:VERSION,runs:0,events:[],outcomes:[],weights:{},agents:{}}}
  catch{return {version:VERSION,runs:0,events:[],outcomes:[],weights:{},agents:{}}}
}
function save(x){try{localStorage.setItem(KEY,JSON.stringify(x))}catch{}}
function ensureAgent(s,name){
  if(!s.agents[name])s.agents[name]={runs:0,correct:0,accuracy:null,confidenceSum:0,calibration:0,weights:{}};
  const a=s.agents[name];
  FEATURES.forEach(f=>{if(!Number.isFinite(Number(a.weights[f])))a.weights[f]=1});
  return a;
}
function features(state,web){
  const ev=Array.isArray(state?.evidence)?state.evidence.length:0;
  const tx=Array.isArray(state?.transactions)?state.transactions.length:0;
  const reserve=Number(state?.emergency||0)/Math.max(1,Number(state?.spending||0));
  const free=Number(state?.income||0)-Number(state?.spending||0);
  const text=(Array.isArray(state?.evidence)?state.evidence.slice(0,12):[]).map(e=>String(e.claim||'')).join(' ').toLowerCase();
  const positive=(text.match(/\\b(gain|rise|bullish|growth|profit|strong|beat|award|deal|contract)\\b/g)||[]).length;
  const negative=(text.match(/\\b(fall|drop|bearish|loss|risk|warning|downgrade|debt|default|weak)\\b/g)||[]).length;
  return {
    evidence:clamp(45+ev*4),
    freshness:clamp(state?.lastEvidenceSync?75:35),
    sentiment:clamp(50+(positive-negative)*5+(web?.stance==='Positive'?12:web?.stance==='Cautious'?-12:0)),
    market:clamp(50+(web?.stance==='Positive'?18:web?.stance==='Cautious'?-18:0)),
    risk:clamp(75-(reserve<3?25:0)-(free<0?25:0)),
    liquidity:clamp(50+(reserve-3)*9+(free>0?12:-18)),
    disagreement:clamp(85),
    dataDepth:clamp(tx*4+ev*3)
  };
}
function weighted(a,f){
  let sum=0,den=0;FEATURES.forEach(k=>{const w=Number(a.weights[k]||1);sum+=Number(f[k]||0)*w;den+=Math.abs(w)});
  return den?clamp(sum/den):50;
}
function resolveCandidate(query,search,web){
  const q=String(query||'').toUpperCase();
  const catalog=[
    ['TCS','Tata Consultancy Services'],['INFY','Infosys'],['RELIANCE','Reliance Industries'],['GAIL','GAIL (India)'],
    ['HINDZINC','Hindustan Zinc'],['ITC','ITC'],['TATAPOWER','Tata Power'],['TATASTEEL','Tata Steel'],
    ['SUNPHARMA','Sun Pharmaceutical'],['TRENT','Trent'],['TECHM','Tech Mahindra'],['HCLTECH','HCLTech'],
    ['INDIGO','InterGlobe Aviation'],['JUBLFOOD','Jubilant FoodWorks'],['SENCO','Senco Gold'],
    ['PAYTM','One97 Communications'],['IRFC','Indian Railway Finance Corporation'],['SBIN','State Bank of India'],
    ['HDFCBANK','HDFC Bank'],['ICICIBANK','ICICI Bank'],['BHARTIARTL','Bharti Airtel'],['LT','Larsen & Toubro'],
    ['ADANIPORTS','Adani Ports'],['BAJFINANCE','Bajaj Finance'],['HINDALCO','Hindalco']
  ];
  const results=Array.isArray(search?.results)?search.results:[];
  const corpus=(q+' '+results.map(x=>(x.title||'')+' '+(x.snippet||'')).join(' ')).toUpperCase();
  const broad=/\\b(BEST|TOP|PICK|STOCK|TRADE|TRADING|TODAY|BUY|SELL)\\b/.test(q)&&!catalog.some(c=>q.includes(c[0])||q.includes(c[1].toUpperCase()));
  let candidates=catalog.filter(c=>corpus.includes(c[0])||corpus.includes(c[1].toUpperCase()));
  if(!candidates.length && !broad){
    const clean=q.replace(/\\b(BUY|SELL|STOCK|SHARE|ANALYZE|ANALYSIS|TODAY|TRADE|TRADING|PICK|BEST|FOR|THE|OF|TO)\\b/g,' ').trim().split(/\\s+/)[0];
    if(clean)candidates=[[clean,clean+' (symbol detected from query)']];
  }
  if(!candidates.length)return null;
  const f=features(typeof state!=='undefined'?state:{},web);
  const scored=candidates.map(c=>{
    let mentions=0,positive=0,negative=0;
    results.forEach(r=>{
      const t=((r.title||'')+' '+(r.snippet||'')).toUpperCase();
      if(t.includes(c[0])||t.includes(c[1].toUpperCase())){
        mentions++;
        const lo=t.toLowerCase();positive+=(lo.match(/\\b(gain|rise|bullish|growth|profit|strong|beat|award|deal|contract|buy)\\b/g)||[]).length;
        negative+=(lo.match(/\\b(fall|drop|bearish|loss|risk|warning|downgrade|debt|weak|sell)\\b/g)||[]).length;
      }
    });
    const evidenceScore=clamp(48+Math.min(24,mentions*8)+(positive-negative)*4+f.evidence*.08);
    const confidence=clamp(50+Math.min(25,mentions*6)+Math.abs(positive-negative)*3+(web?.confidence||0)*.12);
    return {ticker:c[0],name:c[1],evidenceMentions:mentions,positive,negative,evidenceScore:Math.round(evidenceScore),confidence:Math.round(confidence)};
  }).sort((a,b)=>(b.evidenceScore+b.confidence*.35)-(a.evidenceScore+a.confidence*.35));
  const top=scored[0];
  return {ticker:top.ticker,name:top.name,confidence:top.confidence,score:top.evidenceScore,candidates:scored.slice(0,5),method:broad?'Evidence-ranked candidate from today search':'Symbol-resolved analysis',disclaimer:'Candidate selection is evidence-ranked, not a guaranteed best trade or personalized investment advice.'};
}
function runFleet(state,context){
  const s=load(),f=features(state,context?.web||null),results={};
  AGENTS.forEach(name=>{
    const a=ensureAgent(s,name),raw=weighted(a,f),cal=Number(a.calibration||0);
    results[name]={score:Math.round(clamp(raw+cal)),confidence:Math.round(clamp(raw+cal*.7)),features:f};
    a.runs++;a.confidenceSum+=results[name].confidence;a.avgConfidence=Number((a.confidenceSum/a.runs).toFixed(1));
  });
  s.runs++;s.lastRun=new Date().toISOString();
  s.events.unshift({type:'FLEET_LEARNING_RUN',time:s.lastRun,features:f,results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{score:v.score,confidence:v.confidence}]))});
  s.events=s.events.slice(0,100);save(s);
  return results;
}
function learnOutcome(agent,correct,actual,notes){
  const s=load(),names=agent&&agent!=='ALL'?[agent]:AGENTS;
  names.forEach(name=>{
    const a=ensureAgent(s,name);a.outcomes=(a.outcomes||0)+1;if(correct)a.correct++;
    a.accuracy=Number((a.correct/a.outcomes*100).toFixed(1));
    const target=correct?100:0,err=target-(a.avgConfidence||50);
    a.calibration=clamp((a.calibration||0)+err*.06,-15,15);
  });
  s.outcomes.unshift({agent:agent||'ALL',correct:!!correct,actual:String(actual||''),notes:String(notes||''),time:new Date().toISOString()});
  s.outcomes=s.outcomes.slice(0,200);save(s);return snapshot();
}
function snapshot(){
  const s=load(),rows=AGENTS.map(n=>{const a=ensureAgent(s,n);return {agent:n,runs:a.runs,accuracy:a.accuracy,avgConfidence:a.avgConfidence||0,calibration:Number(a.calibration||0)}});save(s);
  const acc=rows.filter(x=>x.accuracy!=null);return {version:VERSION,runs:s.runs,outcomes:s.outcomes.length,agents:rows,averageAccuracy:acc.length?Number((acc.reduce((a,x)=>a+x.accuracy,0)/acc.length).toFixed(1)):null,lastRun:s.lastRun};
}
function learnFromDecision(state,decision){
  const d=decision||{};const risk=Number(d.risk||50),conf=Number(d.confidence||50);
  const signal=conf>=65&&risk<60?'POSITIVE':'DEFENSIVE';
  state.deepLearning=state.deepLearning||{};state.deepLearning.lastSignal=signal;state.deepLearning.lastConfidence=conf;state.deepLearning.lastRun=new Date().toISOString();
  const s=load();s.events.unshift({type:'DECISION_LEARNING_PACKET',time:state.deepLearning.lastRun,signal,confidence:conf,risk,candidate:d.candidate?.ticker||null});s.events=s.events.slice(0,100);save(s);return snapshot();
}
window.FinPilotDeepLearning={version:VERSION,agents:AGENTS,features,resolveCandidate,runFleet,learnOutcome,learnFromDecision,snapshot};
})();