const SOURCE_CATALOG = [
  {id:'nse',name:'NSE India',assetClasses:['INDIAN_EQUITY','INDIAN_INDEX','OPTIONS','FUTURES'],dataTypes:['quotes','ohlcv','option_chain','contracts','filings','market_status'],tier:'OFFICIAL',url:'https://www.nseindia.com/',liveCapability:'ENDPOINT_DEPENDENT',notes:'Prefer official exchange endpoints where accessible and permitted.'},
  {id:'bse',name:'BSE India',assetClasses:['INDIAN_EQUITY','INDIAN_INDEX'],dataTypes:['quotes','ohlcv','corporate_actions','filings'],tier:'OFFICIAL',url:'https://www.bseindia.com/',liveCapability:'ENDPOINT_DEPENDENT',notes:'Use for BSE listings and official disclosures.'},
  {id:'issuer',name:'Issuer investor relations',assetClasses:['INDIAN_EQUITY','GLOBAL_EQUITY'],dataTypes:['filings','earnings','fundamentals','corporate_actions'],tier:'PRIMARY',url:null,liveCapability:'DOCUMENTS',notes:'Discover the company-specific official investor-relations page per query.'},
  {id:'sec',name:'SEC EDGAR',assetClasses:['GLOBAL_EQUITY'],dataTypes:['filings','fundamentals','corporate_actions'],tier:'OFFICIAL',url:'https://www.sec.gov/edgar/search/',liveCapability:'FILINGS',notes:'US issuer filings; not a real-time quote feed.'},
  {id:'yahoo',name:'Yahoo Finance',assetClasses:['INDIAN_EQUITY','INDIAN_INDEX','GLOBAL_EQUITY','GLOBAL_INDEX','ETF','CRYPTO'],dataTypes:['instrument_lookup','quotes','ohlcv','fundamentals'],tier:'AGGREGATOR',url:'https://finance.yahoo.com/',liveCapability:'DELAYED_OR_ENDPOINT_DEPENDENT',notes:'Fallback/lookup source; timestamp and delay must be checked.'},
  {id:'coinbase',name:'Coinbase Exchange',assetClasses:['CRYPTO'],dataTypes:['quotes','ohlcv','order_book'],tier:'EXCHANGE',url:'https://www.coinbase.com/',liveCapability:'PROVIDER_TIMESTAMP_DEPENDENT',notes:'Use only for supported pairs; preserve quote currency.'},
  {id:'kraken',name:'Kraken',assetClasses:['CRYPTO'],dataTypes:['quotes','ohlcv','order_book'],tier:'EXCHANGE',url:'https://www.kraken.com/',liveCapability:'PROVIDER_TIMESTAMP_DEPENDENT',notes:'Use only for supported pairs; map pair aliases explicitly.'},
  {id:'binance',name:'Binance',assetClasses:['CRYPTO'],dataTypes:['quotes','ohlcv','order_book','derivatives'],tier:'EXCHANGE',url:'https://www.binance.com/',liveCapability:'PROVIDER_TIMESTAMP_DEPENDENT',notes:'Crypto-only provider in FinPilot routing; never universal market authority.'},
  {id:'google-news',name:'Google News RSS',assetClasses:['ALL'],dataTypes:['news','discovery'],tier:'DISCOVERY',url:'https://news.google.com/',liveCapability:'HEADLINES_ONLY',notes:'Discovery and evidence only; never a quote authority.'},
  {id:'web-search',name:'Configured web search providers',assetClasses:['ALL'],dataTypes:['discovery','news','documents'],tier:'DISCOVERY',url:null,liveCapability:'HEADLINES_OR_DOCUMENTS',notes:'Use currently configured provider; do not assume Google API is available.'},
  {id:'tej-eod',name:'TejHQ EOD',assetClasses:['INDIAN_EQUITY'],dataTypes:['historical_ohlcv'],tier:'AGGREGATOR',url:'https://api.tejhq.dev/',liveCapability:'END_OF_DAY',notes:'Historical/EOD fallback only; never label as live.'}
];
const SOURCE_IDS = {
  INDIAN_EQUITY:['nse','bse','issuer','yahoo','web-search'], INDIAN_INDEX:['nse','bse','yahoo','web-search'],
  GLOBAL_EQUITY:['issuer','sec','yahoo','web-search'], GLOBAL_INDEX:['yahoo','web-search'],
  CRYPTO:['coinbase','kraken','binance','yahoo','web-search'], OPTIONS:['nse','bse','web-search'],
  FUTURES:['nse','bse','web-search'], FOREX:['yahoo','web-search'], COMMODITY:['yahoo','web-search'],
  REAL_ESTATE:['web-search'], FINANCIAL_RESEARCH:['issuer','sec','nse','bse','web-search','google-news'],
  GENERAL_FINANCE:['web-search','google-news']
};
const INDEX_TERMS=/\b(nifty|sensex|bank nifty|nifty bank|index|indices|s\s*&\s*p\s*500|nasdaq composite|dow jones|ftse 100|nikkei)\b/i;
const CRYPTO_TERMS=/\b(crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|sol|usdt|token|coinbase|binance|kraken)\b/i;
const OPTION_TERMS=/\b(option chain|options?|call option|put option|strike price|implied volatility|open interest|greeks|expiry|expir(y|ation)|ce\b|pe\b)/i;
const FUTURE_TERMS=/\b(futures?|f\s*&\s*o|lot size|open interest|contract expiry)\b/i;
const FOREX_TERMS=/\b(forex|fx|currency pair|usd\s*[/ -]\s*inr|eur\s*[/ -]\s*usd|gbp\s*[/ -]\s*usd|exchange rate)\b/i;
const COMMODITY_TERMS=/\b(gold|silver|crude oil|natural gas|commodity|commodities|copper)\b/i;
const PROPERTY_TERMS=/\b(real estate|property|rental yield|housing market|land price|property investment)\b/i;
const NEWS_TERMS=/\b(why|news|headline|earnings|results|filing|annual report|quarterly report|acquisition|merger|lawsuit|regulation|announcement)\b/i;
const PRICE_TERMS=/\b(price|quote|live|current|today|intraday|chart|candles?|rsi|support|resistance|forecast|prediction|buy|sell|trade|trading|stop.?loss|target)\b/i;
function cleanQuery(query){return String(query||'').replace(/\s+/g,' ').trim().slice(0,500);}
function resolveAssetClass(q){
 if(CRYPTO_TERMS.test(q))return 'CRYPTO';
 if(OPTION_TERMS.test(q))return 'OPTIONS';
 if(FUTURE_TERMS.test(q))return 'FUTURES';
 if(FOREX_TERMS.test(q))return 'FOREX';
 if(COMMODITY_TERMS.test(q))return 'COMMODITY';
 if(PROPERTY_TERMS.test(q))return 'REAL_ESTATE';
 if(INDEX_TERMS.test(q))return /nifty|sensex|bank nifty/i.test(q)?'INDIAN_INDEX':'GLOBAL_INDEX';
 if(/\b(nse|bse|irfc|reliance|tata motors|tcs|infosys|sbin|hdfc|icici|indian stock|india stock)\b/i.test(q))return 'INDIAN_EQUITY';
 if(/\b(nyse|nasdaq|nyse-listed|us stock|american stock|tesla|nvidia|apple stock|microsoft stock|aapl|nvda|tsla|msft)\b/i.test(q))return 'GLOBAL_EQUITY';
 if(NEWS_TERMS.test(q)&&!PRICE_TERMS.test(q))return 'FINANCIAL_RESEARCH';
 if(/\b(stock|share|equity|ticker|company|etf|fund)\b/i.test(q))return 'GLOBAL_EQUITY';
 return 'GENERAL_FINANCE';
}
function resolveTaskType(q,assetClass){
 if(PROPERTY_TERMS.test(q))return 'PROPERTY_RESEARCH';
 if(OPTION_TERMS.test(q)||FUTURE_TERMS.test(q))return 'DERIVATIVES_ANALYSIS';
 if(NEWS_TERMS.test(q)&&!PRICE_TERMS.test(q))return 'NEWS_OR_FUNDAMENTAL_RESEARCH';
 if(/\b(compare|versus|vs|best|top|screen|scan)\b/i.test(q))return 'COMPARISON_OR_SCREEN';
 if(/\b(buy|sell|trade|trading|intraday|stop.?loss|target|entry|exit|position size)\b/i.test(q))return 'TRADE_SCENARIO';
 if(/\b(forecast|prediction|predict|outlook|next \d+ days?)\b/i.test(q))return 'FORECAST';
 if(PRICE_TERMS.test(q)||['CRYPTO','OPTIONS','FUTURES','FOREX','COMMODITY','INDIAN_INDEX','GLOBAL_INDEX'].includes(assetClass))return 'MARKET_DATA_ANALYSIS';
 if(assetClass==='FINANCIAL_RESEARCH')return 'NEWS_OR_FUNDAMENTAL_RESEARCH';
 return 'GENERAL_RESEARCH';
}
function inferInstrument(q){
 const cryptoPair=String(q||'').toUpperCase().match(/\b([A-Z0-9]{2,15})\s*[/ -]\s*(USDT|USDC|USD|EUR|BTC|ETH)\b/);
 if(cryptoPair)return {queryToken:cryptoPair[1]+'/'+cryptoPair[2],explicitSymbol:true,confidence:'MEDIUM'};
 const raw=q.match(/\b[A-Z]{1,6}(?:\.(?:NS|BO|L|TO|AX|DE|PA|HK|T|SW))?\b/g)||[];
 const stop=new Set(['I','A','AI','CEO','CFO','RSI','SMA','EMA','USD','INR','USDT','BTC','ETH','NSE','BSE','NYSE','NASDAQ','ETF','FNO','PE','CE','BUY','SELL','LIVE','TODAY','BEST','TOP','AND','THE','FOR','WITH','FROM']);
 const symbol=raw.find(x=>!stop.has(x)&&(/[.]/.test(x)||x.length>=2));
 if(symbol)return {queryToken:symbol,explicitSymbol:true,confidence:'MEDIUM'};
 const named=q.match(/\b(Tesla|Nvidia|Apple|Microsoft|Amazon|Alphabet|Meta|Reliance|Tata Motors|TCS|Infosys|IRFC|State Bank of India|SBI|HDFC Bank|ICICI Bank|Bitcoin|Ethereum|Solana|NIFTY 50|Bank Nifty|Sensex)\b/i);
 return named?{queryToken:named[0],explicitSymbol:false,confidence:'MEDIUM'}:{queryToken:null,explicitSymbol:false,confidence:'UNRESOLVED'};
}
export function planFinancialTask(input={}){
 const query=cleanQuery(typeof input==='string'?input:input.query),assetClass=resolveAssetClass(query),taskType=resolveTaskType(query,assetClass);
 const sources=(SOURCE_IDS[assetClass]||SOURCE_IDS.GENERAL_FINANCE).map(id=>SOURCE_CATALOG.find(x=>x.id===id)).filter(Boolean);
 const instrument=inferInstrument(query),needsQuote=['TRADE_SCENARIO','MARKET_DATA_ANALYSIS','FORECAST','DERIVATIVES_ANALYSIS'].includes(taskType);
 const requiredData=needsQuote?(assetClass==='OPTIONS'||assetClass==='FUTURES'?['instrument_identity','contract_specification','fresh_underlying_quote','fresh_contract_quote','provider_timestamp','currency','liquidity']:['instrument_identity','fresh_quote','provider_timestamp','currency','market_status']):taskType==='NEWS_OR_FUNDAMENTAL_RESEARCH'?['issuer_or_regulator_document','publication_date','source_url']:['query_relevant_sources','source_url','publication_date_when_available'];
 return {schemaVersion:1,query,taskType,assetClass,instrument,sourcePlan:sources.map((x,i)=>({...x,priority:i+1})),discoveryQuery:query,needsQuote,requiredData,rules:['Search results discover sources; they are not structured quotes.','Never replace an explicitly requested instrument with a different one.','Binance is a crypto-only source, never the sole source for equities or general finance.','Preserve source timestamp, retrieval timestamp, currency, exchange and provider provenance.','Mark delayed or historical observations accurately; never label local observation time as provider quote time.','If sources disagree materially or required data is missing, report the conflict and block market-dependent forecasts.'],forecastPolicy:needsQuote?'REQUIRE_VALIDATED_MARKET_DATA':'RESEARCH_ONLY',liveStatus:'NOT_FETCHED',disclaimer:'Routing plan only; no quote is fetched or certified live.'};
}
export function buildSupplementalDiscovery(input={}) {
 const plan = input && input.schemaVersion === 1 && input.assetClass
  ? input
  : planFinancialTask(input);
 const query = cleanQuery(plan.query);
 const focus = cleanQuery(plan.instrument?.queryToken || query).slice(0,220);
 const hints = {
  INDIAN_EQUITY:'NSE BSE official exchange company announcements results filings',
  INDIAN_INDEX:'NSE BSE official index exchange market update',
  GLOBAL_EQUITY:'issuer investor relations SEC filings earnings results',
  GLOBAL_INDEX:'official exchange index methodology market update',
  CRYPTO:'crypto exchange market update Coinbase Kraken Binance',
  OPTIONS:'NSE option chain expiry contract specifications lot size',
  FUTURES:'NSE futures contract expiry lot size official exchange',
  FOREX:'official central bank reference rate exchange update',
  COMMODITY:'official exchange commodity contract report',
  REAL_ESTATE:'official property registry regulator transaction market report',
  FINANCIAL_RESEARCH:'official filing regulator investor relations primary source',
  GENERAL_FINANCE:'official regulator primary source investor education'
 };
 const queryText=(focus+' '+(hints[plan.assetClass]||hints.GENERAL_FINANCE)).replace(/[ \t\r\n]+/g,' ').trim().slice(0,300);
 return {
  schemaVersion:1,
  originalQuery:query,
  query:queryText,
  sourceRole:'TASK_SPECIFIC_DISCOVERY',
  evidenceType:'HEADLINES_OR_DOCUMENT_DISCOVERY',
  assetClass:plan.assetClass,
  taskType:plan.taskType,
  preferredSourceFamilies:plan.sourcePlan.map(source=>source.id),
  discoveryOnly:true,
  quoteEligible:false,
  executionEligible:false,
  disclaimer:'Supplemental search discovers headlines and documents only. It is not a live price feed and cannot unlock a market forecast or paper order.'
 };
}
export function getSourceCatalog(){return SOURCE_CATALOG.map(x=>({...x,assetClasses:[...x.assetClasses],dataTypes:[...x.dataTypes]}));}
