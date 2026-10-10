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
assert.match(ui,/No automatic promotion/, 'console makes promotion safeguards visible');
assert.match(ui,/No real-money execution/, 'console makes the non-execution boundary visible');
assert.doesNotMatch(ui,/setInterval\(/, 'the console must not start a recurring learning timer');
assert.match(api,/u\.pathname==='\/api\/agent-evaluation\/run'/, 'server exposes the controlled evaluation runner');
assert.match(api,/u\.pathname==='\/api\/agent-evaluation\/grade'/, 'server exposes decision output grading');
console.log('Agent Evaluation Console UI: explicit user trigger, status/history, and safety disclosure checks passed');
