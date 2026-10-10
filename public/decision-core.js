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

 // Market-sensitive decisions must be backed by a fresh, matching provider-timestamped quote.
 // Search sentiment is not a substitute for verified price evidence.
 const queryText=String(web?.query||state?.query||state?.ticker||'').trim();
 const symbolToken=(queryText.toUpperCase().match(/\b[A-Z][A-Z0-9.^-]{1,11}\b/g)||[])
   .find(token=>!new Set(['ANALYZE','ANALYSIS','SHARE','PRICE','TODAY','STOCK','STOCKS','MARKET','OPTIONS','OPTION','FUTURES','FUTURE','BUY','SELL','TRADE','TRADING','REPORT','CHART','NOW','BEST','FOR','THE','WITH','GLOBAL','INDIA','NSE','NASDAQ','USA','US','ABOUT','OUTLOOK','PREDICT','FORECAST','TARGET','RISK','RETURN','PROBABILITY','PROBABILITIES','NEXT','WEEK','MONTH','SHORT','LONG','TERM','HORIZON','GIVE','ME','CAN','YOU','PLEASE','WHAT','WHETHER','SHOULD','IN','OF','ON','UNDER','OVER','LOW','TOP','EXPLORE','COMPANY','LATEST','NEWS','LIVE','QUOTE','CHECK','LOOK','UP','FIND','COMPARE','FROM','TODAY','TICKER']).has(token))||'';
 const requestedSymbol=String(state?.marketSymbol||state?.ticker||state?.searchTicker||web?.ticker||symbolToken||'').trim().toUpperCase();
 const marketSensitive=Boolean(requestedSymbol)||['market','portfolio','equity','crypto','options','futures','trading'].includes(String(quantum.intent||'').toLowerCase());

 const snapshots=[state?.marketSnapshot,state?.latestMarketSnapshot,window.__fpMarketSnapshot].filter(x=>x&&typeof x==='object');
 const snapshot=snapshots[0]||null;
 const quoteObjects=snapshot?[snapshot,snapshot.report,snapshot.instrument,snapshot.quote,snapshot.marketDataOS,snapshot.snapshot,snapshot.snapshot?.instrument,snapshot.snapshot?.quote].filter(x=>x&&typeof x==='object'):[];
 const firstValue=(keys)=>{for(const row of quoteObjects){for(const key of keys){if(row[key]!==undefined&&row[key]!==null&&row[key]!=='')return row[key];}}return undefined;};
 const normalizeSymbol=value=>String(value||'').trim().toUpperCase().replace(/\.(?:NS|BO)$/,'').replace(/\s+/g,'');
 const equivalentSymbols={
  BITCOIN:['BTC'],ETHEREUM:['ETH'],ETHER:['ETH'],SOLANA:['SOL'],RIPPLE:['XRP'],
  NIFTY:['^NSEI','NIFTY50'],NIFTY50:['^NSEI','NIFTY'],SENSEX:['^BSESN'],BANKNIFTY:['^NSEBANK']
 };
 const quoteSymbol=String(firstValue(['ticker','symbol','requestedTicker'])||snapshot?.requested?.ticker||snapshot?.instrument?.ticker||'').toUpperCase();
 const symbolMatches=Boolean(quoteSymbol&&(!requestedSymbol||
   normalizeSymbol(quoteSymbol)===normalizeSymbol(requestedSymbol)||
   (equivalentSymbols[normalizeSymbol(requestedSymbol)]||[]).includes(normalizeSymbol(quoteSymbol))||
   (equivalentSymbols[normalizeSymbol(quoteSymbol)]||[]).includes(normalizeSymbol(requestedSymbol))));
 const price=Number(firstValue(['price','lastPrice','last','close']));
 const quoteAsOf=firstValue(['asOf','sourceAsOf','providerTimestamp','timestamp']);
 const timestampType=String(firstValue(['sourceTimestampType','timestampType'])||'UNKNOWN_TIMESTAMP').toUpperCase();
 const ageMs=Number.isFinite(Date.parse(String(quoteAsOf||'')))?Date.now()-Date.parse(String(quoteAsOf)):null;
 const topEligibility=snapshot?.executionEligible;
 const qualityEligibility=firstValue(['forecastEligible']);
 const marketOsDecision=snapshot?.marketDataOS?.decision||snapshot?.marketDataOS?.status;
 const eligible=topEligibility===true||qualityEligibility===true||marketOsDecision==='ALLOW_ANALYSIS_AND_PAPER';

 const quoteValid=Boolean(snapshot&&symbolMatches&&Number.isFinite(price)&&price>0&&timestampType==='PROVIDER_TIMESTAMP'&&Number.isFinite(ageMs)&&ageMs>=-30000&&ageMs<=90000&&eligible);

 const domains=new Set();
 const addDomain=url=>{const m=String(url||'').trim().match(/^https?:\/\/([^/?#:]+)/i);if(m)domains.add(m[1].toLowerCase().replace(/^www\./,''));};
 for(const url of (Array.isArray(web?.urls)?web.urls:[]))addDomain(url);
 for(const row of live)addDomain(row?.url);
 const independentSourceCount=domains.size;
 const quoteBlock= !marketSensitive?'NOT_REQUIRED':!snapshot?'NO_VERIFIED_QUOTE':!quoteSymbol?'SYMBOL_UNKNOWN':!symbolMatches?'SYMBOL_MISMATCH':timestampType!=='PROVIDER_TIMESTAMP'?'PROVIDER_TIMESTAMP_REQUIRED':!Number.isFinite(ageMs)||ageMs < -30000||ageMs>90000?'QUOTE_STALE_OR_TIMESTAMP_INVALID':!eligible?'QUOTE_NOT_EXECUTION_ELIGIBLE':'PASS';
 const quotePassed=!marketSensitive||quoteBlock==='PASS';
 const sourceBlock=!marketSensitive||independentSourceCount>=2?'PASS':'INSUFFICIENT_INDEPENDENT_SOURCES';
 const sourcePassed=sourceBlock==='PASS';
 const marketGateBlocked=marketSensitive&&(!quotePassed||!sourcePassed);
 const marketEvidence={
  required:marketSensitive,quoteStatus:quotePassed?(marketSensitive?'VERIFIED_MATCHING_FRESH':'NOT_REQUIRED'):quoteBlock,
  ticker:quoteSymbol||null,requestedTicker:requestedSymbol||null,provider:firstValue(['provider','exchange'])||null,
  asOf:quoteAsOf||null,ageMs:Number.isFinite(ageMs)?Math.round(ageMs):null,
  sourceTimestampType:timestampType,price:Number.isFinite(price)&&price>0?price:null,
  independentSourceCount,sourceDomains:[...domains].slice(0,8),blockingReason:marketGateBlocked?( !quotePassed?quoteBlock:sourceBlock):null
 };
 const decisionGates=[
  {id:'market_quote',label:'Market quote provenance',status:!marketSensitive?'NOT_REQUIRED':quotePassed?'PASS':'BLOCKED',severity:marketSensitive&&!quotePassed?'CRITICAL':'INFO',blocking:marketSensitive&&!quotePassed,message:!marketSensitive?'No market-specific decision was requested.':quotePassed?'Matching instrument has a fresh provider timestamp and passes the paper-eligibility data gate.':'Market-sensitive decision withheld: '+quoteBlock+'.'},
  {id:'source_diversity',label:'Independent source diversity',status:!marketSensitive?'NOT_REQUIRED':sourcePassed?'PASS':'BLOCKED',severity:marketSensitive&&!sourcePassed?'HIGH':'INFO',blocking:marketSensitive&&!sourcePassed,message:!marketSensitive?'Independent market sources are not required for this non-market task.':sourcePassed?'Evidence covers '+independentSourceCount+' independent source domains.':'Only '+independentSourceCount+' independent source domain(s) were found; at least two are required.'},
  {id:'liquidity',label:'Liquidity buffer',status:reserveMonths<3?'BLOCKED':reserveMonths<6?'REVIEW':'PASS',severity:reserveMonths<3?'HIGH':reserveMonths<6?'MEDIUM':'LOW',blocking:reserveMonths<3,message:reserveMonths<3?'Emergency coverage is '+reserveMonths.toFixed(1)+' months, below the three-month safety threshold.':reserveMonths<6?'Emergency coverage is below six months; consider liquidity before increasing risk.':'Emergency coverage passes the three-month minimum.'},
  {id:'high_severity_findings',label:'High-severity findings',status:high?'BLOCKED':'PASS',severity:high?'HIGH':'LOW',blocking:high>0,message:high?high+' high-severity finding(s) require resolution before adding risk.':'No high-severity Financial Brain findings are currently recorded.'},
  {id:'evidence_recency',label:'Financial Brain recency',status:stale?'REVIEW':'PASS',severity:stale?'MEDIUM':'LOW',blocking:false,message:stale?'The latest local Financial Brain refresh is stale or missing; refresh before relying on the summary.':'The local Financial Brain was refreshed recently; this does not by itself verify market data.'}
 ];

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

 const ceo=marketSensitive&&!quotePassed
   ? 'Market recommendation withheld because a fresh, matching provider-timestamped quote has not passed verification.'
   : marketSensitive&&!sourcePassed
   ? 'Market recommendation withheld until at least two independent evidence source domains corroborate the thesis.'
   : positive
   ? 'Opportunity exists, but evidence must still be confirmed against fundamentals and suitability before increasing exposure.'
   : cautious
   ? 'Protect capital until the negative signals are verified and the downside case is resolved.'
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
   : marketGateBlocked
   ? 'WAIT — verified market quote and independent-source checks are required'
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
 const unadjustedRisk=clamp(
   20+high*17+medium*5+
   (reserveMonths<3?25:reserveMonths<6?9:0)+
   (debtRatio>.5?18:debtRatio>.25?8:0)+
   (cautious?12:0)+
   (stale?7:0)+
   (marketGateBlocked?15:0)
 );
 const decisionConfidenceGated=marketSensitive&&!quotePassed?Math.min(40,decisionConfidence):marketGateBlocked?Math.min(50,decisionConfidence):decisionConfidence;
 const decisionConfidenceFinal=Math.round(clamp(decisionConfidenceGated));
 const risk=unadjustedRisk;

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
 const summary='Quantum Search routed through '+quantum.intent+' intent with '+quantum.evidenceCount+' evidence item(s). CEO/CFO/Judge synthesized '+fs.length+' Financial Brain findings using '+(matrix.length||'the available')+' specialist scores, '+evidence.length+' evidence records and '+webCount+' live web item(s). '+(high?'High-severity constraints are limiting the decision. ':'')+(marketGateBlocked?'Market-sensitive decision is blocked by quote provenance or independent-source requirements. '):(stale?'Current evidence needs refreshing before market-sensitive action.':'Evidence freshness is acceptable for decision support.');
 return {
   decision:judge,summary,risk:Math.round(risk),confidence:decisionConfidenceFinal,
   voices,evidenceFreshness,decisionGates,marketEvidence,
   executive:{
     ceo,cfo,judge,
     ceoConfidence:Math.round(clamp(ceoSignal)),
     cfoConfidence:Math.round(clamp(cfoSignal)),
     judgeConfidence:decisionConfidenceFinal,
     inputs:{liquidity:Math.round(liquidityScore),debt:Math.round(debtScore),stability:Math.round(stabilityScore),evidence:Math.round(evidenceScore),market:Math.round(marketScore),specialistAverage:Math.round(avgConfidence),disagreement:Math.round(disagreement),marketSensitive,quoteVerified:quotePassed,independentSourceCount}
   },
   webSignal:web,
   quantumSignal:quantum,
   telemetry:{highFindings:high,mediumFindings:medium,reserveMonths:Number(reserveMonths.toFixed(2)),debtRatio:Number(debtRatio.toFixed(3)),evidenceCount:evidence.length,liveEvidenceCount:webCount,freshLiveEvidence:freshLive,specialistCount:matrix.length,stale}
 };
}
window.FinPilotDecisionCore={computeExecutiveDecision};
})();