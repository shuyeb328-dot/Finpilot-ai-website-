import fs from 'node:fs';
import assert from 'node:assert/strict';

const frontend = fs.readFileSync(new URL('../public/market-data-os.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8');

assert.match(frontend, /\/api\/market-data-stream\?ticker=/, 'frontend should connect to the market-data stream endpoint');
assert.doesNotMatch(frontend, /new EventSource\('\/api\/market-stream\?ticker=/, 'frontend should not use the legacy crypto-only stream');
assert.match(frontend, /d\.verified&&d\.status==='LIVE'/, 'stream data must be verified and LIVE before being shown as live');
assert.match(frontend, /x\.live===true&&asOf&&Number\.isFinite\(Date\.parse\(asOf\)\)/, 'fallback report must have explicit live flag and valid timestamp');
assert.match(frontend, /END-OF-DAY · ANALYSIS ONLY/, 'historical EOD fallback must be labelled analysis-only');
assert.match(frontend, /STALE · DO NOT TRADE/, 'stale or unknown market data must be visibly blocked from trading');
assert.match(frontend, /DELAYED · ANALYSIS ONLY/, 'delayed market data must be labelled analysis-only');
assert.match(server, /\/api\/market-data-stream/);
assert.match(server, /\/api\/instrument-search/, 'dynamic ticker and issuer resolution endpoint must be registered');
assert.match(server, /query1\.finance\.yahoo\.com\/v1\/finance\/search/, 'instrument lookup must use the live instrument directory');
assert.match(server, /selectPrimaryMarketQuote\(quotes,timestampState\)/, 'market quote selection should prefer a fresh provider timestamp');
assert.match(server, /price:winner\.price/, 'the exposed price must come from the provider named in the response');
assert.match(server, /sourceReady=Boolean\(winner\.live!==false&&primaryTimestampValid/, 'the execution safety gate must continue to require provider timestamp provenance');
assert.match(server, /createMarketStreamHub/, 'server should use the shared SSE polling hub');
assert.match(server, /createProviderResponseCache/, 'market routes should share a bounded provider-response cache');
assert.match(server, /PROVIDER_RESPONSE_CACHE\.get\(url/, 'both provider JSON adapters should deduplicate identical URLs');
assert.match(server, /Number\(x\.closeTime\)>0\?new Date\(Number\(x\.closeTime\)\)\.toISOString\(\)/, 'Binance timestamps should be sourced from provider closeTime');
assert.match(server, /sourceTimestampType==='PROVIDER_TIMESTAMP'/, 'crypto market reports should distinguish provider timestamps from observation timestamps');
assert.match(server, /executionEligible:false,executionSafetyReason:'UNOFFICIAL_SINGLE_SOURCE_NOT_CORROBORATED'/, 'unofficial single-source equity chart data must never be paper-execution eligible');
assert.match(server, /independentProviderCount=new Set\(quotes\.map\(x=>String\(x\.provider\|\|''\)\.trim\(\)\.toLowerCase\(\)\)\.filter\(Boolean\)\)\.size/, 'market data execution must count distinct providers rather than accept one quote as corroboration');
assert.match(server, /INSUFFICIENT_INDEPENDENT_PROVIDERS/, 'one-provider market data must be held for verification');

assert.match(server, /MARKET_STREAM_HUB\.subscribe/, 'each SSE connection should subscribe to a shared channel');
assert.match(frontend, /addEventListener\('open',[\s\S]*?stopFallback\(\)/, 'healthy SSE open should stop redundant stock-report polling');
assert.match(frontend, /else if\(!streamOpen\)startFallback\(\)/, 'fallback polling should only run while the stream is not open');
assert.doesNotMatch(frontend, /fetch\('\/api\/market-ingest'/, 'browser tabs should not duplicate market tick ingestion');
assert.match(server, /storeMarketTick\(tick\)/, 'the shared server poll should ingest each verified tick once');
assert.match(server, /FINPILOT_MARKET_CACHE_MS\|\|15000/);
assert.match(server, /FINPILOT_YAHOO_COOLDOWN_MS\|\|60000/);


assert.match(server,/fetchTejHqEod\(t,\{allowedSymbols:Object\.keys\(INDIA_EQUITIES\)\}\)/,'Indian equity EOD fallback must be restricted to Indian symbols');
assert.match(server,/LIVE_EQUITY_QUOTE_UNAVAILABLE_EOD_FALLBACK_USED/,'EOD fallback must announce that live quotes were unavailable');
assert.match(server,/PRIMARY_EQUITY_QUOTE_STALE_OR_NON_LIVE/,'stale or non-live primary equity quotes must trigger the EOD fallback path');
assert.match(server,/report\?\.live===false/,'a non-live primary quote must never be accepted as fresh merely because retrieval succeeded');
assert.match(server,/fetchTejHqEod\(raw,\{allowedSymbols:Object\.keys\(INDIA_EQUITIES\)\}\)/,'Market Data OS may expose EOD context only as a fallback');
assert.match(server,/const primaryStale=!liveQuoteOk\|\|!primary\|\|primary\.live===false/,'Market Data OS must treat successful-but-non-live primary quotes as stale');
assert.match(server,/primaryAgeMs>EXECUTION_FRESHNESS_MS/,'Market Data OS must trigger fallback when a primary timestamp is older than the execution freshness threshold');
assert.match(server,/if\(primary\)quotes\.splice\(quoteCountBeforePrimary\)/,'stale primary quote must not outrank the EOD analysis fallback');
assert.match(server,/executionReady=Boolean\(verified&&winner\.live!==false/,'EOD fallback must remain execution-ineligible');
assert.match(server,/TejHQ public EOD/,'EOD source must retain its explicit provider provenance');

console.log('Market data stream contract checks passed.');
