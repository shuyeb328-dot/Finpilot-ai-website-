(function(){
function clamp(n,a=0,b=100){return Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));}
function computeExecutiveDecision(state,findings,web,money,sourceAge){
 const fs=Array.isArray(findings)?findings:[];
 const quantum=(window.FinPilotFoundation?.quantumSearchSignal)?window.FinPilotFoundation.quantumSearchSignal(web?.query||'',web):{intent:'research',confidence:60,evidenceCount:Number(web?.count||0),stance:web?.stance||'Mixed',freshness:web?'LIVE':'LOCAL',route:['Quantum Search','Research/Evidence','Specialist Agents','Round Table','CEO','CFO','Judge']};
 const high=fs.filter(f=>f.severity==='HIGH').length;
 const medium=fs.filter(f=>f.severity==='MEDIUM').length;
 const emergency=Number(state.emergency||0);
 const spending=Math.max(1,Number(state.spending||0));
 const income=Number(state.income||0);
 const surplus=income-spending;
 const reserveMonths=emergency/spending;
 const debtRatio=Number(state.liabilities||0)/Math.max(1,income*12);
 const evidence=Array.isArray(state.evidence)?state.evidence:[];
 const live=evidence.filter(e=>e.type==='Live web evidence');
 const freshLive=live.filter(e=>e.freshness==='Fresh').length;
 const webCount=Number(web?.count||live.length||0);
 const webConfidence=Number(web?.confidence||0);
 const stale=!state.lastEvidenceSync||sourceAge(state.lastEvidenceSync)==='Stale';
 const positive=web?.stance==='Positive';
 const cautious=web?.stance==='Cautious';
 const mixed=!positive&&!cautious;

 // Independent specialist scoring: the decision engine consumes the actual agent matrix,
 // rather than displaying fixed 78/87/90/92/86 values.
 let matrix=[];
 try{
   if(window.FinPilotAgentIntelligence?.fleetMatrix) matrix=window.FinPilotAgentIntelligence.fleetMatrix(state,web);
 }catch{}
 const avgConfidence=matrix.length?matrix.reduce((a,x)=>a+Number(x.confidence||0),0)/matrix.length:60;
 const avgDomain=matrix.length?matrix.reduce((a,x)=>a+Number(x.domainScore||0),0)/matrix.length:60;
 const riskAgent=matrix.find(x=>x.name==='Risk');
 const cfoAgent=matrix.find(x=>x.name==='CFO');
 const marketAgents=matrix.filter(x=>['Investment','Markets','Business','Assets'].includes(x.name));
 const marketConfidence=marketAgents.length?marketAgents.reduce((a,x)=>a+Number(x.confidence||0),0)/marketAgents.length:avgConfidence;

 const liquidityScore=clamp(45+(reserveMonths-3)*9+(surplus>0?12:-18));
 const debtScore=clamp(82-debtRatio*75);
 const evidenceScore=clamp(42+Math.min(30,webCount*4)+Math.min(15,freshLive*3)+Math.min(8,webConfidence*.08)+(quantum.confidence-60)*.12);
 const stabilityScore=clamp(100-high*16-medium*5-(reserveMonths<3?18:0)-(debtRatio>.5?14:debtRatio>.25?7:0));
 const marketScore=clamp(50+(positive?18:cautious?-18:0)+(stale?-8:0)+(webCount?Math.min(10,webCount):0)+(quantum.intent==='market'||quantum.intent==='portfolio'?4:0));

 const ceoSignal=clamp((marketScore*.45)+(avgDomain*.2)+(evidenceScore*.2)+(liquidityScore*.15));
 const cfoSignal=clamp((liquidityScore*.42)+(debtScore*.28)+(stabilityScore*.2)+(cfoAgent?.domainScore||0)*.1);
 const judgeSignal=clamp((ceoSignal*.35)+(cfoSignal*.35)+(stabilityScore*.15)+(avgConfidence*.15));

 const ceo=positive
   ? 'Opportunity exists, but the live evidence must be confirmed against fundamentals before increasing exposure.'
   : cautious
   ? 'Protect capital until the negative live signals are verified and the downside case is resolved.'
   : 'No decisive edge is established from the current evidence; preserve capital and demand stronger confirmation.';
 const cfo=reserveMonths<3
   ? 'Liquidity is the binding constraint: '+reserveMonths.toFixed(1)+' months of emergency coverage is below the preferred buffer.'
   : debtRatio>.5
   ? 'Debt pressure is material relative to annual income; improve resilience before adding meaningful risk.'
   : high
   ? 'Resolve the high-severity Financial Brain findings before adding material risk.'
   : 'Cash flow and reserves support measured progress, subject to the current evidence quality.';
 const judge=reserveMonths<3
   ? 'CFO wins: strengthen liquidity before increasing risk'
   : high
   ? 'Risk gate wins: resolve the highest-severity finding before adding new risk'
   : cautious
   ? 'CFO/Risk wins: verify live negative signals before taking market risk'
   : positive && evidenceScore>=65 && marketScore>=60
   ? 'Conditional opportunity: proceed only after fundamental and suitability checks'
   : 'Judge: preserve flexibility and wait for stronger evidence';

 const disagreement=Math.abs(ceoSignal-cfoSignal);
 const decisionConfidence=clamp(
   judgeSignal
   - (stale?10:0)
   - (mixed?3:0)
   - (disagreement>25?7:disagreement>12?3:0)
   + Math.min(5,Math.max(0,webCount-2))
   + Math.min(5,Math.max(0,quantum.confidence-60)*.12)
 );
 const risk=clamp(
   20+high*17+medium*5+
   (reserveMonths<3?25:reserveMonths<6?9:0)+
   (debtRatio>.5?18:debtRatio>.25?8:0)+
   (cautious?12:0)+
   (stale?7:0)
 );

 const voiceBase=[
  ['Bull','Preserve long-term compounding while requiring evidence strong enough to justify added exposure.',clamp(ceoSignal+2)],
  ['Bear',reserveMonths<3?'Liquidity shock is the key threat':cautious?'Negative live evidence increases downside uncertainty':'Unexpected spending and leverage remain the main downside.',clamp(stabilityScore)],
  ['Value','Prioritize durable cash flow, valuation support and downside protection.',clamp((debtScore+avgDomain)/2)],
  ['Quant','Monthly free cash is '+money(surplus)+' with '+reserveMonths.toFixed(1)+' months of reserve coverage; score reflects the current financial state.',clamp(liquidityScore+5)],
  ['Risk',high?high+' high-severity finding(s) require attention':cautious?'Live evidence contains caution signals; verification is required.':'No high-severity constraint detected in the current brain snapshot.',clamp(riskAgent?.confidence||stabilityScore)],
  ['Macro',web?'Live web evidence is '+web.stance.toLowerCase()+' across '+webCount+' item(s); freshness and provider confidence affect this score.':'Live market evidence is not attached to this council.',clamp(marketScore)],
  ['Fundamental',web?'Headlines are evidence, not proof; validate revenue, debt, cash flow and business quality.':'Keep the decision tied to cash generation and goal probability.',clamp(marketConfidence)]
 ];
 const voices=voiceBase.map(v=>({name:v[0],view:v[1],conf:Math.round(v[2])}));
 const webView=web
   ? 'Live web search for “'+web.query+'” is '+web.stance.toLowerCase()+' based on '+webCount+' evidence item(s). '+(positive?'News flow is supportive, but fundamentals still require verification.':cautious?'News flow contains caution signals; verify primary sources before acting.':'News flow is mixed; headlines alone are insufficient for a trade signal.')
   : 'No live web evidence is attached to this council.';
 const evidenceFreshness=stale?'STALE':freshLive>0?'FRESH':'RECENT';
 const summary='Quantum Search routed through '+quantum.intent+' intent with '+quantum.evidenceCount+' evidence item(s). CEO/CFO/Judge synthesized '+fs.length+' Financial Brain findings using '+(matrix.length||'the available')+' specialist scores, '+evidence.length+' evidence records and '+webCount+' live web item(s). '+(high?'High-severity constraints are limiting the decision. ':'')+(stale?'Current evidence needs refreshing before market-sensitive action.':'Evidence freshness is acceptable for decision support.');
 return {
   decision:judge,summary,risk:Math.round(risk),confidence:Math.round(decisionConfidence),
   voices,evidenceFreshness,
   executive:{
     ceo,cfo,judge,
     ceoConfidence:Math.round(clamp(ceoSignal)),
     cfoConfidence:Math.round(clamp(cfoSignal)),
     judgeConfidence:Math.round(clamp(decisionConfidence)),
     inputs:{liquidity:Math.round(liquidityScore),debt:Math.round(debtScore),stability:Math.round(stabilityScore),evidence:Math.round(evidenceScore),market:Math.round(marketScore),specialistAverage:Math.round(avgConfidence),disagreement:Math.round(disagreement)}
   },
   webSignal:web,
   quantumSignal:quantum,
   telemetry:{highFindings:high,mediumFindings:medium,reserveMonths:Number(reserveMonths.toFixed(2)),debtRatio:Number(debtRatio.toFixed(3)),evidenceCount:evidence.length,liveEvidenceCount:webCount,freshLiveEvidence:freshLive,specialistCount:matrix.length,stale}
 };
}
window.FinPilotDecisionCore={computeExecutiveDecision};
})();