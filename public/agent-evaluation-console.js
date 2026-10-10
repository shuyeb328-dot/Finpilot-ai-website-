/* FinPilot Agent Evaluation Console
   User-triggered, offline-first evaluation UI. It never starts a run on page load.
   Evaluation does not call live market providers, external AI, or financial execution.
*/
(function(){
  'use strict';
  if (window.FinPilotAgentEvaluationConsole) return;

  const STATUS_URL='/api/agent-evaluation/status';
  const RUN_URL='/api/agent-evaluation/run';
  const HISTORY_URL='/api/agent-evaluation/history?limit=10';
  let launcher=null, panel=null, lastStatus=null, busy=false;

  function node(tag,cls,text){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined&&text!==null)el.textContent=String(text);
    return el;
  }
  function button(text,cls,handler){
    const b=node('button','fpEvalBtn '+(cls||''),text);
    b.type='button';b.addEventListener('click',handler);return b;
  }
  function stamp(value){
    const d=new Date(value||'');
    return Number.isFinite(d.getTime())?d.toLocaleString():'Not recorded';
  }
  function statusMessage(text,tone){
    const el=panel?.querySelector('[data-role="message"]');
    if(!el)return;el.textContent=text;el.dataset.tone=tone||'info';
  }
  async function getJson(url,options){
    const response=await fetch(url,{cache:'no-store',...options});
    const raw=await response.text();
    let data;
    try{data=JSON.parse(raw)}catch{throw new Error('The server returned an unreadable response.');}
    if(!response.ok)throw new Error(data.error||('HTTP '+response.status));
    return data;
  }
  function stat(label,value,detail){
    const card=node('div','fpEvalStat');
    card.append(node('small','',label),node('strong','',value),node('span','',detail||''));
    return card;
  }
  function setBusy(value){
    busy=Boolean(value);
    const b=panel?.querySelector('[data-action="run"]');
    if(b){b.disabled=busy;b.textContent=busy?'Running offline checks…':'Run offline evaluation';}
  }
  function renderStatus(data){
    lastStatus=data;
    const host=panel.querySelector('[data-role="status"]');
    host.replaceChildren();
    const last=data.lastRun;
    host.append(
      stat('SUITE CASES',data.suiteCases,'Deterministic, local checks'),
      stat('LAST RESULT',last?(last.score+'%'):'Not measured',last?(last.passed+'/'+last.caseCount+' passed'): 'Run the suite to establish a baseline'),
      stat('PERSISTENCE',data.persistent?'PostgreSQL':data.persistence||'Unknown',data.persistent?'History saved to database':'May be lost when server restarts'),
      stat('MODE',data.mode||'Unknown','User-triggered only')
    );
    const facts=node('div','fpEvalFacts');
    facts.append(
      node('span','',data.externalAIUsed===false?'External AI: not used in evaluation':'External AI status: verify'),
      node('span','',data.marketProvidersQueried===false?'Live market calls: none':'Market-call status: verify'),
      node('span','',data.financialExecution===false?'Financial execution: disabled':'Execution status: verify'),
      node('span','',data.automaticPromotion===false?'Automatic promotion: disabled':'Promotion status: verify')
    );
    host.append(facts,node('p','fpEvalMuted',data.persistenceDetail||'Persistence details are not available.'));
  }
  function renderHistory(data){
    const host=panel.querySelector('[data-role="history"]');
    host.replaceChildren(node('h3','', 'Recent evaluation runs'));
    if(!Array.isArray(data.history)||data.history.length===0){
      host.append(node('p','fpEvalMuted','No history recorded yet. Run the offline evaluation to establish a baseline.'));
      return;
    }
    for(const run of data.history.slice(0,10)){
      const row=node('div','fpEvalHistoryRow');
      const left=node('div','');
      left.append(node('strong','', (run.score??'—')+'% · '+(run.status||'Unknown')));
      left.append(node('span','',stamp(run.completedAt||run.startedAt)));
      row.append(left,node('div','fpEvalPill', (run.passed??0)+' / '+(run.caseCount??0)+' passed'));
      host.append(row);
    }
    host.append(node('p','fpEvalMuted',data.persistent?'History is stored in PostgreSQL.':'History is currently memory-only and can be lost on restart.'));
  }
  function renderRun(data){
    const host=panel.querySelector('[data-role="run-result"]');
    host.replaceChildren();
    const heading=node('div','fpEvalRunHeading');
    heading.append(node('strong','',data.status+' · '+data.score+'%'),node('span','',data.passed+'/'+data.caseCount+' passed · '+data.durationMs+' ms'));
    host.append(heading);
    if(data.failed===0)host.append(node('p','fpEvalGood','All deterministic checks passed. This validates technical contracts and safety gates—not financial prediction accuracy.'));
    else host.append(node('p','fpEvalBad',data.failed+' checks failed. Do not promote a candidate change until the failure is understood.'));
    const rows=node('div','fpEvalCaseList');
    for(const item of (data.results||[])){
      const row=node('details','fpEvalCase');
      const summary=node('summary','');
      summary.append(node('span',item.passed?'fpEvalDot ok':'fpEvalDot bad',item.passed?'PASS':'FAIL'),node('strong','',item.id+' · '+item.description));
      row.append(summary);
      if(item.error)row.append(node('p','fpEvalError',item.error));
      row.append(node('p','fpEvalMuted','Domain: '+item.domain+' · '+item.durationMs+' ms'));
      rows.append(row);
    }
    host.append(rows);
    statusMessage(data.failed===0?'Evaluation completed. No external AI, live market provider or trade was used.':'Evaluation failed. Review the failed cases before any promotion. ',data.failed===0?'success':'error');
  }
  async function refresh(){
    statusMessage('Refreshing status and history…','info');
    try{
      const [status,history]=await Promise.all([getJson(STATUS_URL),getJson(HISTORY_URL)]);
      renderStatus(status);renderHistory(history);
      if(!busy)statusMessage('Ready. The evaluation runs only when you press the run button.','info');
    }catch(error){statusMessage(error.message||'Unable to load evaluation status.','error');}
  }
  async function run(){
    if(busy)return;
    setBusy(true);statusMessage('Running the deterministic regression suite. No live market or external AI requests are made.','info');
    try{
      const result=await getJson(RUN_URL,{method:'POST'});
      renderRun(result);
      const [status,history]=await Promise.all([getJson(STATUS_URL),getJson(HISTORY_URL)]);
      renderStatus(status);renderHistory(history);
    }catch(error){
      statusMessage('Evaluation could not complete: '+(error.message||'unknown error'),'error');
    }finally{setBusy(false);}
  }
  function mountPanel(){
    if(panel){panel.hidden=false;refresh();return;}
    panel=node('section','fpEvalOverlay');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','FinPilot agent evaluation console');
    const card=node('div','fpEvalPanel');
    const header=node('div','fpEvalHeader');
    const title=node('div','');
    title.append(node('div','fpEvalEyebrow','FINPILOT · LEARNING QUALITY'),node('h2','', 'Agent Evaluation Lab'),node('p','fpEvalMuted','Baseline and safety regression checks. Scores appear only after actual tests run.'));
    header.append(title,button('Close','',()=>{panel.hidden=true;launcher?.focus();}));
    const message=node('p','fpEvalMessage','Loading evaluation status…');message.dataset.role='message';
    const status=node('div','fpEvalStats');status.dataset.role='status';
    const actions=node('div','fpEvalActions');
    const runButton=button('Run offline evaluation','primary',run);runButton.dataset.action='run';
    actions.append(runButton,button('Refresh history','',refresh));
    const result=node('div','fpEvalResult');result.dataset.role='run-result';
    const history=node('div','fpEvalHistory');history.dataset.role='history';
    const footer=node('p','fpEvalFooter','Guardrails: user-triggered only · no automatic promotion · no real-money execution · disabled Binance connector unchanged.');
    card.append(header,message,status,actions,result,history,footer);
    panel.append(card);
    panel.addEventListener('click',event=>{if(event.target===panel)panel.hidden=true;});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel&&!panel.hidden)panel.hidden=true;});
    document.body.append(panel);
    refresh();
  }
  function mount(){
    if(launcher||!document.body)return;
    launcher=button('Agent Evaluation','fpEvalLauncher',mountPanel);
    launcher.setAttribute('aria-label','Open FinPilot Agent Evaluation Lab');
    document.body.append(launcher);
  }
  const style=node('style','');
  style.textContent=`
.fpEvalLauncher{position:fixed!important;right:14px;bottom:106px;z-index:9998!important;border:1px solid #496b91!important;background:#0d1d32!important;color:#e9f2fc!important;box-shadow:0 8px 30px #0005!important}
.fpEvalOverlay{position:fixed;inset:0;z-index:10001;background:#020812cc;display:grid;place-items:center;padding:14px}
.fpEvalOverlay[hidden]{display:none}
.fpEvalPanel{box-sizing:border-box;width:min(1000px,100%);max-height:92vh;overflow:auto;padding:20px;border:1px solid #2c4968;border-radius:18px;background:#071426;color:#e8f0fa;box-shadow:0 24px 90px #0008;font:14px/1.45 system-ui,sans-serif}
.fpEvalPanel *{box-sizing:border-box}
.fpEvalHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.fpEvalHeader h2{margin:5px 0;font-size:24px}
.fpEvalHeader p{margin:4px 0 12px}
.fpEvalEyebrow{font-size:11px;letter-spacing:.14em;font-weight:700;color:#91b4d7}
.fpEvalMuted{color:#9cb0c7;font-size:12px}
.fpEvalBtn{padding:9px 13px;border-radius:9px;border:1px solid #385675;background:#10253d;color:#e8f0fa;cursor:pointer;font:600 13px system-ui,sans-serif}
.fpEvalBtn.primary{background:#1a5c48;border-color:#35866b}
.fpEvalBtn:disabled{opacity:.6;cursor:wait}
.fpEvalMessage{border:1px solid #344a63;border-radius:9px;padding:10px;background:#0b1b2f;color:#cfe4fa}
.fpEvalMessage[data-tone="success"]{border-color:#276b51;color:#abf0d1}
.fpEvalMessage[data-tone="error"]{border-color:#8f4242;color:#ffb7b7}
.fpEvalStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:12px 0}
.fpEvalStat{min-width:0;border:1px solid #203955;background:#0a1a2e;border-radius:10px;padding:12px}
.fpEvalStat small,.fpEvalStat span{display:block;color:#92a8c0;font-size:11px}
.fpEvalStat strong{display:block;font-size:19px;margin:4px 0;overflow-wrap:anywhere}
.fpEvalFacts{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}
.fpEvalFacts span,.fpEvalPill{border:1px solid #284560;background:#0b1b2f;border-radius:7px;padding:6px 8px;font-size:11px;color:#bdd0e5}
.fpEvalActions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.fpEvalRunHeading,.fpEvalHistoryRow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #233a52}
.fpEvalRunHeading strong{font-size:18px}
.fpEvalRunHeading span,.fpEvalHistoryRow span{display:block;color:#9cb0c7;font-size:12px}
.fpEvalGood{color:#9ee6c4}.fpEvalBad{color:#ffb9b9}
.fpEvalCaseList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.fpEvalCase{border:1px solid #213a54;border-radius:8px;padding:8px;background:#0a192b}
.fpEvalCase summary{cursor:pointer;display:flex;gap:8px;align-items:flex-start}
.fpEvalCase summary strong{font-size:12px;font-weight:550}
.fpEvalDot{font-weight:800;font-size:9px;min-width:29px}
.fpEvalDot.ok{color:#8ce0b9}.fpEvalDot.bad{color:#ff9494}
.fpEvalError{color:#ffb4b4;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
.fpEvalFooter{color:#9cb0c7;border-top:1px solid #263d56;padding-top:12px;font-size:11px}
@media(max-width:640px){.fpEvalStats{grid-template-columns:repeat(2,minmax(0,1fr))}.fpEvalCaseList{grid-template-columns:1fr}.fpEvalPanel{padding:14px}.fpEvalHeader h2{font-size:20px}.fpEvalLauncher{bottom:100px;right:9px}}
`;
  document.head.append(style);
  window.FinPilotAgentEvaluationConsole={version:'1.0.0',open:mountPanel,refresh,getStatus:()=>lastStatus};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();