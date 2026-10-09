import fs from 'node:fs';
import assert from 'node:assert/strict';

const moduleText = fs.readFileSync(new URL('../public/one-click-analysis.js', import.meta.url), 'utf8');
const pageText = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
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
assert.doesNotMatch(moduleText, /function mountSearchCard\(/, 'duplicate analysis launcher cards must not be injected');

assert.match(pageText, /async function fpFetchJson\(/, 'search endpoint must bound fetch and JSON parsing');
assert.match(pageText, /window\.__fpSearchSequence/, 'searches need monotonically increasing sequence IDs');
assert.match(pageText, /searchSequence!==window\.__fpSearchSequence/, 'stale search responses must not overwrite newer results');
assert.match(pageText, /markFinpilotSearchDirty\(this\.value\)/, 'editing/clearing the query must invalidate stale results');
assert.match(pageText, /one-click-analysis\.js\?v=20261009-2/, 'rebuilt one-click module must use a new asset version');
assert.doesNotMatch(launcher, /finpilotDirectOneClick\(/, 'launcher must not fall back to a separate, unbounded analysis implementation');
assert.match(launcher, /finally\s*\{\s*restore\(\)/, 'launcher controls must always be restored');

console.log('one-click-pipeline: 16 contract checks passed');
