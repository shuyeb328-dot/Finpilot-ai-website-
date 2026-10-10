import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/tradingview-paper-bridge.js',import.meta.url),'utf8');
const listeners = new Map();
function makeElement(id='') {
  const childNodes=[];
  const handlers=new Map();
  const el={
    id,dataset:{},style:{},className:'',value:'',textContent:'',href:'',
    _children:childNodes,_handlers:handlers,_innerHTML:'',
    addEventListener(type,handler){const list=handlers.get(type)||[];list.push(handler);handlers.set(type,list)},
    dispatchEvent(event){event.target=this;for(const fn of handlers.get(event.type)||[])fn(event);return true},
    querySelector(selector){const key=String(selector).startsWith('#')?String(selector).slice(1):String(selector);return childNodes.find(x=>x.id===key)||null},
    prepend(child){const old=childNodes.indexOf(child);if(old>=0)childNodes.splice(old,1);childNodes.unshift(child);child.parentNode=this},
    get childElementCount(){return childNodes.length},
    set innerHTML(value){this._innerHTML=String(value);if(this.id==='paperlab'){childNodes.length=0;childNodes.push(makeElement('paperlab-rendered-content'))}},
    get innerHTML(){return this._innerHTML},
    fire(type){for(const fn of handlers.get(type)||[])fn({type,target:this})}
  };
  return el;
}

const host=makeElement('paperlab');
const ticket=makeElement('paperSymbol');ticket.value='BTC';
const status=makeElement('paperMarketStatus');
let refreshPaperCalls=0;
let inboxFetchCalls=0;
const fetch=async(url,options={})=>{
  inboxFetchCalls++;
  assert.equal(url,'/api/tradingview-alerts');
  assert.equal(options.method,'GET');
  assert.equal(options.cache,'no-store');
  assert.equal(options.credentials,'same-origin');
  assert.equal(options.headers['X-FinPilot-Webhook-Token'],'test-shared-secret-not-stored');
  return {ok:true,status:200,json:async()=>({ok:true,count:1,items:[{receivedAt:'2026-10-10T12:00:00.000Z',symbol:'NASDAQ:AAPL',action:'BUY',status:'RECEIVED_UNVERIFIED'}]})};
};
const document={
  readyState:'loading',
  body:makeElement('body'),
  addEventListener(type,handler){listeners.set(type,handler)},
  getElementById(id){return id==='paperlab'?host:id==='paperSymbol'?ticket:id==='paperMarketStatus'?status:null},
  querySelector(){return null},
  createElement(tag){
    const controls=new Map();
    const section=makeElement('');
    section.tagName=String(tag).toUpperCase();
    section.querySelector=function(selector){
      const key=String(selector).startsWith('#')?String(selector).slice(1):String(selector);
      if(!controls.has(key)){
        const el=makeElement(key);
        if(key==='fpTvSymbol')el.value='NASDAQ:AAPL';
        if(key==='fpTvMarket')el.value='US';
        controls.set(key,el);
      }
      return controls.get(key);
    };
    return section;
  }
};
const window={refreshPaper(){refreshPaperCalls++;return Promise.resolve()}};
class MockEvent {constructor(type,options={}){this.type=type;Object.assign(this,options)}}
vm.runInNewContext(source,{window,document,MutationObserver:function(){},setInterval,clearInterval,Event:MockEvent,console,fetch});
const api=window.FinPilotTradingViewBridge;

assert.equal(api.normalizeSymbol(' btcusdt '),'BTCUSDT');
assert.equal(api.normalizeSymbol('BTC USDT'),'BTCUSDT');
assert.equal(api.normalizeSymbol('javascript:alert(1)'),'');
assert.equal(api.tvSymbol('BTCUSDT','AUTO'),'BINANCE:BTCUSDT');
assert.equal(api.tvSymbol('BTC','CRYPTO'),'BINANCE:BTCUSDT');
assert.equal(api.tvSymbol('RELIANCE.NS','AUTO'),'NSE:RELIANCE');
assert.equal(api.tvSymbol('RELIANCE','INDIA'),'NSE:RELIANCE');
assert.equal(api.tvSymbol('AAPL','US'),'NASDAQ:AAPL');
assert.equal(api.tvSymbol('NASDAQ:MSFT','AUTO'),'NASDAQ:MSFT');
assert.match(api.widgetUrl('AAPL'),/symbol=NASDAQ%3AAAPL/);
assert.equal(api.widgetUrl(''), '');
assert.equal(api.paperSymbol('NASDAQ:AAPL'),'AAPL');
assert.equal(api.paperSymbol('NSE:RELIANCE'),'RELIANCE.NS');
assert.equal(api.paperSymbol('RELIANCE.NS'),'RELIANCE.NS','explicit NSE suffix must be preserved for the paper ticket');
assert.equal(api.paperSymbol('INFY.BO'),'INFY.BO','explicit BSE suffix must be preserved for the paper ticket');
assert.equal(api.paperSymbol('BSE:INFY'),'INFY.BO');
assert.equal(api.paperSymbol('BINANCE:BTCUSDT'),'BTCUSDT');
assert.equal(api.paperSymbol('javascript:alert(1)'),''); 

