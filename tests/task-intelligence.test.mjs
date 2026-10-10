import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planFinancialTask,buildSupplementalDiscovery,filterFinancialSearchResults,getSourceCatalog} from '../server/task-intelligence.mjs';
const indian=planFinancialTask('Analyse IRFC for intraday trading with ₹1,000');
assert.equal(indian.assetClass,'INDIAN_EQUITY'); assert.equal(indian.taskType,'TRADE_SCENARIO'); assert.equal(indian.needsQuote,true);
assert.ok(indian.sourcePlan.some(x=>x.id==='nse')); assert.ok(indian.sourcePlan.some(x=>x.id==='bse')); assert.ok(!indian.sourcePlan.some(x=>x.id==='binance')); assert.ok(indian.requiredData.includes('provider_timestamp'));
const crypto=planFinancialTask('Analyse BTC/USDT live');
assert.equal(crypto.assetClass,'CRYPTO'); assert.ok(crypto.sourcePlan.some(x=>x.id==='binance')); assert.ok(crypto.sourcePlan.some(x=>x.id==='kraken')); assert.ok(crypto.sourcePlan.some(x=>x.id==='coinbase'));
const options=planFinancialTask('NIFTY option chain for tomorrow expiry and implied volatility');
assert.equal(options.assetClass,'OPTIONS'); assert.equal(options.taskType,'DERIVATIVES_ANALYSIS'); assert.ok(options.requiredData.includes('contract_specification')); assert.ok(options.sourcePlan.some(x=>x.id==='nse'));
const global=planFinancialTask('Analyse Nvidia stock for next 30 days');
assert.equal(global.assetClass,'GLOBAL_EQUITY'); assert.ok(global.sourcePlan.some(x=>x.id==='sec')); assert.ok(!global.sourcePlan.some(x=>x.id==='binance'));
const indianDiscovery=buildSupplementalDiscovery(indian);
assert.equal(indianDiscovery.sourceRole,'TASK_SPECIFIC_DISCOVERY');
assert.equal(indianDiscovery.quoteEligible,false);
assert.equal(indianDiscovery.executionEligible,false);
assert.match(indianDiscovery.query,/NSE BSE/);
assert.equal(indianDiscovery.assetClass,'INDIAN_EQUITY');
const globalDiscovery=buildSupplementalDiscovery(global);
assert.match(globalDiscovery.query,/SEC filings/);
const cryptoPair=planFinancialTask('Analyse BTC/USDT live');
assert.equal(cryptoPair.instrument.queryToken,'BTC/USDT');
const cryptoDiscovery=buildSupplementalDiscovery(cryptoPair);
assert.match(cryptoDiscovery.query,/Coinbase Kraken Binance/);
const optionsDiscovery=buildSupplementalDiscovery(options);
assert.match(optionsDiscovery.query,/option chain expiry contract specifications/);
const serverContract=readFileSync(new URL('../server/server.mjs',import.meta.url),'utf8');
assert.match(serverContract,/POST'&&u\.pathname==='\/api\/task-research'/,'a task research endpoint should expose the supplemental source discovery flow');
assert.match(serverContract,/searchWeb\(discovery\.query,\{count:4,freeOnly:true\}\)/,'supplemental discovery must stay free-only and limited to four results');
assert.match(serverContract,/filterFinancialSearchResults\(rawResults,plan\)/,'task-specific symbol search must filter unrelated acronym matches');
assert.match(serverContract,/searchContextQuery/,'bare ticker queries use financial context');
assert.match(serverContract,/SBC:'SBC\.NS'/,'SBC market data must resolve to its intended NSE listing');
assert.match(serverContract,/LIVE_EQUITY_QUOTE_UNAVAILABLE_HISTORICAL_CHART_USED/,'delayed charts remain execution-ineligible');
assert.match(serverContract,/filterFinancialSearchResults\(rawResults,plan\)/,'task-specific symbol search must remove unrelated acronym results');
assert.match(serverContract,/searchContextQuery/,'bare ticker search must include financial context while preserving the user query');
assert.match(serverContract,/quoteEligible:false/,'supplemental headlines must never be eligible market quotes');
const lowercaseSbc=planFinancialTask('sbc');
assert.equal(planFinancialTask('irfc').assetClass,'INDIAN_EQUITY','lowercase Indian tickers must route through the shared symbol registry');
assert.equal(planFinancialTask('TCS.NS').assetClass,'INDIAN_EQUITY','exchange-qualified India tickers must route correctly');
assert.equal(planFinancialTask('MSFT').assetClass,'GLOBAL_EQUITY','global tickers must use the generic equity path');
assert.equal(planFinancialTask('AAPL').assetClass,'GLOBAL_EQUITY','global ticker support must not depend on one example');
assert.equal(lowercaseSbc.assetClass,'INDIAN_EQUITY','lowercase ticker queries must resolve to the same instrument class');
assert.equal(lowercaseSbc.instrument.queryToken,'SBC','ticker identity must be case-normalized before discovery');
assert.equal(lowercaseSbc.instrument.explicitSymbol,true,'bare lowercase ticker must be recognized as an explicit symbol');
const bareSbc=planFinancialTask('SBC');
assert.equal(bareSbc.assetClass,'INDIAN_EQUITY','bare SBC ticker must use the Indian-equity route, not generic web research');
assert.equal(bareSbc.taskType,'MARKET_DATA_ANALYSIS','bare ticker queries must be handled as market-data analysis');
assert.equal(bareSbc.instrument.queryToken,'SBC','bare SBC input must keep its ticker identity');
assert.equal(bareSbc.needsQuote,true,'ticker market analysis requires verified price data');
const sbcDiscovery=buildSupplementalDiscovery(bareSbc);
assert.match(sbcDiscovery.query,/NSE BSE official exchange/i,'Indian tickers must use exchange-specific discovery hints');
assert.doesNotMatch(sbcDiscovery.query,/SBC Exports Ltd/i,'discovery must not use a ticker-specific query override');
assert.equal(bareSbc.forecastPolicy,'REQUIRE_VALIDATED_MARKET_DATA','stale prices must not unlock an unverified forecast');
const msftSupplementalDiscovery=buildSupplementalDiscovery(planFinancialTask('MSFT'));
assert.match(msftSupplementalDiscovery.query,/SEC filings/,'global tickers must use global issuer research hints');
const msftResults=filterFinancialSearchResults([
 {title:'Microsoft (MSFT) Q4 earnings beat estimates',snippet:'Microsoft revenue and cloud growth topped analyst expectations.'},
 {title:'NFL scores and results',snippet:'Sports results and league news.'}
],planFinancialTask('MSFT'));
assert.equal(msftResults.length,1,'ticker search must retain financial headlines and drop unrelated sports');
const sbcResults=filterFinancialSearchResults([
 {title:'SBC Exports share price rises after quarterly financial results',snippet:'NSE listed company reports revenue and profit growth.'},
 {title:'Introducing the SBC football player of the week',snippet:'A football star wins a local award.'},
 {title:'Powerful 16-core SBC computer with 128 GB RAM',snippet:'A single-board computer goes official.'},
 {title:'SBC Awards Lisboa 2026',snippet:'Gaming supplier award ceremony.'}
],bareSbc);
assert.equal(sbcResults.length,1,'ticker discovery must filter sports, hardware and unrelated acronym matches');
assert.match(sbcResults[0].title,/share price/i);

const research=planFinancialTask('Why did Reliance announce an acquisition?');
assert.equal(research.taskType,'NEWS_OR_FUNDAMENTAL_RESEARCH'); assert.equal(research.forecastPolicy,'RESEARCH_ONLY');
assert.ok(indian.sourcePlan.some(x=>x.id==='tej-eod'));
assert.equal(getSourceCatalog().find(x=>x.id==='tej-eod').liveCapability,'END_OF_DAY');
assert.ok(getSourceCatalog().find(x=>x.id==='tej-eod').dataTypes.includes('historical_ohlcv'));
assert.ok(getSourceCatalog().length>=10); assert.equal(getSourceCatalog().find(x=>x.id==='google-news').liveCapability,'HEADLINES_ONLY');
console.log('task-intelligence: asset routing, source plans and quote safety checks passed');
