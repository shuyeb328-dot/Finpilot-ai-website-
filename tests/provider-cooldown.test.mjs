import assert from 'node:assert/strict';
import {
  activeProviderCooldowns,
  claimProviderRequest,
  providerCooldownStatus,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderCooldownsForTests
} from '../server/provider-cooldown.mjs';

const start=1_000_000;
resetProviderCooldownsForTests();
assert.equal(providerCooldownStatus('binance',start),null,'new providers must not start in cooldown');

const first=recordProviderFailure('binance','HTTP_418',start);
assert.equal(first.active,true,'HTTP 418 must activate provider-specific cooldown');
assert.equal(first.kind,'HTTP_418','cooldown diagnostics should preserve the reason class');
assert.equal(first.retryAfterMs,60_000,'first HTTP 418 cooldown should start at one minute');
assert.equal(providerCooldownStatus('binance',start+1_000).retryAfterMs,59_000,'cooldown should report remaining time');
assert.equal(claimProviderRequest('binance',start+1_000).retryAfterMs,59_000,'active cooldown must prevent an outbound provider request');
assert.equal(providerCooldownStatus('kraken',start+1_000),null,'one provider cooldown must not block a healthy fallback provider');

const repeated=recordProviderFailure('binance','HTTP_418',start+10_000);
assert.equal(repeated.consecutiveFailures,2,'repeated rate-limit responses should increase the failure streak');
assert.equal(repeated.retryAfterMs,120_000,'repeated HTTP 418 must use bounded exponential cooldown');

const list=activeProviderCooldowns(start+10_000);
assert.equal(list.length,1,'health diagnostics should list active cooldowns only');
assert.equal(list[0].source,'binance');
assert.equal(list[0].retryAfterMs,120_000);

recordProviderSuccess('binance');
assert.equal(providerCooldownStatus('binance',start+11_000),null,'a successful provider request must clear its cooldown and failure streak');
const recovery=recordProviderFailure('binance','HTTP_418',start+30_000);
assert.equal(claimProviderRequest('binance',start+recovery.retryAfterMs+30_000),null,'the first request after cooldown expiry may claim the half-open recovery probe');
const duplicateProbe=claimProviderRequest('binance',start+recovery.retryAfterMs+30_001);
assert.equal(duplicateProbe?.halfOpen,true,'concurrent requests must not launch duplicate recovery probes');
assert.equal(duplicateProbe?.reason,'RECOVERY_PROBE_IN_PROGRESS','blocked concurrent request should explain that a recovery probe is already running');
recordProviderFailure('binance','HTTP_500',start+recovery.retryAfterMs+30_002);
assert.equal(claimProviderRequest('binance',start+recovery.retryAfterMs+30_003),null,'a non-rate-limit probe failure must release the half-open gate so a later controlled retry can proceed');
recordProviderSuccess('binance');
assert.equal(claimProviderRequest('binance',start+recovery.retryAfterMs+30_004),null,'successful recovery should clear the cooldown and probe gate');
recordProviderFailure('binance-os','HTTP_418',start+20_000);
assert.equal(providerCooldownStatus('binance',start+20_000).retryAfterMs,60_000,'binance-os and binance adapter labels must share the same upstream cooldown');
assert.equal(providerCooldownStatus('binance-os',start+20_000).source,'binance','cooldown diagnostics should use the canonical provider identity');
assert.equal(activeProviderCooldowns(start+20_000).length,1,'adapter aliases must not create duplicate active cooldown records');
recordProviderSuccess('binance-os');
assert.equal(providerCooldownStatus('binance',start+21_000),null,'success from a provider alias must clear the shared cooldown');


assert.equal(recordProviderFailure('coinbase','HTTP_404',start),null,'ordinary missing-route errors must not create rate-limit cooldowns');
const limited=recordProviderFailure('kraken','HTTP_429',start);
assert.equal(limited.kind,'RATE_LIMIT','HTTP 429 should use the rate-limit cooldown class');
assert.equal(limited.retryAfterMs,30_000,'first HTTP 429 cooldown should start at 30 seconds');
resetProviderCooldownsForTests();
assert.equal(activeProviderCooldowns(start).length,0,'test reset should clear the cooldown state');
console.log('provider-cooldown: half-open recovery checks passed');
