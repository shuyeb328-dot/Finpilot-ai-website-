import assert from 'node:assert/strict';
import {cleanText} from '../server/text-sanitizer.mjs';

assert.equal(cleanText('  CEO\u0000\n Risk \t Agent  ',64),'CEO Risk Agent','control characters and repeated whitespace must be normalized');
assert.equal(cleanText(12345,4),'1234','non-string telemetry values must be safely stringified and bounded');
assert.equal(cleanText('x'.repeat(5000),9000),'x'.repeat(4000),'requested maximum must be capped to protect memory');
assert.equal(cleanText(null,20),'','null input should become an empty string');
assert.equal(cleanText('anything',0),'','zero limit should produce an empty string');
assert.equal(cleanText('  safe text  ',undefined),'safe text','default bound should trim text');
console.log('PASS text sanitizer: normalization, null handling and bounded output');
