import fs from 'node:fs';
import assert from 'node:assert/strict';

const frontend = fs.readFileSync(new URL('../public/market-data-os.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8');

assert.match(frontend, /\/api\/market-data-stream\?ticker=/, 'frontend should connect to the market-data stream endpoint');
assert.doesNotMatch(frontend, /new EventSource\('\/api\/market-stream\?ticker=/, 'frontend should not use the legacy crypto-only stream');
assert.match(frontend, /d\.verified&&d\.status==='LIVE'/, 'stream data must be verified and LIVE before being shown as live');
assert.match(frontend, /x\.live===true&&asOf&&Number\.isFinite\(Date\.parse\(asOf\)\)/, 'fallback report must have explicit live flag and valid timestamp');
assert.match(frontend, /NON-LIVE · ANALYSIS ONLY/, 'non-live fallback must be labelled analysis-only');
assert.match(server, /\/api\/market-data-stream/);
assert.match(server, /createMarketStreamHub/, 'server should use the shared SSE polling hub');
assert.match(server, /createProviderResponseCache/, 'market routes should share a bounded provider-response cache');
assert.match(server, /PROVIDER_RESPONSE_CACHE\.get\(url/, 'both provider JSON adapters should deduplicate identical URLs');
assert.match(server, /Number\(x\.closeTime\)>0\?new Date\(Number\(x\.closeTime\)\)\.toISOString\(\)/, 'Binance timestamps should be sourced from provider closeTime');
assert.match(server, /sourceTimestampType==='PROVIDER_TIMESTAMP'/, 'crypto market reports should distinguish provider timestamps from observation timestamps');

assert.match(server, /MARKET_STREAM_HUB\.subscribe/, 'each SSE connection should subscribe to a shared channel');
assert.match(frontend, /addEventListener\('open',[\s\S]*?stopFallback\(\)/, 'healthy SSE open should stop redundant stock-report polling');
assert.match(frontend, /else if\(!streamOpen\)startFallback\(\)/, 'fallback polling should only run while the stream is not open');
assert.doesNotMatch(frontend, /fetch\('\/api\/market-ingest'/, 'browser tabs should not duplicate market tick ingestion');
assert.match(server, /storeMarketTick\(tick\)/, 'the shared server poll should ingest each verified tick once');
assert.match(server, /FINPILOT_MARKET_CACHE_MS\|\|15000/);
assert.match(server, /FINPILOT_YAHOO_COOLDOWN_MS\|\|60000/);

console.log('Market data stream contract checks passed.');
