import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../public/one-click-analysis.js',import.meta.url),'utf8');
const start=source.indexOf('  function chartSvg(a){');
const end=source.indexOf('  function mountTradingViewFallbacks(){',start);
assert.ok(start>=0&&end>start,'chartSvg renderer must exist');
const chartFunction=source.slice(start,end);
const context={
  escLocal:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))
};
vm.runInNewContext(chartFunction+'\nglobalThis.testChartSvg=chartSvg;',context);
const render=context.testChartSvg;

const candles=[
  {time:'2026-10-09T05:55:00.000Z',open:60,high:62,low:59,close:61,volume:100},
  {time:'2026-10-09T05:56:00.000Z',open:61,high:63,low:60,close:62,volume:110},
  {time:'2026-10-09T05:57:00.000Z',open:62,high:64,low:61,close:63,volume:120}
];
const eod=render({
  available:true,realtimeAvailable:false,ticker:'SBC',name:'SBC Exports',market:'INDIA_EQUITY',currency:'INR',
  candles,price:63.3,sma20:61.5,sma50:60.7,support:59,resistance:64,asOf:'2026-10-08T15:00:00+05:30'
});
assert.match(eod,/<svg/,'valid EOD candles must produce an SVG chart locally');
assert.match(eod,/Historical \/ delayed price series/,'non-live SVG must be labelled historical/delayed');
assert.match(eod,/2026-10-08/,'chart must show its source timestamp');
assert.doesNotMatch(eod,/data-tv-symbol/,'valid EOD series must not depend on TradingView to render');

const live=render({...{
  available:true,realtimeAvailable:true,ticker:'IRFC',market:'INDIA_EQUITY',currency:'INR',candles,
  price:63,sma20:62,sma50:61,support:59,resistance:64,asOf:'2026-10-09T06:00:00Z'
}});
assert.match(live,/Verified live price series/,'live chart must be labelled as live when explicitly verified');

const noSeries=render({available:false,realtimeAvailable:false,ticker:'SBC',market:'INDIA_EQUITY',candles:[]});
assert.match(noSeries,/data-tv-symbol="NSE:SBC"/,'stock without candles should use external fallback');
assert.match(noSeries,/No local candle series available/,'external fallback should explain why it is used');

const crypto=render({available:false,realtimeAvailable:false,ticker:'XRP',market:'CRYPTO',candles:[]});
assert.match(crypto,/data-tv-symbol="BINANCE:XRPUSDT"/,'crypto fallback must never route to the NSE');

const invalid=render({ticker:'SBC',market:'INDIA_EQUITY',candles:[{open:0,high:5,low:0,close:4}]});
assert.match(invalid,/data-tv-symbol="NSE:SBC"/,'invalid OHLC rows must not be drawn as a chart');

console.log('chart-fallback: 10 rendering assertions passed');
