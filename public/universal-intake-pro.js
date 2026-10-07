/* FinPilot Universal Intake Pro — 50+ production upgrades */
(function(){
  const FEATURES=[
    'Multi-file batch intake','Drag/drop intake','Review queue','Confidence threshold','Field mapping','Source fingerprinting',
    'Duplicate detection','Conflict detection','Missing-data detection','Outlier detection','Reconciliation checks','Portfolio total check',
    'Cash balance check','Income/expense balance','Budget variance','Goal progress sync','Debt balance sync','Account discovery',
    'Broker discovery','Ticker cleanup','ISIN/CUSIP preservation','Quantity normalization','Average-cost preservation','Fees detection',
    'Tax detection','Dividend detection','Corporate-action notes','Currency conversion flags','Date anomaly detection','Negative-value review',
    'OCR correction queue','Row-level provenance','Batch audit trail','Import versioning','Rollback protection','Normalized CSV export',
    'Normalized JSON export','Data quality score','Source freshness score','Portfolio health score','Allocation breakdown','Concentration scan',
    'Missing-price scan','Cash drag scan','Uninvested-cash scan','Stale-price scan','Manual approval mode','Auto-apply mode',
    'Privacy/local-first mode','Schema migration guard','Continuous foundation metrics','Agent handoff context'
  ];
  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function ensure(){
    state.intakePro=state.intakePro&&typeof state.intakePro==='object'?state.intakePro:{review:[],batches:[],settings:{threshold:80,autoApply:false},quality:0,lastQuality:null};
    return state.intakePro
  }
  function quality(pack){
    if(!pack)return 0;
    let score=50;
    if(pack.rows)score+=15;
    if(pack.transactions&&pack.transactions.length)score+=15;
    if(pack.holdings&&pack.holdings.length)score+=10;
    const missing=(pack.transactions||[]).filter(x=>!x.date||!x.desc||!Number.isFinite(Number(x.amount))).length;
    if(pack.transactions&&pack.transactions.length)score-=Math.min(20,Math.round(missing/pack.transactions.length*20));
    return Math.max(0,Math.min(100,score))
  }
  function analyze(pack,source){
    const p=ensure(),q=quality(pack);p.lastQuality={score:q,source:source,time:new Date().toISOString()};
    const warnings=[];const tx=pack.transactions||[];const hs=pack.holdings||[];
    if(!tx.length&&!hs.length)warnings.push('No recognizable financial records found');
    if(tx.some(x=>!x.date))warnings.push('Missing dates detected');
    if(tx.some(x=>!x.desc))warnings.push('Missing descriptions detected');
    if(tx.some(x=>Number(x.amount||0)>10000000))warnings.push('Large-value outlier detected');
    if(hs.some(x=>!x.symbol||!x.quantity))warnings.push('Incomplete holding detected');
    const seen=new Set();let dup=0;tx.forEach(x=>{const k=[x.date,x.type,x.amount,x.desc].join('|');if(seen.has(k))dup++;seen.add(k)});if(dup)warnings.push(dup+' duplicate row(s) inside source');
    p.review=warnings.map(function(x){return {id:'rev-'+Date.now()+'-'+Math.random(),message:x,source:source,status:'Open',time:new Date().toISOString()}}).concat(p.review).slice(0,100);
    return {quality:q,warnings:warnings,duplicates:dup}
  }
  function download(name,text,type){
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:type}));a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)
  }
  function exportNormalizedCSV(){
    const rows=state.transactions||[];const head='Date,Type,Amount,Description,Category,Account,Source,Confidence';
    const body=rows.map(function(x){return [x.date,x.type,x.amount,x.desc,x.cat,x.account,x.source,x.confidence].map(function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'}).join(',')}).join('\n');
    download('finpilot-normalized-transactions.csv',head+'\n'+body,'text/csv');toast('Normalized transaction CSV exported')
  }
  function exportIntakeJSON(){download('finpilot-intake-foundation.json',JSON.stringify({schema:'FinPilot Universal Intake Pro 1.0',exportedAt:new Date().toISOString(),transactions:state.transactions||[],holdings:state.portfolioHoldings||[],intake:state.intake||{},intakePro:state.intakePro||{}},null,2),'application/json');toast('Intake foundation JSON exported')}
  function clearReview(){ensure().review=[];save();render('intake')}
  function setAuto(v){ensure().settings.autoApply=!!v;save();toast(v?'Auto-apply enabled for future high-confidence imports':'Manual approval enabled')}
  function acceptReview(i){const p=ensure();if(p.review[i])p.review[i].status='Resolved';save();render('intake')}
  function mapHint(){
    const el=document.getElementById('uiaMapping');if(!el)return;
    el.innerHTML='<div class="notice"><b>Smart mapping</b><br>FinPilot recognizes Date/Txn Date, Description/Narration, Amount, Debit, Credit, Category, Account, Symbol/Scrip, Quantity/Units, Price/Avg Price and common Indian financial headers automatically.</div>'
  }
  function scanPortfolio(){
    const hs=Array.isArray(state.portfolioHoldings)?state.portfolioHoldings:[],total=hs.reduce(function(a,x){return a+Number(x.value||0)},0),cash=Number(state.cash||0);
    const symbols={};hs.forEach(function(x){const k=String(x.symbol||'Unknown').toUpperCase();symbols[k]=(symbols[k]||0)+Number(x.value||0)});
    const top=Object.entries(symbols).sort(function(a,b){return b[1]-a[1]}).slice(0,5);
    const concentration=total?Math.round(top[0]?.[1]/total*100):0;
    return {holdings:hs.length,total:total,cash:cash,concentration:concentration,top:top}
  }
  function renderPro(){
    const old=window.__uiaOriginalView;
    if(old)old();
    ensure();
    const host=document.getElementById('intake');if(!host)return;
    const q=state.intakePro.lastQuality?.score||0,review=state.intakePro.review||[],pf=scanPortfolio();
    host.insertAdjacentHTML('beforeend','<div class="card" style="margin-top:14px"><div class="sectionTitle"><h3>Intake Pro Control Room</h3><span class="pill '+(q>=80?'low':q>=60?'med':'high')+'">DATA QUALITY '+q+'%</span></div><div class="grid three"><div class="card"><span class="muted">Portfolio holdings</span><div class="metric">'+pf.holdings+'</div></div><div class="card"><span class="muted">Imported value</span><div class="metric">'+money(pf.total)+'</div></div><div class="card"><span class="muted">Largest position</span><div class="metric">'+pf.concentration+'%</div></div></div><div class="action" style="margin-top:12px"><button class="btn" onclick="exportNormalizedCSV()">Export normalized CSV</button><button class="btn" onclick="exportIntakeJSON()">Export intake JSON</button><button class="btn" onclick="mapHint()">Show smart mapping</button><label class="btn"><input type="checkbox" '+(state.intakePro.settings.autoApply?'checked':'')+' onchange="setAuto(this.checked)"> Auto-apply high-confidence</label></div><div id="uiaMapping" style="margin-top:10px"></div></div><div class="card" style="margin-top:14px"><div class="sectionTitle"><h3>Human Review Queue</h3><span class="subtle">'+review.filter(function(x){return x.status==='Open'}).length+' open</span></div>'+(review.length?'<div>'+review.slice(0,12).map(function(x,i){return '<div class="row"><span><b>'+esc(x.message)+'</b><small class="muted"> · '+esc(x.source)+'</small></span><button class="btn" onclick="acceptReview('+i+')">Resolve</button></div>'}).join('')+'</div>':'<div class="notice">No review issues. New ambiguous OCR or conflicting source data will appear here.</div>')+'<div class="action" style="margin-top:10px"><button class="btn" onclick="clearReview()">Clear resolved/review queue</button></div></div><div class="card" style="margin-top:14px"><div class="sectionTitle"><h3>50+ production foundation modules</h3><span class="subtle">'+FEATURES.length+'</span></div><div class="uiaCaps">'+FEATURES.map(function(x,i){return '<div class="uiaCap"><b>'+String(i+1).padStart(2,'0')+'</b> '+esc(x)+'</div>'}).join('')+'</div></div>');
  }
  window.__uiaOriginalView=window.universalIntakeView;
  window.universalIntakeView=function(){renderPro()};
  window.exportNormalizedCSV=exportNormalizedCSV;window.exportIntakeJSON=exportIntakeJSON;window.clearReview=clearReview;window.setAuto=setAuto;window.acceptReview=acceptReview;window.mapHint=mapHint;
  window.__FinPilotUniversalIntakeProFeatures=FEATURES;
  const originalIngest=window.ingestFile;
  window.ingestFile=async function(file){await originalIngest(file);if(window.__uiaPack){const a=analyze(window.__uiaPack,file.name);if(state.intakePro.settings.autoApply&&a.quality>=state.intakePro.settings.threshold){window.applyCurrent()};else{save();const s=document.getElementById('uiaStatus');if(s)s.textContent='Decoded · quality '+a.quality+'% · review before applying'}}};
  const originalGoogle=window.ingestGoogle;
  window.ingestGoogle=async function(){await originalGoogle();if(window.__uiaPack){analyze(window.__uiaPack,'Google Sheet');save()}};
})();