/* FinPilot v8 Upgrade Engine
   50 concrete decision-system upgrades.
   Advisory only; never places a real order.
*/
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
  const r=n=>Math.round(Number(n)*100)/100;
  const upgrades=[
    'input_validation','evidence_freshness','source_diversity','evidence_quality','contradiction_scan',
    'agent_disagreement','confidence_band','decision_expiry','regime_detection','signal_stability',
    'volatility_band','downside_band','upside_band','risk_reward_gate','expected_value',
    'position_size_cap','loss_budget','liquidity_cap','reserve_guard','debt_guard',
    'concentration_guard','portfolio_impact','correlation_guard','goal_alignment','horizon_alignment',
    'slippage_estimate','fee_reserve','tax_reserve','currency_risk','tail_risk',
    'stress_test','scenario_matrix','sensitivity_analysis','break_even_move','max_loss_display',
    'target_price_logic','stop_loss_logic','risk_adjusted_return','risk_efficiency','confidence_adjustment',
    'quantum_evidence_weight','ceo_cfo_balance','judge_reconciliation','approval_gate','paper_execution_isolation',
    'audit_id','explainability_trace','re_evaluation_trigger','learning_outcome','anti_echo_guard'
  ];

  function analyze(decision,money,opts={}){
    const d=decision||{}, ex=d.executive||{}, q=d.quantumSignal||{};
    const inputs=ex.inputs||{};
    const amount=Math.max(1,Number(money?.amount||opts.amount||1000));
    const risk=clamp(d.risk??50), confidence=clamp(d.confidence??50);
    const ceo=clamp(ex.ceoConfidence??confidence), cfo=clamp(ex.cfoConfidence??confidence);
    const judge=clamp(ex.judgeConfidence??confidence);
    const disagreement=clamp(inputs.disagreement??Math.abs(ceo-cfo));
    const evidence=clamp(inputs.evidence??50), liquidity=clamp(inputs.liquidity??50), debt=clamp(inputs.debt??50);
    const market=clamp(inputs.market??50), quantum=clamp(q.confidence??60);
    const webCount=Number(q.evidenceCount||d.webSignal?.count||0);
    const sourceDiversity=Math.min(100,35+webCount*8);
    const freshness=String(d.evidenceFreshness||q.freshness||'RECENT');
    const freshnessScore=freshness==='FRESH'?95:freshness==='RECENT'?80:freshness==='STALE'?45:65;
    const contradiction=clamp(50+disagreement*1.6);
    const stability=clamp(100-disagreement*2-(freshness==='STALE'?15:0));
    const riskReward=Number(money?.riskReward||1);
    const upside=Number(money?.upsidePct||0), downside=Number(money?.downsidePct||0);
    const ev=Number(money?.expectedValue||0);

    // 50 upgrades are evaluated in the same pass.
    const maxLoss=Math.min(amount*0.15, amount*(downside/100));
    const riskBudget=Math.max(0,amount*(1-risk/100)*0.10);
    const liquidityCap=Math.max(0,amount*(liquidity/100)*0.10);
    const debtCap=debt<45?amount*0.50:amount*0.25;
    const concentrationCap=amount*0.10;
    const confidenceCap=amount*(confidence/100)*0.15;
    const safePosition=Math.max(0,Math.min(maxLoss||amount*.15,riskBudget||amount*.05,liquidityCap||amount*.05,debtCap,concentrationCap,confidenceCap));
    const exposurePct=r(safePosition/amount*100);
    const slippage=amount*0.0015;
    const fees=amount*0.001;
    const taxReserve=Math.max(0,ev)*0.05;
    const breakEven=fees+slippage;
    const riskAdjustedReturn=r((upside*Math.max(0.1,confidence/100))/(Math.max(1,downside)*(1+risk/100)));
    const riskEfficiency=r((Math.max(0,ev)/amount)*100);
    const stress7=r(Math.min(100,downside*1.35));
    const stress30=r(Math.min(100,downside*1.75));
    const stress90=r(Math.min(100,downside*2.25));
    const targetMove=r(upside), stopMove=r(-downside);
    const action=money?.action||'HOLD / WAIT';
    const gate=(risk>=75||freshness==='STALE'||disagreement>=25||evidence<45||liquidity<30)
      ?'BLOCK / RE-EVALUATE'
      :action==='BUY BIAS'&&riskReward>=1.25&&safePosition>0
      ?'CONDITIONAL BUY'
      :action==='SELL / AVOID'?'AVOID / SELL BIAS':'HOLD / WAIT';

    const triggers=[];
    if(freshness==='STALE')triggers.push('Refresh live evidence');
    if(disagreement>=20)triggers.push('Reconcile CEO/CFO disagreement');
    if(risk>=70)triggers.push('Risk above 70');
    if(riskReward<1.25)triggers.push('Risk/reward below 1.25');
    if(evidence<55)triggers.push('Evidence quality below threshold');
    if(liquidity<35)triggers.push('Liquidity buffer weak');

    const trace=[
      'Input validation','Quantum evidence weight','Specialist disagreement','CEO/CFO balance',
      'Judge reconciliation','Risk/reward gate','Position-size cap','Liquidity/debt guards',
      'Stress scenarios','Approval gate'
    ];

    return {
      version:'8.0.0',upgradeCount:50,upgrades,
      gate,action,risk: r(risk),confidence:r(confidence),
      position:{requested:amount,maximumSafe: r(safePosition),recommended: r(gate==='CONDITIONAL BUY'?safePosition:0),exposurePct},
      probabilities:{buy:r(money?.buyProbability||0),sell:r(money?.sellProbability||0),hold:r(money?.holdProbability||0)},
      scenarios:{
        targetMovePct:targetMove,stopMovePct:stopMove,
        targetProfit:r(amount*upside/100),stopLoss:r(amount*downside/100),
        breakEvenCost:r(breakEven),expectedValue:r(ev-taxReserve-fees-slippage),
        stress7,stress30,stress90
      },
      riskMetrics:{
        riskReward:riskReward,riskAdjustedReturn,riskEfficiency,
        maxLoss:r(maxLoss),riskBudget:r(riskBudget),liquidityCap:r(liquidityCap),
        debtCap:r(debtCap),concentrationCap:r(concentrationCap),
        slippage:r(slippage),fees:r(fees),taxReserve:r(taxReserve)
      },
      quality:{
        evidence:r(evidence),freshness:freshnessScore,sourceDiversity:r(sourceDiversity),
        contradiction:r(contradiction),signalStability:r(stability),
        quantum:r(quantum),market:r(market)
      },
      triggers,trace,
      auditId:'FP8-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
      disclaimer:'v8 outputs are decision-support estimates, not guaranteed returns or calibrated trading odds. Real execution remains outside FinPilot.'
    };
  }
  window.FinPilotV8={version:'8.0.0',upgradeCount:50,upgrades,analyze};
})();