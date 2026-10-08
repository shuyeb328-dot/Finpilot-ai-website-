/* FinPilot Money Scenario Engine v3
   Deterministic ₹1,000 scenario planner with explicit risk budget, stop/target,
   expected value, stress cases and data-quality gates.
   Advisory only. It never places or simulates a real brokerage order.
*/
(function(){
  'use strict';
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
  const round=n=>Math.round(Number(n)*100)/100;
  const pct=(n,a=0,b=100)=>round(clamp(n,a,b));
  const FEATURES=['input_validation','amount_guard','horizon_guard','evidence_gate','freshness_gate','source_diversity','sentiment_balance','market_regime','ceo_signal','cfo_signal','judge_signal','agent_consensus','agent_disagreement','risk_score','liquidity_guard','reserve_guard','cashflow_guard','debt_guard','goal_guard','portfolio_guard','concentration_guard','correlation_guard','volatility_band','downside_band','upside_band','risk_reward_gate','expected_value','position_size_cap','loss_budget','slippage_reserve','fee_reserve','tax_reserve','stress_7d','stress_30d','stress_90d','break_even','target_logic','stop_logic','trailing_stop_logic','max_loss','capital_at_risk','exposure_cap','confidence_cap','approval_gate','paper_isolation','re_evaluation','audit_trace','scenario_integrity','anti_zero_output','explainability'];
  function analyze(decision,amount=1000,horizon=30){
    const d=decision||{},ex=d.executive||{},inputs=ex.inputs||{};
    amount=Math.max(1,Number(amount)||1000);horizon=[7,30,90].includes(Number(horizon))?Number(horizon):30;
    const risk=pct(d.risk??50),confidence=pct(d.confidence??ex.judgeConfidence??50),ceo=pct(ex.ceoConfidence??confidence),cfo=pct(ex.cfoConfidence??confidence),judge=pct(ex.judgeConfidence??confidence);
    const market=pct(inputs.market??50),evidence=pct(inputs.evidence??(d.webSignal?.count?Math.min(90,45+Number(d.webSignal.count)*5):50)),disagreement=pct(inputs.disagreement??Math.abs(ceo-cfo)),quantum=pct(d.quantumSignal?.confidence??60),stance=String(d.webSignal?.stance||'Mixed');
    const reserveMonths=Number(inputs.reserveMonths??d.telemetry?.reserveMonths??3),liquidity=pct(inputs.liquidity??50),debt=pct(inputs.debt??50),freshness=String(d.evidenceFreshness||'RECENT').toUpperCase(),webCount=Number(d.webSignal?.count||d.quantumSignal?.evidenceCount||0);
    const sourceDiversity=clamp(35+webCount*8),evidenceGate=evidence>=45&&webCount>0&&freshness!=='STALE',consensus=pct((ceo+cfo+judge)/3),disagreementPenalty=Math.min(18,disagreement*.28);
    let buy=50+(ceo-cfo)*.22+(market-50)*.20+(evidence-50)*.10+(quantum-60)*.08-(risk-50)*.16-disagreementPenalty*.35+(consensus-50)*.12;
    if(stance==='Positive')buy+=5;if(stance==='Cautious')buy-=7;if(!evidenceGate)buy-=12;buy=clamp(buy,5,90);
    let sell=50-buy*.72+(risk-50)*.22+(50-cfo)*.10+disagreement*.08;if(stance==='Cautious')sell+=6;sell=clamp(sell,5,88);
    let hold=clamp(100-buy-sell,5,90);const total=buy+sell+hold;buy=buy/total*100;sell=sell/total*100;hold=hold/total*100;
    const horizonFactor=horizon===7?.55:horizon===90?1.55:1,volatility=pct(35+(risk-50)*.55+disagreement*.2);
    const downsidePct=clamp((2.25+risk*.075+volatility*.018)*horizonFactor,1.5,22),upsidePct=clamp((3.25+confidence*.075+Math.max(0,market-50)*.05+Math.max(0,consensus-60)*.04)*horizonFactor,2,25);
    const reward=amount*upsidePct/100,loss=amount*downsidePct/100,rr=loss>0?upsidePct/downsidePct:0,expected=(buy/100)*reward-(sell/100)*loss;
    const maxRiskPct=clamp(1.5+(100-risk)*.035,1.5,4.5),lossBudget=amount*maxRiskPct/100,riskPerUnit=loss/amount,exposureByRisk=riskPerUnit>0?lossBudget/riskPerUnit:amount;
    const liquidityCap=amount*clamp(liquidity,10,100)/100,confidenceCap=amount*clamp(confidence,15,100)/100,concentrationCap=amount*.25,debtCap=debt<45?amount*.75:amount*.35;
    const requestedSafe=Math.max(0,Math.min(amount,exposureByRisk,liquidityCap,confidenceCap,concentrationCap,debtCap)),gateReasons=[];
    if(!evidenceGate)gateReasons.push('Evidence/freshness gate');if(risk>=75)gateReasons.push('High risk');if(rr<1.25)gateReasons.push('Risk/reward below 1.25');if(disagreement>=25)gateReasons.push('CEO/CFO disagreement');if(liquidity<30)gateReasons.push('Weak liquidity');if(reserveMonths<3)gateReasons.push('Reserve below 3 months');
    const action=(gateReasons.length===0&&buy>=sell+8&&rr>=1.25)?'BUY BIAS':sell>=buy+8?'SELL / AVOID':'HOLD / WAIT',approved=action==='BUY BIAS'&&gateReasons.length===0&&requestedSafe>0,recommended=approved?round(requestedSafe):0,riskBand=risk>=70?'HIGH':risk>=45?'MEDIUM':'LOW';
    const stress7=round(clamp(downsidePct*1.35,0,100)),stress30=round(clamp(downsidePct*1.75,0,100)),stress90=round(clamp(downsidePct*2.25,0,100)),slippage=round(amount*.0015),fees=round(amount*.001),taxReserve=round(Math.max(0,expected)*.05),netExpected=round(expected-fees-slippage-taxReserve);
    const targetMove=round(upsidePct),stopMove=round(-downsidePct),breakEvenPct=.25,maxLoss=round(Math.min(loss,recommended>0?recommended*downsidePct/100:lossBudget));
    const actionReason=approved?'Risk/reward, evidence, liquidity and confidence gates support a conditional paper-only BUY bias':gateReasons.length?'Capital protection gate: '+gateReasons.join(' · '):'No sufficiently strong edge; preserve capital and wait for confirmation.';
    const plan={requestedAmount:amount,recommendedAmount:recommended,approval:approved?'CONDITIONAL':'BLOCKED',riskBudget:round(lossBudget),capitalAtRisk:round(Math.min(lossBudget,amount*downsidePct/100)),entry:'Use the verified live/limit price only; FinPilot will not invent an entry price.',targetPct:targetMove,stopPct:stopMove,trailingStopPct:round(Math.max(1.25,downsidePct*.65)),targetProfit:round(recommended*upsidePct/100),stopLoss:round(recommended*downsidePct/100),maximumLoss:maxLoss,breakEvenPct,breakEvenCost:round(amount*breakEvenPct/100),riskReward:round(rr),expectedValue:netExpected,stress7,stress30,stress90,positionCap:round(Math.min(amount,liquidityCap,confidenceCap,concentrationCap,debtCap)),gateReasons,actionReason};
    return {version:'3.0.0',upgradeCount:50,upgrades:FEATURES,amount,horizon,action,riskBand,approved,buyProbability:round(buy),sellProbability:round(sell),holdProbability:round(hold),upsidePct:round(upsidePct),downsidePct:round(downsidePct),estimatedProfit:round(reward),estimatedLoss:round(loss),riskAmount:round(loss),riskReward:round(rr),expectedValue:netExpected,plan,probabilityBasis:'Model estimate from CEO/CFO/Judge, specialist consensus, evidence quality, market stance, risk and disagreement. It is not a calibrated market probability.',disclaimer:'Scenario only — not a guaranteed return, calibrated trading probability, or personal investment advice. Market execution can differ materially from the scenario.',inputs:{risk:round(risk),confidence:round(confidence),ceo:round(ceo),cfo:round(cfo),judge:round(judge),market:round(market),evidence:round(evidence),quantum:round(quantum),disagreement:round(disagreement),stance,reserveMonths,liquidity,debt,sourceDiversity},controls:{evidenceGate,evidenceFreshness:freshness,sourceDiversity:round(sourceDiversity),consensus,volatility:round(volatility),webCount,features:FEATURES}};
  }
  window.FinpilotMoneyEngine={version:'3.0.0',upgradeCount:50,features:FEATURES,analyze};
})();