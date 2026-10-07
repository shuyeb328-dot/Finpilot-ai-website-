import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `Production function ${name} was not found`);

  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];

    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }

  throw new Error(`Could not extract function ${name}`);
}

const productionCode = [
  extractFunction('liveWebSignal'),
  extractFunction('runRoundTable')
].join('\n');

function runDecision({ emergency, spending = 52000, income = 90000, findings = [], evidence = [], lastSearchEvidence = null }) {
  const state = {
    emergency,
    spending,
    income,
    findings,
    evidence,
    lastSearchEvidence,
    lastEvidenceSync: new Date().toISOString(),
    decisionHistory: [],
    memory: [],
    learning: { confidenceAdjustment: 0 },
    decision: null
  };

  const context = {
    state,
    Math,
    Date,
    String,
    Number,
    RegExp,
    JSON,
    money: value => `₹${Number(value).toLocaleString('en-IN')}`,
    sourceAge: () => 'Fresh',
    refreshBrain: () => {},
    save: () => {},
    toast: () => {},
    show: () => {}
  };

  vm.runInNewContext(productionCode + '\nrunRoundTable();', context);
  return context.state.decision;
}

function liveEvidence(claims, query = 'IRFC') {
  return claims.map((claim, i) => ({
    id: `web-${i}`,
    source: 'SerpApi',
    claim,
    confidence: 72,
    type: 'Live web evidence',
    url: `https://example.com/${i}`,
    freshness: 'Fresh',
    time: new Date().toISOString()
  }));
}

// 1) Low emergency coverage: CFO must win even with positive cash flow.
{
  const decision = runDecision({
    emergency: 100000,
    spending: 52000,
    income: 90000
  });

  assert.equal(decision.executive.cfo.startsWith('Liquidity is the binding constraint'), true);
  assert.equal(decision.decision, 'CFO wins: strengthen liquidity before increasing risk');
}

// 2) Healthy liquidity but a HIGH finding: risk gate must block new risk.
{
  const decision = runDecision({
    emergency: 300000,
    spending: 50000,
    income: 90000,
    findings: [{
      domain: 'Debt',
      severity: 'HIGH',
      title: 'High-APR debt needs priority',
      detail: 'High-interest debt should be addressed first.'
    }]
  });

  assert.equal(decision.executive.cfo.startsWith('Resolve the high-severity financial findings'), true);
  assert.equal(decision.decision, 'Risk gate wins: resolve the highest-severity finding before adding new risk');
}

// 3) Healthy liquidity + no high findings + positive web signal: CEO can lead selectively.
{
  const evidence = liveEvidence([
    'IRFC gains after a major loan agreement',
    'IRFC signs a large renewable energy contract',
    'Railway stocks show strong growth and profit outlook'
  ]);

  const decision = runDecision({
    emergency: 300000,
    spending: 50000,
    income: 90000,
    evidence,
    lastSearchEvidence: {
      query: 'IRFC',
      provider: 'serpapi',
      count: evidence.length,
      time: new Date().toISOString()
    }
  });

  assert.equal(decision.webSignal.stance, 'Positive');
  assert.equal(decision.executive.ceo.startsWith('Opportunity exists'), true);
  assert.equal(decision.decision, 'CEO wins: protect surplus while allocating selectively toward goals');
}

// 4) Cautious web signal: CFO/Risk must override CEO opportunity framing.
{
  const evidence = liveEvidence([
    'IRFC falls after a warning',
    'IRFC faces downgrade risk and debt concerns',
    'Analysts report weak outlook and losses'
  ]);

  const decision = runDecision({
    emergency: 300000,
    spending: 50000,
    income: 90000,
    evidence,
    lastSearchEvidence: {
      query: 'IRFC',
      provider: 'serpapi',
      count: evidence.length,
      time: new Date().toISOString()
    }
  });

  assert.equal(decision.webSignal.stance, 'Cautious');
  assert.equal(decision.decision, 'CFO/Risk wins: verify live negative signals before taking market risk');
}

console.log('CEO/CFO/Judge automated tests: 4/4 passed');
