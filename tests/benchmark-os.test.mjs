import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('public/benchmark-os.js','utf8');
assert.ok(src.includes("Array.from({length:1000"));
assert.ok(src.includes("const domains=["));
const matches=[...src.matchAll(/\['[^']+','[^']+'\]/g)];
assert.equal(matches.length,20);
assert.ok(src.includes("runBatch(1000)"));
assert.ok(src.includes("human comparison"));
const chat=fs.readFileSync('public/chat-copilot.js','utf8');
assert.ok(chat.includes('FINPILOT CHAT COPILOT'));
assert.ok(chat.includes('/api/ai'));
assert.ok(chat.includes('/api/stock-report'));
console.log('benchmark/chat contract ok');
