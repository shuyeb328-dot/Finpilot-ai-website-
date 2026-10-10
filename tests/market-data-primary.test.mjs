import assert from 'node:assert/strict';
import {selectPrimaryMarketQuote} from '../server/market-data-verification.mjs';

const observedOnly = {
  provider:'Kraken public',
  price:83074.3,
  latencyMs:2,
  asOf:'2026-10-09T12:33:25.591Z',
  timestampType:'OBSERVATION_TIMESTAMP',
  live:true
};
const providerTimed = {
  provider:'Coinbase public',
  price:83094.75,
  latencyMs:4,
  asOf:'2026-10-09T12:33:24.254Z',
  timestampType:'PROVIDER_TIMESTAMP',
  live:true
};
const quotes=[observedOnly,providerTimed];
const timing=[
  {provider:'Kraken public',valid:true,ageMs:1200,fresh:true},
  {provider:'Coinbase public',valid:true,ageMs:2400,fresh:true}
];

const selected=selectPrimaryMarketQuote(quotes,timing);
assert.equal(selected.provider,'Coinbase public','a fresh provider-timestamped fallback should outrank an observation-only quote');
assert.equal(selected.price,83094.75,'selected price must belong to the selected provider');
assert.equal(selected.asOf,'2026-10-09T12:33:24.254Z','selected timestamp must belong to the selected provider');
assert.equal(selected.timestampType,'PROVIDER_TIMESTAMP','selected timestamp provenance must be preserved');

const noFreshProviderTime=[
  {...observedOnly},
  {...providerTimed,asOf:'2026-10-09T12:30:00.000Z'}
];
const staleTiming=[
  {provider:'Kraken public',valid:true,ageMs:1200,fresh:true},
  {provider:'Coinbase public',valid:true,ageMs:240000,fresh:false}
];
const fallback=selectPrimaryMarketQuote(noFreshProviderTime,staleTiming);
assert.equal(fallback.provider,'Kraken public','when no fresh timestamped provider exists, preserve the original provider fallback order');
assert.equal(fallback.timestampType,'OBSERVATION_TIMESTAMP','fallback selection must not invent provider timestamp provenance');

const gateTimed = {
  provider:'Gate.io public',
  price:82790.9,
  latencyMs:7,
  asOf:'2026-10-10T08:52:13.202Z',
  timestampType:'PROVIDER_TIMESTAMP',
  live:true
};
const gateQuotes=[observedOnly,gateTimed];
const gateTiming=[
  {provider:'Kraken public',valid:true,ageMs:1200,fresh:true},
  {provider:'Gate.io public',valid:true,ageMs:11000,fresh:true}
];
const gateSelected=selectPrimaryMarketQuote(gateQuotes,gateTiming);
assert.equal(gateSelected.provider,'Gate.io public','a fresh Gate.io exchange trade timestamp must outrank Kraken observation-only fallback data');
assert.equal(gateSelected.price,82790.9,'Gate.io selected quote must retain its own price');
assert.equal(gateSelected.timestampType,'PROVIDER_TIMESTAMP','Gate.io exchange timestamp provenance must be preserved');

console.log('market-data-primary: timestamp preference, Gate.io priority, and provenance checks passed');
