/* FinPilot Money Scenario Engine
   Converts the current decision evaluation into a transparent position-size scenario.
   IMPORTANT: probabilities are model estimates, not guaranteed market odds.
*/
(function(){
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
  const round=n=>Math.round(Number(n)*100)/100;
  function analyze(decision,amount=1000,horizon=30){
    const d=decision||{}, ex=d.executive||{}, inputs=ex.inputs||{};
    amount=Math.max(1,Number(amount)||1000);
    horizon=[7,30,90].includes(Number(horizon))?Number(horizon):30;
    const risk=clamp(d.risk ?? (inputs.stability!=null ? 100-inputs.stability : 50));
    const confidence=clamp(d.confidence??ex.judgeConfidence??50);
    const ceo=clamp(ex.ceoConfidence??confidence);
    const cfo=clamp(ex.cfoConfidence??confidence);
    const judge=clamp(ex.judgeConfidence??confidence);
    const market=clamp(inputs.market??50);
    const evidence=clamp(inputs.evidence??50);
    const disagreement=clamp(inputs.disagreement??0);
    const stance=String(d.webSignal?.stance||'Mixed');
    const quantum=clamp(d.quantumSignal?.confidence??60);

    // Model probabilities are deliberately conservative and bounded.
    let buy=50 +(ceo-cfo)*0.22 +(market-50)*0.20 +(evidence-50)*0.10 +(quantum-60)*0.08 -(risk-50)*0.16 -(disagreement>20?4:0);
    if(stance==='Positive')buy+=4;
    if(stance==='Cautious')buy-=6;
    buy=clamp(buy,5,90);
    let sell=clamp(50-buy*0.72 +(risk-50)*0.22 +(50-cfo)*0.10,5,85);
    let hold=clamp(100-buy-sell,5,90);
    const total=buy+sell+hold;buy=buy/total*100;sell=sell/total*100;hold=hold/total*100;

    // Scenario ranges are tied to current risk/confidence, not presented as a forecast.
    const horizonFactor=horizon===7?.55:horizon===90?1.55:1;
    const downsidePct=clamp((2.5 + risk*.075)*horizonFactor,2,22);
    const upsidePct=clamp((3.5 + confidence*.075 + Math.max(0,market-50)*.04)*horizonFactor,3,25);
    const reward=amount*upsidePct/100;
    const loss=amount*downsidePct/100;
    const rr=loss?upsidePct/downsidePct:0;
    const expected=(buy/100)*reward-(sell/100)*loss;
    const riskAmount=loss;
    const action=buy>=sell+8&&rr>=1.25?'BUY BIAS':sell>=buy+8?'SELL / AVOID':'HOLD / WAIT';
    const riskBand=risk>=70?'HIGH':risk>=45?'MEDIUM':'LOW';
    return {
      amount,horizon,action,riskBand,
      buyProbability:round(buy),sellProbability:round(sell),holdProbability:round(hold),
      upsidePct:round(upsidePct),downsidePct:round(downsidePct),
      estimatedProfit:round(reward),estimatedLoss:round(loss),riskAmount:round(riskAmount),
      riskReward:round(rr),expectedValue:round(expected),
      probabilityBasis:'Model estimate from current CEO/CFO/Judge, risk, evidence, Quantum signal and live stance.',
      disclaimer:'Scenario only — not a guaranteed return, calibrated trading probability, or personal investment advice. Actual price movement can be materially different.',
      inputs:{risk:round(risk),confidence:round(confidence),ceo:round(ceo),cfo:round(cfo),judge:round(judge),market:round(market),evidence:round(evidence),quantum:round(quantum),disagreement:round(disagreement),stance}
    };
  }
  window.FinPilotMoneyEngine={analyze};
})();