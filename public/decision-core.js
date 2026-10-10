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
 const normalizeSymbol=value=>String(value||'').trim().toUpperCase()
  .replace(/\.(?:NS|BO)$/,'').replace(/\s+/g,'')
  .replace(/[-/](?:USDT|USDC|USD|INR|EUR)$/,'');
 const ignoredTokens=new Set([
  'A','AN','AND','OR','TO','DO','IS','IT','ME','MY','YOU','CAN','HOW','WHY','WHEN','WHAT','WHICH','WITH','FROM','FOR','OF','ON','IN','THE','THIS','THAT','PLEASE','KINDLY','SHOW','TELL','HELP','LOOK','FIND','SEARCH','COMPARE','VERSUS','VS','ABOUT','OUTLOOK','LATEST','NEWS','PRICE','QUOTE','TODAY','CURRENT','LIVE','NOW','STOCK','STOCKS','MARKET','SHARE','OPTIONS','OPTION','FUTURES','FUTURE','BUY','SELL','TRADE','TRADING','INTRADAY','SWING','REPORT','CHART','TARGET','RISK','RETURN','PROBABILITY','PROBABILITIES','FORECAST','PREDICT','ANALYSE','ANALYZED','ANALYZING','ANALYZE','ANALYSIS','RECOMMEND','RECOMMENDATION','RECOMMENDATIONS','SUGGEST','SUGGESTION','SUGGESTIONS','SIGNAL','SIGNALS','INVEST','INVESTING','INVESTOR','INVESTMENT','INVESTMENTS','PORTFOLIO','ASSET','ASSETS','GLOBAL','INDIA','NSE','BSE','NASDAQ','NYSE','USA','US','USD','INR','USDT','EUR','BANK','COMPANY','BEST','TOP','NEXT','WEEK','MONTH','SHORT','LONG','TERM','HORIZON','GIVE','UNDER','OVER','LOW','EXPLORE','TICKER','NIFTY','SENSEX'
 ]);
 const explicitTickerTokens=[...new Set((queryText.match(/\b[A-Z][A-Z0-9.^-]{1,11}\b/g)||[])
  .map(normalizeSymbol).filter(token=>!ignoredTokens.has(token)))];
 const aliases=[
  [/\bTESLA\b/i,'TSLA'],[/\bAPPLE\b/i,'AAPL'],[/\bMICROSOFT\b/i,'MSFT'],
  [/\bNVIDIA\b/i,'NVDA'],[/\bAMAZON\b/i,'AMZN'],[/\b(?:GOOGLE|ALPHABET)\b/i,'GOOGL'],
  [/\bMETA(?:\s+PLATFORMS)?\b/i,'META'],[/\bINFOSYS\b/i,'INFY'],
  [/\bTATA\s+MOTORS\b/i,'TATAMOTORS'],[/\bTATA\s+STEEL\b/i,'TATASTEEL'],
  [/\bRELIANCE(?:\s+INDUSTRIES)?\b/i,'RELIANCE'],[/\bIRFC\b/i,'IRFC'],[/\bSBC\s+EXPORTS?\b/i,'SBC'],
  [/\bHDFC\s+BANK\b/i,'HDFCBANK'],[/\bICICI\s+BANK\b/i,'ICICIBANK'],
  [/\b(?:STATE\s+BANK\s+OF\s+INDIA|SBI)\b/i,'SBIN'],
  [/\bBANK\s+NIFTY\b/i,'BANKNIFTY'],[/\bNIFTY(?:\s+50)?\b/i,'NIFTY'],[/\bSENSEX\b/i,'SENSEX'],
  [/\bBITCOIN\b/i,'BTC'],[/\bETHEREUM\b/i,'ETH'],[/\bETHER\b/i,'ETH'],[/\bSOLANA\b/i,'SOL'],[/\bRIPPLE\b/i,'XRP']
 ];
 const aliasSymbols=[...new Set(aliases.filter(([pattern])=>pattern.test(queryText)).map(([,ticker])=>ticker))];
 const querySymbols=[...new Set([...explicitTickerTokens,...aliasSymbols])];
 const symbolToken=aliasSymbols[0]||explicitTickerTokens[0]||'';
 const requestedRaw=String(state?.marketSymbol||state?.ticker||state?.searchTicker||web?.ticker||symbolToken||'').trim().toUpperCase();
 const canonicalTickerAlias={SBI:'SBIN',STATE:'SBIN',HDFC:'HDFCBANK',ICICI:'ICICIBANK',INFOSYS:'INFY',TESLA:'TSLA',APPLE:'AAPL',MICROSOFT:'MSFT',NVIDIA:'NVDA',AMAZON:'AMZN',GOOGLE:'GOOGL',ALPHABET:'GOOGL',BITCOIN:'BTC',ETHEREUM:'ETH',SOLANA:'SOL',RIPPLE:'XRP'};
 const requestedSymbol=canonicalTickerAlias[requestedRaw]||requestedRaw;
 const isComparisonQuery=/\b(compare|comparison|versus|vs|between|against|relative\s+to|and)\b/i.test(queryText);
 const multiInstrumentRequest=isComparisonQuery&&querySymbols.length>1;
 const marketSensitive=Boolean(requestedSymbol)||['market','portfolio','equity','crypto','options','futures','trading'].includes(String(quantum.intent||'').toLowerCase());

 const snapshots=[state?.marketSnapshot,state?.latestMarketSnapshot,window.__fpMarketSnapshot].filter(x=>x&&typeof x==='object');
 const snapshot=snapshots[0]||null;
 const quoteObjects=snapshot?[snapshot,snapshot.report,snapshot.instrument,snapshot.quote,snapshot.timing,snapshot.provenance,snapshot.quality,snapshot.marketDataOS,snapshot.snapshot,snapshot.snapshot?.instrument,snapshot.snapshot?.quote,snapshot.snapshot?.timing,snapshot.snapshot?.provenance,snapshot.snapshot?.quality].filter(x=>x&&typeof x==='object'):[];
 const firstValue=(keys)=>{for(const row of quoteObjects){for(const key of keys){if(row[key]!==undefined&&row[key]!==null&&row[key]!=='')return row[key];}}return undefined;};

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
 const timestampType=String(firstValue(['sourceTimestampType','timestampType'])||(snapshot?.quality?.status==='VERIFIED_LIVE'&&snapshot?.timing?.sourceAsOf?'PROVIDER_TIMESTAMP':'UNKNOWN_TIMESTAMP')).toUpperCase();
 const ageMs=Number.isFinite(Date.parse(String(quoteAsOf||'')))?Date.now()-Date.parse(String(quoteAsOf)):null;
 const topEligibility=snapshot?.executionEligible;
 const qualityEligibility=firstValue(['forecastEligible']);
 const marketOsDecision=snapshot?.marketDataOS?.decision||snapshot?.marketDataOS?.status;
 const explicitEligibilityBlock=topEligibility===false||qualityEligibility===false;
 const eligible=!explicitEligibilityBlock&&(topEligibility===true||qualityEligibility===true||marketOsDecision==='ALLOW_ANALYSIS_AND_PAPER');

 const quoteValid=Boolean(snapshot&&symbolMatches&&Number.isFinite(price)&&price>0&&timestampType==='PROVIDER_TIMESTAMP'&&Number.isFinite(ageMs)&&ageMs>=-30000&&ageMs<=90000&&eligible);

 const domains=new Set();
 const addDomain=url=>{const m=String(url||'').trim().match(/^https?:\/\/([^/?#:]+)/i);if(m)domains.add(m[1].toLowerCase().replace(/^www\./,''));};
 for(const url of (Array.isArray(web?.urls)?web.urls:[]))addDomain(url);
 for(const row of live)addDomain(row?.url);
 const independentSourceCount=domains.size;
 const quoteBlock= !marketSensitive?'NOT_REQUIRED':multiInstrumentRequest?'MULTIPLE_INSTRUMENTS_REQUIRE_COMPARATIVE_EVIDENCE':!requestedSymbol?'REQUESTED_SYMBOL_UNRESOLVED':!snapshot?'NO_VERIFIED_QUOTE':!quoteSymbol?'SYMBOL_UNKNOWN':!symbolMatches?'SYMBOL_MISMATCH':timestampType!=='PROVIDER_TIMESTAMP'?'PROVIDER_TIMESTAMP_REQUIRED':!Number.isFinite(ageMs)||ageMs < -30000||ageMs>90000?'QUOTE_STALE_OR_TIMESTAMP_INVALID':!eligible?'QUOTE_NOT_EXECUTION_ELIGIBLE':'PASS';
 const quotePassed=!marketSensitive||quoteBlock==='PASS';
 const sourceBlock=!marketSensitive||independentSourceCount>=2?'PASS':'INSUFFICIENT_INDEPENDENT_SOURCES';
 const sourcePassed=sourceBlock==='PASS';
 const marketGateBlocked=marketSensitive&&(!quotePassed||!sourcePassed||multiInstrumentRequest);
 const marketEvidence={
  required:marketSensitive,quoteStatus:quotePassed?(marketSensitive?'VERIFIED_MATCHING_FRESH':'NOT_REQUIRED'):quoteBlock,
  ticker:quoteSymbol||null,requestedTicker:requestedSymbol||null,provider:firstValue(['provider'])||snapshot?.provenance?.provider||firstValue(['exchange'])||null,
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
 const decisionConfidenceGated=marketSensitive&&!quotePassed?Math.min(40,decisionConfidence):marketGateBlocked?Math.min(50,decisionConfidence):(reserveMonths<3||high>0)?Math.min(55,decisionConfidence):decisionConfidence;
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

 // Auditable, deterministic debate trace. These are rule-based role assessments,
 // not independent foundation-model reasoning or private chain-of-thought.
 const blockingGates=decisionGates.filter(g=>g.blocking===true);
 const reviewGates=decisionGates.filter(g=>g.status==='REVIEW');
 const evidenceReferences=[...new Set([
  ...(Array.isArray(web?.urls)?web.urls:[]),
  ...live.map(item=>item?.url)
 ].filter(url=>typeof url==='string'&&(url.startsWith('https://')||url.startsWith('http://'))))].slice(0,8);
 const reserveLabel=Number.isFinite(reserveMonths)?reserveMonths.toFixed(1)+' months':'not measured';
 const gateLabels=blockingGates.map(g=>g.label);
 const gateList=gateLabels.length?gateLabels.join('; '):'No hard safety gate is blocking the current decision.';
 const validMarketBasis=marketSensitive&&quotePassed&&sourcePassed;
 const hardVeto=blockingGates.length>0||marketGateBlocked;
 const debatePositions=[
  {
   role:'Data Auditor',round:1,stance:!marketSensitive?'NO MARKET QUOTE REQUIRED':validMarketBasis?'DATA GATE PASSED':'VETO — INSUFFICIENT VERIFIED MARKET EVIDENCE',
   confidence:95,
   evidence:[
    'Market-specific task: '+(marketSensitive?'yes':'no'),
    'Quote status: '+marketEvidence.quoteStatus,
    'Timestamp type: '+marketEvidence.sourceTimestampType,
    'Independent source domains: '+independentSourceCount+' (minimum 2 for market-sensitive decisions)'
   ],
   challenge:'Could a stale price, a local observation timestamp, a wrong ticker or a single-source result be mistaken for verified market evidence?',
   response:validMarketBasis?'The selected quote passes ticker, timestamp, freshness and eligibility checks; source diversity also passes.':marketSensitive?'The missing or failed data requirement is explicit. A headline or local observation time cannot override it.':'A market quote is not required for this non-market decision.',
   decisionEffect:!marketSensitive?'NOT_REQUIRED':validMarketBasis?'PASS':'VETO'
  },
  {
   role:'Bull Case',round:1,stance:marketGateBlocked?'ABSTAIN — MARKET DATA GATE FAILED':positive&&evidenceScore>=65?'CONDITIONAL UPSIDE CASE':'NO CLEAR UPSIDE EDGE',
   confidence:Math.round(clamp(ceoSignal)),
   evidence:[
    'Web signal: '+(web?.stance||'unavailable'),
    'Evidence count: '+webCount,
    'Evidence score: '+Math.round(evidenceScore)+'/100',
    web?.query?'Query: '+String(web.query).slice(0,180):'No live search query attached'
   ],
   challenge:'What primary-source fact, valuation assumption or fresh price confirmation would invalidate the upside thesis?',
   response:marketGateBlocked?'No directional market thesis is advanced until the data gate passes.':positive?'Positive search sentiment is only a lead; fundamentals, valuation and suitability remain unverified.':'The available evidence does not establish a decisive upside edge.',
   decisionEffect:marketGateBlocked?'ABSTAIN':positive&&evidenceScore>=65?'CONDITIONAL':'REVIEW'
  },
  {
   role:'Bear Case',round:1,stance:cautious||high>0||risk>=60?'DOWNSIDE RISK IDENTIFIED':'COUNTERCASE REQUIRED',
   confidence:Math.round(clamp(stabilityScore)),
   evidence:[
    'Risk score: '+Math.round(risk)+'/100',
    'High-severity findings: '+high,
    'Medium-severity findings: '+medium,
    'Emergency reserve coverage: '+reserveLabel
   ],
   challenge:'Could liquidity pressure, leverage, volatility or a contradictory source overwhelm the positive narrative?',
   response:high>0?'High-severity findings remain unresolved and limit risk-taking.':reserveMonths<3?'Liquidity coverage is below the minimum three-month threshold.':cautious?'The cautious signal needs primary-source verification before it is treated as a market conclusion.':'A downside case must still be considered; this assessment does not prove the thesis is safe.',
   decisionEffect:high>0||reserveMonths<3?'VETO':risk>=60||cautious?'REVIEW':'COUNTERCASE'
  },
  {
   role:'Quant',round:1,stance:marketSensitive&&!quotePassed?'ABSTAIN — NO ELIGIBLE QUOTE':marketSensitive?'CONDITIONAL QUANT REVIEW':'STRUCTURED CALCULATIONS ONLY',
   confidence:Math.round(clamp(liquidityScore)),
   evidence:[
    'Liquidity score: '+Math.round(liquidityScore)+'/100',
    'Market score: '+Math.round(marketScore)+'/100',
    'Debt ratio: '+Number(debtRatio.toFixed(3)),
    'Quote price: '+(marketEvidence.price==null?'not eligible':String(marketEvidence.price))
   ],
   challenge:'Are the input instrument, quote timestamp, units and measurement horizon aligned with the requested calculation?',
   response:marketSensitive&&!quotePassed?'Quantitative market conclusions are withheld because the quote has not passed verification.':'These deterministic indicators summarize supplied inputs; they are not calibrated probabilities of profit.',
   decisionEffect:marketSensitive&&!quotePassed?'ABSTAIN':marketSensitive?'CONDITIONAL':'REVIEW'
  },
  {
   role:'Risk Guardian',round:1,stance:blockingGates.length?'HARD VETO':reviewGates.length?'REVIEW REQUIRED':'PASS WITH MONITORING',
   confidence:95,
   evidence:blockingGates.length?blockingGates.map(g=>g.label+': '+g.message):reviewGates.map(g=>g.label+': '+g.message).concat(['Risk score: '+Math.round(risk)+'/100']),
   challenge:'Can any mandatory data, liquidity or high-severity risk control be bypassed by an optimistic aggregate score?',
   response:blockingGates.length?'No. The following blocker(s) remain active: '+gateList+'. The CEO/Judge must respect the veto.':reviewGates.length?'No hard veto is active, but review items remain visible before capital allocation.':'No hard veto was triggered by the present rule set; human review remains required for high-impact actions.',
   decisionEffect:blockingGates.length?'VETO':reviewGates.length?'REVIEW':'PASS'
  },
  {
   role:'Red Team',round:1,stance:hardVeto?'FAIL-FAST — COUNTEREVIDENCE BLOCKS ACTION':'ADVERSARIAL CHALLENGE RECORDED',
   confidence:Math.round(clamp(risk)),
   evidence:[
    'Blocked/review gates: '+(blockingGates.length+reviewGates.length),
    'Evidence references: '+evidence.length,
    'Independent web domains: '+independentSourceCount,
    'Evidence stale: '+(stale?'yes':'no')
   ],
   challenge:'What is the strongest reason not to act, and which assumption would make the current conclusion wrong?',
   response:hardVeto?'The decision is not allowed to outrank its failed gate. Resolve '+gateList+'.':'The countercase is recorded; missing evidence should lower conviction instead of being filled with invented data.',
   decisionEffect:hardVeto?'VETO':'CHALLENGE'
  },
  {
   role:'CFO',round:1,stance:reserveMonths<3||high>0?'REJECT ADDITIONAL CAPITAL RISK':hardVeto?'NO ALLOCATION UNTIL GATES PASS':'CONDITIONAL FINANCIAL REVIEW',
   confidence:Math.round(clamp(cfoSignal)),
   evidence:[
    'Emergency coverage: '+reserveLabel,
    'Monthly surplus: '+money(surplus),
    'Debt / annual income ratio: '+Number(debtRatio.toFixed(3)),
    'High-severity findings: '+high
   ],
   challenge:'Would the proposed exposure weaken essential liquidity, raise debt pressure or ignore unresolved severe findings?',
   response:reserveMonths<3?'Capital risk is rejected until emergency coverage reaches the required threshold.':high>0?'Resolve severe findings before adding meaningful risk.':hardVeto?'No capital allocation is supported while data or source-diversity gates are blocked.':'Any opportunity remains conditional on suitability, evidence quality and explicit user approval.',
   decisionEffect:reserveMonths<3||high>0?'VETO':hardVeto?'BLOCKED':'CONDITIONAL'
  },
  {
   role:'CEO / Judge',round:1,stance:judge,
   confidence:decisionConfidenceFinal,
   evidence:[
    'Market gate: '+marketEvidence.quoteStatus,
    'Blocking gates: '+blockingGates.length,
    'Risk score: '+Math.round(risk)+'/100',
    'Decision confidence: '+decisionConfidenceFinal+'% (deterministic score, not calibrated probability)'
   ],
   challenge:'Does the final decision obey every mandatory veto and accurately describe what remains uncertain?',
   response:hardVeto?'Hard veto preserved. Final resolution remains WAIT / BLOCK pending verification or risk remediation.':reviewGates.length?'No hard veto; the decision remains conditional and review items stay visible.':'No hard veto detected by the deterministic gates; this is still decision support, not trade authorization.',
   decisionEffect:hardVeto?'VETO PRESERVED':reviewGates.length?'CONDITIONAL REVIEW':'HUMAN REVIEW'
  }
 ];
 const debate={
  version:'ROUND-TABLE-DEBATE-1.0.0',
  mode:'DETERMINISTIC_EVIDENCE_RULES',
  disclaimer:'Role assessments are deterministic rules based on the supplied data and evidence. External foundation-model reasoning is not configured; this is not independent LLM debate.',
  rounds:[
   {number:1,label:'Initial positions',summary:'Each role records an assessment using the same evidence snapshot.',entries:debatePositions.map(p=>({role:p.role,stance:p.stance,confidence:p.confidence,evidence:p.evidence}))},
   {number:2,label:'Cross-examination',summary:'Every role records a counter-question and its evidence-based response.',entries:debatePositions.map(p=>({role:p.role,challenge:p.challenge,response:p.response,decisionEffect:p.decisionEffect}))},
   {number:3,label:'Veto and reconciliation',summary:'The final decision preserves hard gates; no majority can override a blocking safeguard.',entries:[
    {role:'Risk Guardian',hardVetoes:blockingGates.map(g=>({id:g.id,label:g.label,message:g.message})),result:blockingGates.length?'BLOCKED':'NO HARD VETO'},
    {role:'CEO / Judge',result:judge,blockingGateCount:blockingGates.length,reviewGateCount:reviewGates.length,decisionConfidence:decisionConfidenceFinal}
   ]}
  ],
  initialPositions:debatePositions,
  hardVetoes:blockingGates.map(g=>({id:g.id,label:g.label,severity:g.severity,message:g.message})),
  reviewItems:reviewGates.map(g=>({id:g.id,label:g.label,message:g.message})),
  assessmentTally:{
   veto:debatePositions.filter(p=>['VETO','BLOCKED','VETO PRESERVED'].includes(p.decisionEffect)).length,
   abstain:debatePositions.filter(p=>p.decisionEffect==='ABSTAIN').length,
   conditional:debatePositions.filter(p=>['CONDITIONAL','CONDITIONAL REVIEW','HUMAN REVIEW','REVIEW'].includes(p.decisionEffect)).length,
   pass:debatePositions.filter(p=>p.decisionEffect==='PASS').length,
   note:'This is a count of rule-based role assessments, not a democratic majority vote. Any hard safety gate takes precedence.'
  },
  evidenceReferences,
  finalResolution:{
   decision:judge,
   blockingGateCount:blockingGates.length,
   reviewGateCount:reviewGates.length,
   marketQuoteStatus:marketEvidence.quoteStatus,
   capitalAllocationStatus:hardVeto?'BLOCKED':'CONDITIONAL_HUMAN_REVIEW',
   humanApprovalRequired:true,
   automaticExecution:false
  }
 };

 const webView=web
   ? 'Live web search for “'+web.query+'” is '+web.stance.toLowerCase()+' based on '+webCount+' evidence item(s). '+(positive?'News flow is supportive, but fundamentals still require verification.':cautious?'News flow contains caution signals; verify primary sources before acting.':'News flow is mixed; headlines alone are insufficient for a trade signal.')
   : 'No live web evidence is attached to this council.';
 const evidenceFreshness=stale?'STALE':freshLive>0?'FRESH':'RECENT';
 const summary='Quantum Search routed through '+quantum.intent+' intent with '+quantum.evidenceCount+' evidence item(s). CEO/CFO/Judge synthesized '+fs.length+' Financial Brain findings using '+(matrix.length||'the available')+' specialist scores, '+evidence.length+' evidence records and '+webCount+' live web item(s). '+(high?'High-severity constraints are limiting the decision. ':'')+(marketGateBlocked?'Market-sensitive decision is blocked by quote provenance or independent-source requirements. ':stale?'Current evidence needs refreshing before market-sensitive action.':'Evidence freshness is acceptable for decision support.');
 return {
   decision:judge,summary,risk:Math.round(risk),confidence:decisionConfidenceFinal,
   voices,evidenceFreshness,decisionGates,marketEvidence,debate,
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