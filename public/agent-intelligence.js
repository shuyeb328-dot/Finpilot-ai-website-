/* FinPilot Agent Intelligence Layer
   Persistent specialist profiles, risk scoring, reasoning ledger and learning.
   Decision support only; no brokerage execution. */
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const profiles={
    CFO:{mission:'Liquidity, cash flow, capital allocation',weight:{liquidity:1.35,risk:1.15},requiredEvidence:['cash flow','runway','capital needs'],sourcePolicy:'Primary financial records first',failureMode:'Liquidity blind spot'},
    Debt:{mission:'Debt cost, payoff order and refinancing risk',weight:{debt:1.4,risk:1.2},requiredEvidence:['APR','balance','term','refinancing'],sourcePolicy:'Loan statements and lender documents',failureMode:'Interest-cost underestimation'},
    Goals:{mission:'Goal probability, funding path and time horizon',weight:{goals:1.35,liquidity:1},requiredEvidence:['target','deadline','contribution rate'],sourcePolicy:'User goals plus cash-flow evidence',failureMode:'Overcommitting capital'},
    Risk:{mission:'Downside, concentration, resilience and failure modes',weight:{risk:1.5,liquidity:1.1},requiredEvidence:['exposure','drawdown','liquidity','stress case'],sourcePolicy:'Independent evidence plus portfolio state',failureMode:'Hidden concentration or tail risk'},
    Investment:{mission:'Valuation, quality, diversification and expected return',weight:{market:1.3,risk:1.25},requiredEvidence:['price','valuation','quality','scenario'],sourcePolicy:'Market data + primary company evidence',failureMode:'Thesis without sufficient evidence'},
    Markets:{mission:'Macro, rates, liquidity and market regime',weight:{market:1.4,risk:1.15},requiredEvidence:['price','trend','macro','volatility'],sourcePolicy:'Fresh market and macro sources',failureMode:'Stale regime assumptions'},
    Tax:{mission:'Tax drag, compliance and governance',weight:{tax:1.45,risk:1.05},requiredEvidence:['jurisdiction','instrument','holding period'],sourcePolicy:'Official tax/regulatory sources only',failureMode:'Wrong tax treatment'},
    Security:{mission:'Fraud, privacy, account and operational security',weight:{security:1.5,risk:1.3},requiredEvidence:['permissions','provider','recent access','anomalies'],sourcePolicy:'Security telemetry and official advisories',failureMode:'Unauthorized access or data leakage'},
    Business:{mission:'Business quality, strategy, deals and execution',weight:{business:1.35,risk:1.1},requiredEvidence:['revenue','cash flow','competitive position','deal terms'],sourcePolicy:'Company filings and primary announcements',failureMode:'Narrative bias'},
    Assets:{mission:'Real estate, tangible assets and balance-sheet durability',weight:{assets:1.3,risk:1.1},requiredEvidence:['fair value','liquidity','maintenance','liability'],sourcePolicy:'Asset records and market comparables',failureMode:'Illiquidity or stale valuation'},
    Research:{mission:'Primary-source evidence, contradiction testing and source diversity',weight:{market:1.25,risk:1.05},requiredEvidence:['primary source','date','independent corroboration'],sourcePolicy:'Primary documents before secondary commentary',failureMode:'Evidence contamination'},
    RedTeam:{mission:'Adversarial challenge, model risk and failure hunting',weight:{risk:1.6},requiredEvidence:['counterexample','contradiction','stress case'],sourcePolicy:'Independent and opposing evidence',failureMode:'Groupthink / confirmation bias'}
  };
  const ensure=(state)=>{
    state.agentReasoning=Array.isArray(state.agentReasoning)?state.agentReasoning:[];
    state.reasoningArchive=Array.isArray(state.reasoningArchive)?state.reasoningArchive:[];
    state.agentScores=state.agentScores&&typeof state.agentScores==='object'?state.agentScores:{};
    state.learning=state.learning&&typeof state.learning==='object'?state.learning:{accuracy:null,confidenceAdjustment:0,agentScores:{},repeatedMistakes:[]};
    state.learning.agentScores=state.learning.agentScores&&typeof state.learning.agentScores==='object'?state.learning.agentScores:{};
    return state;
  };
  function profile(name){
    return profiles[name]||{mission:'Specialist financial analysis',weight:{risk:1.1}};
  }
  function score(state,name,web){
    const p=profile(name), surplus=Number(state.income||0)-Number(state.spending||0);
    const reserve=Number(state.emergency||0)/Math.max(1,Number(state.spending||0));
    const debt=Number(state.liabilities||0)/Math.max(1,Number(state.income||0)*12);
    let risk=28+(reserve<3?28:reserve<6?12:0)+(debt>.5?22:debt>.25?10:0);
    if(web?.stance==='Cautious')risk+=12;
    const evidenceCount=Array.isArray(state.evidence)?state.evidence.length:0;
    const evidenceFreshness=state.lastEvidenceSync&&typeof sourceAge==='function'?(sourceAge(state.lastEvidenceSync)==='Fresh'?100:sourceAge(state.lastEvidenceSync)==='Aging'?70:35):Math.min(100,evidenceCount*8);
    if(evidenceFreshness<40)risk+=10;
    const liquidity=clamp(50+(reserve-3)*8+(surplus>0?12:-20));
    const debtScore=clamp(75-debt*70);
    const market=clamp(55+(web?.stance==='Positive'?15:web?.stance==='Cautious'?-12:0));
    let confidence=clamp(66+(liquidity>60?7:0)+(debtScore>65?5:0)-Math.max(0,risk-55)*.18);try{const dl=window.FinPilotDeepLearning?.snapshot?.();const row=dl?.agents?.find(x=>x.agent===name);if(row?.accuracy!=null)confidence=clamp(confidence+(row.accuracy-60)*.12)}catch{}
    const domain={CFO:liquidity,Debt:debtScore,Goals:clamp(50+surplus/Math.max(1,state.income||1)*80),Risk:100-risk,Investment:market,Markets:market,Tax:70,Security:78,Business:market,Assets:65,Research:clamp(58+evidenceFreshness*.32),RedTeam:clamp(70-risk*.35)}[name]||60;
    const calibration=state.learning?.agentScores?.[name]?.accuracy;
    return {name,mission:p.mission,domainScore:Number(domain.toFixed(1)),risk:Number(clamp(risk).toFixed(1)),confidence:Number(confidence.toFixed(1)),reserveMonths:Number(reserve.toFixed(2)),surplus:Number(surplus.toFixed(0)),evidenceFreshness:Number(evidenceFreshness.toFixed(1)),calibration:calibration==null?null:Number(calibration),requiredEvidence:p.requiredEvidence||[],sourcePolicy:p.sourcePolicy||'Evidence first',failureMode:p.failureMode||'General model risk',timestamp:new Date().toISOString()};
  }
  function enrich(state,name,pipeline,web){
    ensure(state);
    const s=score(state,name,web);
    const p=profile(name);
    const x=pipeline||{};
    return {id:'intel-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),agent:name,mission:p.mission,time:x.time||s.timestamp,
      hypothesis:x.hypothesis||'What evidence would make this specialist change its conclusion?',
      evidence:Array.isArray(x.evidence)?x.evidence:[],analysis:x.analysis||'Structured specialist analysis completed.',
      challenge:x.challenge||'Red-team the thesis: what is the strongest opposing explanation?',
      recommendation:x.recommendation||'Verify primary evidence and keep execution approval-gated.',
      confidence:Number(x.confidence||s.confidence),risk:x.risk|| (s.risk>=70?'HIGH':s.risk>=45?'MEDIUM':'LOW'),
      decision:x.decision||'VERIFY',approvalRequired:true,mission:p.mission,domainScore:s.domainScore,reserveMonths:s.reserveMonths,
      surplus:s.surplus,qualityFlags:[],learningNote:'New run becomes part of the auditable learning ledger.',requiredEvidence:p.requiredEvidence||[],sourcePolicy:p.sourcePolicy||'Evidence first',failureMode:p.failureMode||'General model risk',approvalRule:'High-impact actions remain human-approved.',evidenceFreshness:s.evidenceFreshness,calibration:s.calibration};
  }
  function record(state,reasoning){
    ensure(state); state.agentReasoning.unshift(reasoning);state.agentReasoning=state.agentReasoning.slice(0,250);
    state.reasoningArchive=state.agentReasoning.slice(0,250);
    const old=state.learning.agentScores[reasoning.agent]||{runs:0,confidenceSum:0,lastDecision:null};
    old.runs++;old.confidenceSum+=Number(reasoning.confidence||0);old.lastDecision=reasoning.decision;old.lastRun=reasoning.time;
    old.avgConfidence=Number((old.confidenceSum/old.runs).toFixed(1));
    state.learning.agentScores[reasoning.agent]=old;state.agentScores=state.learning.agentScores;
    return reasoning;
  }
  function outcome(state,agent,correct,notes){
    ensure(state);const s=state.learning.agentScores[agent]||{runs:0,confidenceSum:0};
    s.outcomes=(s.outcomes||0)+1;s.correct=(s.correct||0)+(correct?1:0);s.accuracy=Number((s.correct/s.outcomes*100).toFixed(1));s.lastOutcome=notes||'Outcome recorded';
    state.learning.agentScores[agent]=s;state.learning.accuracy=Object.values(state.learning.agentScores).filter(x=>x.outcomes).reduce((a,x)=>a+x.accuracy,0)/Math.max(1,Object.values(state.learning.agentScores).filter(x=>x.outcomes).length);
    state.memory.unshift({title:agent+' learning outcome',text:(correct?'Correct':'Incorrect')+' · '+(notes||'Outcome recorded'),time:new Date().toLocaleTimeString()});state.memory=state.memory.slice(0,200);return s;
  }
  function fleetMatrix(state,web){
    ensure(state);return Object.keys(profiles).map(n=>score(state,n,web));
  }

  function mountMatrix(){
    const host=document.getElementById('agents'); if(!host||document.getElementById('agentIntelMatrix'))return;
    const rows=fleetMatrix(typeof state!=='undefined'?state:{},typeof liveWebSignal==='function'?liveWebSignal():null);
    const box=document.createElement('div'); box.id='agentIntelMatrix'; box.className='card';
    box.innerHTML='<div class="sectionTitle"><div><h3>Agent Intelligence Matrix</h3><span class="subtle">Live specialist score, risk, confidence and liquidity</span></div><span class="pill low">UPGRADED</span></div><div class="grid cards">'+rows.map(x=>'<div class="card"><b>'+x.name+'</b><div class="muted">'+x.mission+'</div><div class="row"><span>Domain</span><b>'+x.domainScore+'</b></div><div class="row"><span>Risk</span><b>'+x.risk+'</b></div><div class="row"><span>Confidence</span><b>'+x.confidence+'%</b></div><div class="row"><span>Reserve</span><b>'+x.reserveMonths+' mo</b></div></div>').join('')+'</div>';
    host.appendChild(box);
  }
  window.FinPilotAgentIntelligence={profiles,ensure,profile,score,enrich,record,outcome,fleetMatrix,mountMatrix};
})();