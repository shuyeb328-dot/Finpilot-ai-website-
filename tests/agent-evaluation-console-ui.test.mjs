import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../public/agent-evaluation-console.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../server/server.mjs',import.meta.url),'utf8');

assert.match(html,/agent-evaluation-console\.js/, 'learning console is included in the deployed web page');
assert.match(ui,/\/api\/agent-evaluation\/status/, 'console reads the evaluation status endpoint');
assert.match(ui,/\/api\/agent-evaluation\/history/, 'console shows evaluation history');
assert.match(ui,/\/api\/agent-evaluation\/run/, 'console can run the test suite when clicked');
assert.match(ui,/runButton=button\('Run offline evaluation','primary',run\)/, 'evaluation must be started from an explicit user action');
assert.match(ui,/No live market or external AI requests are made/, 'evaluation behavior is described accurately');
assert.match(ui,/no automatic promotion/i, 'console makes promotion safeguards visible');
assert.match(ui,/no real-money execution/i, 'console makes the non-execution boundary visible');
assert.doesNotMatch(ui,/setInterval\(/, 'the console must not start a recurring learning timer');
assert.match(api,/u\.pathname==='\/api\/agent-evaluation\/run'/, 'server exposes the controlled evaluation runner');
assert.match(api,/AGENT_EVALUATION_RUN_LIMITER\.check\(clientKey\(req\)\)/, 'evaluation runs have a dedicated bounded rate limit');
assert.match(api,/u\.pathname==='\/api\/agent-evaluation\/grade'/, 'server exposes decision output grading');
assert.match(ui,/\/api\/ai-os\/training\/status/, 'console displays verified-only forecast-training status');
assert.match(ui,/\/api\/agent-memory/, 'console displays agent memory status');
assert.match(ui,/EPISODIC','SEMANTIC','PROCEDURAL','OUTCOME/, 'console distinguishes four memory layers');
assert.match(ui,/UNVERIFIED CLIENT/, 'console labels client-reported telemetry separately');
assert.match(api,/finpilot_agent_memory_ledger/, 'server stores memory in the existing database when configured');
assert.match(api,/CLIENT_REPORTED_UNVERIFIED/, 'client-provided telemetry remains explicitly unverified');
assert.match(ui,/data\.manualCycleAllowed===true/, 'market-training cycles stay disabled until explicitly permitted by server configuration');
assert.match(api,/manualCycleAllowed:String\(process\.env\.FINPILOT_AI_OS_MANUAL_CYCLE_ENABLED\|\|'false'\)\.toLowerCase\(\)==='true'/, 'market-training status truthfully discloses the manual cycle configuration');
console.log('Agent Evaluation Console UI: explicit user trigger, status/history, and safety disclosure checks passed');
