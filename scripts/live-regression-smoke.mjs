const base = (process.env.FINPILOT_BASE_URL || 'https://finpilot-ai-8wn6.onrender.com').replace(/\/$/, '');
const timeoutMs = 15000;
async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(base + path, { signal: controller.signal, headers: { 'user-agent': 'FinPilot-live-regression/1.0', 'cache-control': 'no-cache' } });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS', message);
}
const home = await get('/');
assert(home.response.ok, 'homepage responds HTTP ' + home.response.status);
assert(/tradingview-paper-bridge\.js(?:\?|["'])/.test(home.body), 'homepage references the TradingView companion');
assert(/one-click-analysis\.js(?:\?|["'])/.test(home.body), 'homepage references the one-click analysis engine');
assert(/id=["']paperlab["']/.test(home.body), 'homepage contains the paper-trading workspace');
for (const asset of ['/tradingview-paper-bridge.js?smoke=1', '/one-click-analysis.js?smoke=1', '/paper-engine.js?smoke=1']) {
  const result = await get(asset);
  assert(result.response.ok, asset + ' responds HTTP ' + result.response.status);
  assert(result.body.length > 500, asset + ' returns non-empty JavaScript');
  if (asset.startsWith('/tradingview-paper-bridge.js')) {
    assert(result.body.includes('FinPilotTradingViewBridge'), 'TradingView companion exposes its expected API');
    assert(result.body.includes('SIMULATION ONLY') || result.body.includes('simulation only'), 'TradingView companion clearly labels simulation boundary');
  }
}
for (const endpoint of ['/api/health', '/api/core-status']) {
  const result = await get(endpoint);
  assert(result.response.ok, endpoint + ' responds HTTP ' + result.response.status);
  let data;
  try { data = JSON.parse(result.body); } catch { throw new Error(endpoint + ' returned invalid JSON'); }
  assert(data && typeof data === 'object', endpoint + ' returns a JSON object');
  if (endpoint === '/api/health') {
    assert(data.status === 'OPERATIONAL' || data.ok === true, 'health endpoint reports service availability');
  }
  if (endpoint === '/api/core-status') {
    assert(data.ok === true && typeof data.serverExecutedAgentRuns === 'number' && typeof data.clientReportedAgentRuns === 'number', 'core status exposes separate server/client agent telemetry');
  }
}
console.log('FinPilot live regression smoke checks completed.');
