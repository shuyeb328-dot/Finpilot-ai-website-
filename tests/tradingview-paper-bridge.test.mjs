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
vm.runInNewContext(source,{window,document,MutationObserver:function(){},setInterval,clearInterval,Event:MockEvent,console});
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
assert.equal(api.paperSymbol('NSE:RELIANCE'),'RELIANCE');
assert.equal(api.paperSymbol('RELIANCE.NS'),'RELIANCE','Indian NSE suffix must be removed before handing a symbol to the ticket');
assert.equal(api.paperSymbol('INFY.BO'),'INFY','Indian BSE suffix must be removed before handing a symbol to the ticket');
assert.equal(api.paperSymbol('BINANCE:BTCUSDT'),'BTCUSDT');
assert.equal(api.paperSymbol('javascript:alert(1)'),''); 

api.mount();
const first=host.querySelector('#fpTradingViewBridge');
assert.ok(first,'mount should insert the TradingView bridge into the Paper Arena');
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
console.log('tradingview-paper-bridge: symbol safety, remount lifecycle, and paper handoff checks passed');
