import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../public/agent-evolution.js',import.meta.url),'utf8');
assert.match(src,/benchmark/);
assert.match(src,/PROMOTED/);
assert.match(src,/ROLLED_BACK/);
assert.match(src,/BUILTINS/);
console.log('Agent evolution engine test passed');
