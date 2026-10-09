import {GLOBAL_INDEXES, GLOBAL_STOCK_TEST_SET} from './global-market-registry.mjs';

const INSTRUMENTS = [
  {symbol:'MSFT',name:'Microsoft Corporation',shortName:'Microsoft',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Microsoft','Microsoft Corp']},
  {symbol:'AAPL',name:'Apple Inc.',shortName:'Apple',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Apple','Apple Computer']},
  {symbol:'NVDA',name:'NVIDIA Corporation',shortName:'NVIDIA',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['NVIDIA','Nvidia Corp']},
  {symbol:'AMZN',name:'Amazon.com, Inc.',shortName:'Amazon',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Amazon','Amazon.com']},
  {symbol:'GOOGL',name:'Alphabet Inc. Class A',shortName:'Alphabet Class A',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Google','Alphabet','Alphabet Class A']},
  {symbol:'GOOG',name:'Alphabet Inc. Class C',shortName:'Alphabet Class C',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Alphabet Class C']},
  {symbol:'META',name:'Meta Platforms, Inc.',shortName:'Meta Platforms',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Meta','Facebook']},
  {symbol:'TSLA',name:'Tesla, Inc.',shortName:'Tesla',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Tesla']},
  {symbol:'BRK.B',name:'Berkshire Hathaway Inc. Class B',shortName:'Berkshire Hathaway Class B',exchange:'NYSE',quoteType:'EQUITY',aliases:['Berkshire Hathaway','Berkshire Class B']},
  {symbol:'JPM',name:'JPMorgan Chase & Co.',shortName:'JPMorgan Chase',exchange:'NYSE',quoteType:'EQUITY',aliases:['JPMorgan','JP Morgan','JPMorgan Chase']},
  {symbol:'V',name:'Visa Inc.',shortName:'Visa',exchange:'NYSE',quoteType:'EQUITY',aliases:['Visa']},
  {symbol:'MA',name:'Mastercard Incorporated',shortName:'Mastercard',exchange:'NYSE',quoteType:'EQUITY',aliases:['Mastercard']},
  {symbol:'WMT',name:'Walmart Inc.',shortName:'Walmart',exchange:'NASDAQ',quoteType:'EQUITY',aliases:['Walmart']},
  {symbol:'XOM',name:'Exxon Mobil Corporation',shortName:'Exxon Mobil',exchange:'NYSE',quoteType:'EQUITY',aliases:['Exxon Mobil','Exxon']},
  {symbol:'SPY',name:'SPDR S&P 500 ETF Trust',shortName:'SPDR S&P 500 ETF',exchange:'NYSE Arca',quoteType:'ETF',aliases:['SPDR S&P 500','S&P 500 ETF']},
  {symbol:'QQQ',name:'Invesco QQQ Trust',shortName:'Invesco QQQ',exchange:'NASDAQ',quoteType:'ETF',aliases:['Invesco QQQ','Nasdaq 100 ETF']},
  {symbol:'VOO',name:'Vanguard S&P 500 ETF',shortName:'Vanguard S&P 500',exchange:'NYSE Arca',quoteType:'ETF',aliases:['Vanguard S&P 500 ETF']},
  {symbol:'BTC',name:'Bitcoin',shortName:'Bitcoin',exchange:'Crypto',quoteType:'CRYPTOCURRENCY',aliases:['Bitcoin','BTCUSD','BTCUSDT']},
  {symbol:'ETH',name:'Ethereum',shortName:'Ethereum',exchange:'Crypto',quoteType:'CRYPTOCURRENCY',aliases:['Ethereum','ETHUSD','ETHUSDT']},
  {symbol:'SOL',name:'Solana',shortName:'Solana',exchange:'Crypto',quoteType:'CRYPTOCURRENCY',aliases:['Solana','SOLUSD','SOLUSDT']},
  {symbol:'BNB',name:'BNB',shortName:'BNB',exchange:'Crypto',quoteType:'CRYPTOCURRENCY',aliases:['Binance Coin']},
  {symbol:'XRP',name:'XRP',shortName:'XRP',exchange:'Crypto',quoteType:'CRYPTOCURRENCY',aliases:['Ripple']}
];

const INDIA_EQUITIES = [
  ['TCS','TCS.NS','Tata Consultancy Services Limited'],['INFY','INFY.NS','Infosys Limited'],
  ['RELIANCE','RELIANCE.NS','Reliance Industries Limited'],['GAIL','GAIL.NS','GAIL India Limited'],
  ['HINDZINC','HINDZINC.NS','Hindustan Zinc Limited'],['ITC','ITC.NS','ITC Limited'],
  ['TATAPOWER','TATAPOWER.NS','Tata Power Company Limited'],['TATASTEEL','TATASTEEL.NS','Tata Steel Limited'],
  ['SUNPHARMA','SUNPHARMA.NS','Sun Pharmaceutical Industries Limited'],['TRENT','TRENT.NS','Trent Limited'],
  ['TECHM','TECHM.NS','Tech Mahindra Limited'],['HCLTECH','HCLTECH.NS','HCL Technologies Limited'],
  ['INDIGO','INDIGO.NS','InterGlobe Aviation Limited'],['JUBLFOOD','JUBLFOOD.NS','Jubilant FoodWorks Limited'],
  ['PAYTM','PAYTM.NS','One 97 Communications Limited'],['IRFC','IRFC.NS','Indian Railway Finance Corporation Limited'],
  ['SBIN','SBIN.NS','State Bank of India'],['HDFCBANK','HDFCBANK.NS','HDFC Bank Limited'],
  ['ICICIBANK','ICICIBANK.NS','ICICI Bank Limited'],['BHARTIARTL','BHARTIARTL.NS','Bharti Airtel Limited'],
  ['LT','LT.NS','Larsen & Toubro Limited'],['ADANIPORTS','ADANIPORTS.NS','Adani Ports and Special Economic Zone Limited'],
  ['BAJFINANCE','BAJFINANCE.NS','Bajaj Finance Limited'],['HINDALCO','HINDALCO.NS','Hindalco Industries Limited'],
  ['WIPRO','WIPRO.NS','Wipro Limited'],['MARUTI','MARUTI.NS','Maruti Suzuki India Limited'],
  ['AXISBANK','AXISBANK.NS','Axis Bank Limited'],['KOTAKBANK','KOTAKBANK.NS','Kotak Mahindra Bank Limited']
].map(([alias,symbol,name])=>({symbol,name,shortName:name.replace(/ Limited$/, ''),exchange:'NSE',quoteType:'EQUITY',aliases:[alias,name.replace(/ Limited$/, '')]}));

const INTERNATIONAL_NAMES = {
  'RY.TO':['Royal Bank of Canada','Royal Bank of Canada','TSX'],
  'SHEL.L':['Shell plc','Shell','LSE'],
  'SAP.DE':['SAP SE','SAP','XETRA'],
  'OR.PA':['L\'Oréal S.A.','L\'Oréal','Euronext Paris'],
  'NESN.SW':['Nestlé S.A.','Nestlé','SIX'],
  '7203.T':['Toyota Motor Corporation','Toyota Motor','Tokyo Stock Exchange'],
  '0700.HK':['Tencent Holdings Limited','Tencent','Hong Kong Stock Exchange'],
  '600519.SS':['Kweichow Moutai Co., Ltd.','Kweichow Moutai','Shanghai Stock Exchange'],
  '005930.KS':['Samsung Electronics Co., Ltd.','Samsung Electronics','Korea Exchange'],
  '2330.TW':['Taiwan Semiconductor Manufacturing Company','TSMC','Taiwan Stock Exchange'],
  'D05.SI':['DBS Group Holdings Ltd','DBS Group','Singapore Exchange'],
  'BHP.AX':['BHP Group Limited','BHP','ASX'],
  'VALE3.SA':['Vale S.A.','Vale','B3'],
  'WALMEX.MX':['Walmart de México y Centroamérica','Walmart de México','BMV'],
  'NPN.JO':['Naspers Limited','Naspers','Johannesburg Stock Exchange'],
  '2222.SR':['Saudi Arabian Oil Company','Saudi Aramco','Tadawul']
};
const INTERNATIONAL = GLOBAL_STOCK_TEST_SET.map(([,symbol])=>{
  const [name,shortName,exchange]=INTERNATIONAL_NAMES[symbol]||[symbol,symbol,'Global exchange'];
  return {symbol,name,shortName,exchange,quoteType:'EQUITY',aliases:[name,shortName]};
});

function key(value) {
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,'');
}

const INDEX_INSTRUMENTS = GLOBAL_INDEXES.map(row=>({
  symbol:String(row.symbol).toUpperCase(),name:row.name,shortName:row.name,
  exchange:row.country||row.region||'Index',quoteType:'INDEX',aliases:[row.name,row.country+' '+row.name]
}));

const ALL = [...INSTRUMENTS,...INDIA_EQUITIES,...INTERNATIONAL,...INDEX_INSTRUMENTS];
const DIRECTORY = new Map();
for (const row of ALL) {
  const normalized = {
    symbol:String(row.symbol).toUpperCase(),
    shortName:String(row.shortName||row.name||row.symbol),
    longName:String(row.name||row.longName||row.symbol),
    exchange:String(row.exchange||''),
    exchangeDisplay:String(row.exchange||''),
    quoteType:String(row.quoteType||'EQUITY').toUpperCase(),
    typeDisplay:String(row.quoteType||'EQUITY'),
    score:0,
    identitySource:'FINPILOT_LOCAL_REGISTRY',
    liveQuoteValidated:false
  };
  const aliases = new Set([normalized.symbol,...(row.aliases||[])]);
  if (/\.(NS|BO)$/i.test(normalized.symbol)) aliases.add(normalized.symbol.replace(/\.(NS|BO)$/i,''));
  for (const alias of aliases) {
    const k=key(alias);
    if(!k)continue;
    const prior=DIRECTORY.get(k);
    if(prior&&prior.symbol!==normalized.symbol)DIRECTORY.set(k,null);
    else if(!DIRECTORY.has(k))DIRECTORY.set(k,normalized);
  }
}

/**
 * Exact-match, dependency-free instrument identity fallback. This does not fetch
 * prices, assert exchange status, or make an instrument tradable.
 */
export function lookupLocalInstruments(query,{count=10}={}) {
  const raw=String(query||'').trim();
  if(!raw||raw.length>100)return [];
  const directKey=key(raw);
  const direct=DIRECTORY.get(directKey);
  if(direct)return [direct].slice(0,Math.max(1,Math.min(10,Number(count)||10)));
  if(DIRECTORY.has(directKey))return []; // ambiguous alias: never guess
  const withoutIntent=key(raw.replace(/\b(STOCKS?|SHARES?|TICKER|QUOTE|PRICE|CHART|FORECAST|OUTLOOK|LATEST|CURRENT|LIVE|NEWS|REPORT|PERFORMANCE|ANALYSIS|ANALYZE|ANALYSE|TODAY|NOW|BUY|SELL|TRADE|TRADING|PICK|BEST|TOP|FOR|THE|OF|TO|IN|ON|ABOUT|PLEASE|ME|MY|I|WE|US|OUR|YOUR|GIVE|TELL|CHECK|WHAT|IS|ARE|A|AN|HOW|WHY|DOES|DID|DO|CAN|COULD|WOULD|SHOULD|WHICH|THAT|ANY|SOME|ALL|COMPANY|EQUITY|MARKET|INVEST|INVESTING|INVESTMENT)\b/gi,' '));
  if(!withoutIntent)return [];
  const fallback=DIRECTORY.get(withoutIntent);
  if(fallback)return [fallback].slice(0,Math.max(1,Math.min(10,Number(count)||10)));
  return [];
}
