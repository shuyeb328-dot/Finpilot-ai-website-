const MARKET_ALIASES = new Map([
  ['INDIA','INDIA'],['IN','INDIA'],['NSE','INDIA'],['BSE','INDIA'],['INDIA_EQUITY','INDIA'],
  ['US','US'],['USA','US'],['UNITED_STATES','US'],['US_EQUITY','US'],
  ['GLOBAL','GLOBAL'],['WORLD','GLOBAL'],['INTERNATIONAL','GLOBAL'],['GLOBAL_EQUITY','GLOBAL'],
  ['AUTO','AUTO'],['ALL','AUTO'],['MIXED','AUTO']
]);

export function normalizeMarketPicksMarket(value, hasExplicitTickers = false) {
  const raw = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!raw) return { ok: true, market: hasExplicitTickers ? 'AUTO' : 'INDIA' };
  const market = MARKET_ALIASES.get(raw);
  if (!market) return { ok: false, market: null, error: 'UNSUPPORTED_MARKET', supported: ['INDIA', 'US', 'GLOBAL', 'AUTO'] };
  return { ok: true, market };
}

export function resolveMarketPicksUniverse({ market, requestedTickers = [], indiaTickers = [], globalStockTestSet = [] }) {
  const requested = [...new Set(requestedTickers.map(x => String(x ?? '').trim().toUpperCase()).filter(Boolean))];
  if (requested.length) return requested;
  if (market === 'INDIA') return [...new Set(indiaTickers.map(x => String(x ?? '').trim().toUpperCase()).filter(Boolean))];
  if (market === 'US') {
    return [...new Set(globalStockTestSet
      .filter(row => String(row?.[0] ?? '').toUpperCase() === 'UNITED STATES')
      .map(row => String(row?.[1] ?? '').trim().toUpperCase())
      .filter(Boolean))];
  }
  if (market === 'GLOBAL') {
    return [...new Set(globalStockTestSet
      .filter(row => String(row?.[0] ?? '').toUpperCase() !== 'INDIA')
      .map(row => String(row?.[1] ?? '').trim().toUpperCase())
      .filter(Boolean))];
  }
  return [...new Set([...requested, ...indiaTickers].map(x => String(x ?? '').trim().toUpperCase()).filter(Boolean))];
}

function candidateMarket(row) {
  const market = String(row?.market ?? '').toUpperCase();
  const symbol = String(row?.symbol ?? row?.ticker ?? '').toUpperCase();
  if (market === 'INDIA_EQUITY' || /\.(NS|BO)$/.test(symbol)) return 'INDIA_EQUITY';
  if (market.startsWith('GLOBAL_')) return market;
  return market || 'UNKNOWN';
}

function matchesMarket(row, market) {
  const actual = candidateMarket(row);
  if (market === 'AUTO') return true;
  if (market === 'INDIA') return actual === 'INDIA_EQUITY';
  if (market === 'GLOBAL') return actual.startsWith('GLOBAL_');
  if (market === 'US') {
    if (actual !== 'GLOBAL_EQUITY') return false;
    const exchange = String(row?.listingExchange ?? row?.exchange ?? '').toUpperCase();
    return /(^|[^A-Z])(NASDAQ|NYSE|NMS|NYQ|NYS|NGM|PCX|ARCA|BATS|NCM|ASE)([^A-Z]|$)/.test(exchange)
      || ['NMS','NYQ','NYS','NGM','PCX','ARCA','BATS','NCM','ASE'].includes(exchange);
  }
  return false;
}

function isFreshProviderQuote(row, nowMs, maxAgeMs) {
  if (row?.live !== true || String(row?.sourceTimestampType ?? '').toUpperCase() !== 'PROVIDER_TIMESTAMP') return false;
  const ts = Date.parse(row?.asOf ?? '');
  if (!Number.isFinite(ts)) return false;
  const ageMs = nowMs - ts;
  return ageMs >= -5000 && ageMs <= maxAgeMs;
}

export function buildMarketPicksEnvelope(rows, {
  market = 'INDIA',
  limit = 5,
  nowMs = Date.now(),
  maxAgeMs = 90000
} = {}) {
  const safeLimit = Math.min(10, Math.max(3, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 5));
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(row => row && typeof row === 'object' && Number.isFinite(Number(row.score)) && matchesMarket(row, market))
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, safeLimit);

  const markets = [...new Set(candidates.map(candidateMarket))];
  const marketLabel = markets.length === 1 ? markets[0] : markets.length > 1 ? 'MIXED' :
    market === 'INDIA' ? 'INDIA_EQUITY' :
    market === 'US' || market === 'GLOBAL' ? 'GLOBAL_EQUITY' : 'UNKNOWN';
  const sourceTimes = candidates.map(row => Date.parse(row.asOf ?? ''));
  const allHaveSourceTimes = candidates.length > 0 && sourceTimes.every(Number.isFinite);
  const asOf = allHaveSourceTimes ? new Date(Math.min(...sourceTimes)).toISOString() : null;
  const freshCount = candidates.filter(row => isFreshProviderQuote(row, nowMs, maxAgeMs)).length;
  const providerNames = [...new Set(candidates.map(row => String(row.provider ?? '').trim()).filter(Boolean))];
  const allExecutionEligible = candidates.length > 0 && candidates.every(row => row.executionEligible === true);

  return {
    ok: true,
    live: candidates.length > 0 && freshCount === candidates.length,
    verified: allExecutionEligible,
    executionEligible: allExecutionEligible,
    market: marketLabel,
    requestedMarket: market,
    count: candidates.length,
    freshCount,
    staleOrUnverifiedCount: candidates.length - freshCount,
    asOf,
    retrievedAt: new Date(nowMs).toISOString(),
    dataFreshness: candidates.length === 0 ? 'UNAVAILABLE' : freshCount === candidates.length ? 'FRESH_PROVIDER_TIMESTAMPS' : 'STALE_OR_UNVERIFIED',
    candidates,
    provider: providerNames.length === 1 ? providerNames[0] : providerNames.length ? 'Multiple providers' : 'No provider available',
    disclaimer: 'Market-pick ranking is evidence for further review, not a guaranteed best stock or personalized recommendation. Unofficial or stale quotes are not execution-eligible; verify current exchange/broker data before acting.'
  };
}
