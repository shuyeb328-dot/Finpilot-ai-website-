import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const required=[
  'Edit numbers',
  'Start with zero',
  'saveDashboardNumbers',
  'zeroDashboardEditor',
  'researchlab',
  'runResearchLab',
  'FinPilotResearch'
];
for(const marker of required) assert.ok(html.includes(marker),`Missing dashboard/research marker: ${marker}`);
assert.ok(html.includes('id="editCash"'));
assert.ok(html.includes('id="editIncome"'));
assert.ok(html.includes('researchPrices'));
assert.ok(html.includes("researchRuns:Array.isArray(state.researchRuns)"));
console.log('Dashboard edit + research UI tests passed');
