import fs from 'node:fs';
import assert from 'node:assert/strict';

const moduleText = fs.readFileSync(new URL('../public/one-click-analysis.js', import.meta.url), 'utf8');
const pageText = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const deepText = fs.readFileSync(new URL('../public/deep-learning-os.js', import.meta.url), 'utf8');
const serverText = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8');
const launcherStart = pageText.indexOf('async function finpilotLaunch(q){');
const launcherEnd = pageText.indexOf('function exportJSON(', launcherStart);
assert.ok(launcherStart >= 0 && launcherEnd > launcherStart, 'single one-click launcher must exist');
const launcher = pageText.slice(launcherStart, launcherEnd);

assert.match(moduleText, /async function fetchJsonBounded\(/, 'market fetch plus JSON parsing must have a bounded deadline');
assert.match(moduleText, /fpPipelineStatus/, 'pipeline status must be outside the results container');
assert.match(moduleText, /!document\.getElementById\('search'\)\?\.classList\.contains\('active'\)/, 'analysis must not re-render an already-active search view');
assert.match(moduleText, /Analysis stopped safely/, 'a failed analysis must render a visible error');
assert.match(moduleText, /No real order was placed/, 'analysis must remain decision support only');
assert.match(moduleText, /FinPilotDecisionCore\.computeExecutiveDecision\(state,cycle\.findings,web,formatMoney,sourceAge\)/, 'Decision Core must receive the formatter function, never a scenario object');
assert.match(moduleText, /typeof window\.FinPilotBridge\?\.money==='function'/, 'use the global finance formatter when available');
assert.doesNotMatch(moduleText, /computeExecutiveDecision\(state,cycle\.findings,web,preMoney,sourceAge\)/, 'the scenario/formatter argument mismatch must not return');
assert.match(moduleText, /normalizeTicker\(directMarket\.ticker\|\|directMarket\.symbol\)!==normalizeTicker\(candidate\.ticker\)/, 'do not render a quote for a different instrument than the resolved candidate');
assert.match(deepText, /\['AXISBANK','Axis Bank Limited'\]/, 'Axis Bank must be in the known instrument registry');
assert.match(deepText, /SBI:'SBIN'/, 'SBI alias should resolve to State Bank of India ticker SBIN');
assert.match(deepText, /const normalizePhrase=text=>/, 'instrument matching must use normalized token boundaries');
assert.match(deepText, /hasPhrase\(corpus,c\[0\]\)/, 'resolver should match whole ticker/company tokens rather than substrings');
assert.doesNotMatch(deepText, /corpus\.includes\(c\[0\]\)/, 'substring-based ticker false positives must not return');
assert.match(moduleText, /\[o,h,l,c\]\.every\(v=>Number\.isFinite\(v\)&&v>0\)/, 'chart analysis must discard zero-price candles');
assert.match(moduleText, /const s20=positive\(market\.sma20\),s50=positive\(market\.sma50\)/, 'null/zero moving averages must remain unavailable');
assert.match(moduleText, /const chartPrice=value=>Number\(value\)>0\?.*:'N\/A'/, 'missing or zero-price chart indicators should render N/A instead of ₹0.00');
assert.match(serverText, /Equity provider returned insufficient valid OHLC candles/, 'server should reject a series after invalid candles are filtered');
assert.match(serverText, /x\.high>=Math\.max\(x\.open,x\.close,x\.low\)/, 'server candles must pass OHLC consistency validation');
assert.match(moduleText, /Resolved market snapshot request/, 'reload market data for the search-resolved instrument when symbols disagree');
assert.doesNotMatch(moduleText, /function mountSearchCard\(/, 'duplicate analysis launcher cards must not be injected');

assert.match(pageText, /async function fpFetchJson\(/, 'search endpoint must bound fetch and JSON parsing');
assert.match(pageText, /window\.__fpSearchSequence/, 'searches need monotonically increasing sequence IDs');
assert.match(pageText, /searchSequence!==window\.__fpSearchSequence/, 'stale search responses must not overwrite newer results');
assert.match(pageText, /markFinpilotSearchDirty\(this\.value\)/, 'editing/clearing the query must invalidate stale results');
assert.match(pageText, /one-click-analysis\.js\?v=20261009-4/, 'rebuilt one-click module must use a new asset version');
assert.doesNotMatch(launcher, /finpilotDirectOneClick\(/, 'launcher must not fall back to a separate, unbounded analysis implementation');
assert.match(launcher, /finally\s*\{\s*restore\(\)/, 'launcher controls must always be restored');

assert.match(moduleText, /Exposure gate:/, 'P/L scenario must distinguish hypothetical outcomes from approved exposure');
assert.match(moduleText, /market\.currency\|\|\(String\(market\.market\|\|''\)\.toUpperCase\(\)==='CRYPTO'\?'USD':'INR'\)/, 'quote display must default to USD for crypto and INR for equities');
assert.match(moduleText, /BINANCE:'\+ticker\.replace\(/, 'crypto chart fallback must use Binance symbol rather than NSE symbol');
assert.match(moduleText, /LATEST MARKET DATA/, 'snapshot card must not label crypto data as equity-only');
assert.match(moduleText, /hypothetical outcomes on the full ₹1,000 example/, 'P/L cards must explain the assumed scenario amount');
assert.match(serverText, /buildMarketSnapshot/, 'server should normalize provider reports into the shared snapshot schema');
assert.match(serverText, /u\.pathname==='\/api\/market-snapshot'/, 'the market snapshot endpoint must be registered');
assert.match(moduleText, /\/api\/market-snapshot/, 'one-click analysis must consume the canonical snapshot endpoint');
assert.match(moduleText, /window\.__fpMarketSnapshot=marketSnapshot/, 'one-click must expose one shared snapshot to the agent fleet');
assert.match(moduleText, /runFleet\(state,\{web,candidate,marketSnapshot:window\.__fpMarketSnapshot\}\)/, 'the agent fleet must receive the same validated snapshot');
assert.match(moduleText, /state\.forecastLedger\.unshift\(forecastRecord\)/, 'completed runs must append a forecast ledger record');
assert.match(moduleText, /BLOCKED_UNVERIFIED_DATA/, 'unverified market data must be explicitly blocked in the forecast ledger');
assert.match(deepText, /marketDataQuality/, 'agents must score market data quality as a separate feature');
assert.match(deepText, /marketSnapshotId:marketSnapshot\?\.snapshotId/, 'agent results must preserve the shared snapshot ID');

console.log('one-click-pipeline: 43 contract checks passed');