api.mount();
const first=host.querySelector('#fpTradingViewBridge');
assert.ok(first,'mount should insert the TradingView bridge into the Paper Arena');
assert.match(first._innerHTML,/fpTvAlertInbox/,'bridge should include a secure alert inbox');
assert.match(first._innerHTML,/"token":"PASTE_RENDER_SHARED_SECRET"/,'bridge should provide a non-secret alert JSON template');
assert.match(first._innerHTML,/\\{\\{ticker\\}\\}/,'template should use TradingView ticker placeholder');
const inboxToken=first.querySelector('#fpTvAlertToken');
inboxToken.value='test-shared-secret-not-stored';
first.querySelector('#fpTvAlertLoad').fire('click');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(inboxFetchCalls,1,'loading the inbox should call the authenticated GET endpoint');
assert.match(first.querySelector('#fpTvAlertStatus').textContent,/Authenticated/);
assert.match(first.querySelector('#fpTvAlerts').textContent,/NASDAQ:AAPL · BUY · RECEIVED_UNVERIFIED/);
assert.equal(first.querySelector('#fpTvAlertToken').value,'test-shared-secret-not-stored','secret remains in the current page control only');
api.mount();
assert.equal(host._children.filter(x=>x.id==='fpTradingViewBridge').length,1,'repeated mount must not duplicate an existing bridge');

// Paper Arena calls paperLab(), which replaces host.innerHTML after its loading placeholder.
host.innerHTML='<div>Paper Arena final render</div>';
assert.equal(host.querySelector('#fpTradingViewBridge'),null,'simulated Paper Arena render should remove the old bridge');
api.mount();
const remounted=host.querySelector('#fpTradingViewBridge');
assert.ok(remounted,'mount should restore the bridge after Paper Arena replaces its contents');
assert.notEqual(remounted,first);

remounted.querySelector('#fpTvPaper').fire('click');
assert.equal(ticket.value,'AAPL','paper handoff should copy the selected symbol into the paper ticket');
assert.equal(refreshPaperCalls,1,'paper handoff may refresh quote verification but must not submit an order');
assert.match(status.textContent,/Checking verified market data for AAPL/);
const symbolControl=remounted.querySelector('#fpTvSymbol');
const marketControl=remounted.querySelector('#fpTvMarket');
symbolControl.value='INFY.BO';
marketControl.value='INDIA';
remounted.querySelector('#fpTvPaper').fire('click');
assert.equal(ticket.value,'INFY.BO','BSE listing identity must survive the complete TradingView → paper-ticket handoff');
assert.equal(refreshPaperCalls,2,'symbol handoff may refresh verification but must never submit an order');
assert.match(status.textContent,/Checking verified market data for INFY\.BO/);
assert.equal(api.tvSymbol('INFY.BO','INDIA'),'BSE:INFY');
assert.equal(api.tvSymbol('RELIANCE.NS','CRYPTO'),'NSE:RELIANCE');
assert.equal(api.analysisSymbol('BTC','CRYPTO'),'BTCUSDT');
assert.equal(api.analysisSymbol('BINANCE:BTCUSDT','AUTO'),'BTCUSDT');
assert.equal(api.analysisSymbol('RELIANCE','INDIA'),'RELIANCE.NS');
assert.equal(api.analysisSymbol('INFY.BO','INDIA'),'INFY.BO');
assert.equal(api.analysisSymbol('NASDAQ:AAPL','US'),'AAPL');
assert.equal(api.analysisSymbol('BSE:INFY','AUTO'),'INFY.BO');
assert.equal(api.analysisSymbol('','US'),'');
console.log('tradingview-paper-bridge: symbol safety, remount lifecycle, and paper handoff checks passed');
