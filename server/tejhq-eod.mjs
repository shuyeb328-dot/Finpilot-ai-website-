const BASE_URL = 'https://api.tejhq.dev';
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ITEMS = 300;
const cache = new Map();

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(?:NS|BO)$/i, '');
}
function validDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'));
}
function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function validBar(row) {
  if (!row || !validDateOnly(row.date)) return null;
  const open=finitePositive(row.open), high=finitePositive(row.high);
  const low=finitePositive(row.low), close=finitePositive(row.close);
  if ([open,high,low,close].some(x => x === null)) return null;
  if (high < Math.max(open,close,low) || low > Math.min(open,close,high)) return null;
  return {
    time:row.date,date:row.date,open,high,low,close,
    volume:finiteNonNegative(row.volume)
  };
}
function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null;
}

export function buildTejHqEodReport(ticker, historyPayload, statusPayload, options = {}) {
  const requested = String(ticker || '').trim().toUpperCase();
  const symbol = normalizeSymbol(requested);
  const explicitBse = /\.BO$/i.test(requested);
  const exchange = explicitBse ? 'bse' : 'nse';
  if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)) throw new Error('TEJHQ_INVALID_SYMBOL');
  const today = new Date(options.now ?? Date.now()).toISOString().slice(0,10);
  const statusDate = validDateOnly(statusPayload?.trading_date) ? statusPayload.trading_date : null;
  const bars = (Array.isArray(historyPayload?.data) ? historyPayload.data : [])
    .map(validBar).filter(Boolean)
    .filter(row => row.date <= today && (!statusDate || row.date <= statusDate))
    .sort((a,b) => a.date.localeCompare(b.date)).slice(-120);
  if (bars.length < 2) throw new Error('TEJHQ_EOD_HISTORY_INSUFFICIENT');
  const latest = bars[bars.length-1];
  const previousRow = bars.length > 1 ? bars[bars.length-2] : null;
  const prevClose = finitePositive(historyPayload.data.find?.(x=>x?.date===latest.date)?.prev_close)
    || finitePositive(previousRow?.close);
  const publicationTime = statusDate === latest.date ? validIso(statusPayload?.prices_published_at) : null;
  const priceChange = prevClose ? ((latest.close - prevClose) / prevClose) * 100 : null;
  return {
    ticker: requested,
    symbol,
    name: symbol,
    market: 'INDIA_EQUITY',
    exchange: exchange.toUpperCase() + ' · TejHQ EOD',
    currency: 'INR',
    price: latest.close,
    previous: prevClose,
    changePct: priceChange,
    dayHigh: latest.high,
    dayLow: latest.low,
    volume: latest.volume,
    asOf: publicationTime,
    sourceTimestampType: publicationTime ? 'HISTORICAL_EOD' : 'HISTORICAL_DATE_ONLY',
    timestampType: publicationTime ? 'HISTORICAL_EOD' : 'HISTORICAL_DATE_ONLY',
    latestTradingDate: latest.date,
    pricesPublishedAt: publicationTime,
    tradingDate: statusDate,
    live: false,
    executionEligible: false,
    dataFreshness: 'END_OF_DAY',
    interval: '1d',
    candles: bars.map(({time,open,high,low,close,volume})=>({time,open,high,low,close,volume})),
    provider: 'TejHQ public EOD',
    providerUrl: BASE_URL,
    retrievedAt: new Date(options.now ?? Date.now()).toISOString(),
    dataDisclaimer: 'Historical end-of-day data only; not live or intraday. This fallback cannot authorize a forecast-dependent order or paper execution.'
  };
}

async function fetchJsonBounded(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method:'GET',
      headers:{'Accept':'application/json','User-Agent':'FinPilot/8.6 historical EOD fallback'},
      signal:controller.signal
    });
    if (!response?.ok) throw new Error('TEJHQ_HTTP_' + Number(response?.status || 0));
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('TEJHQ_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Keyless daily-historical fallback used only after the main equity quote provider throws.
 * The returned report is always labelled EOD/non-live and cannot pass the trading gate.
 */
export async function fetchTejHqEod(ticker, options = {}) {
  const requested = String(ticker || '').trim().toUpperCase();
  const symbol = normalizeSymbol(requested);
  const explicitlyExchanged = /\.(?:NS|BO)$/i.test(requested);
  const allowed = new Set((options.allowedSymbols || []).map(normalizeSymbol));
  if (!explicitlyExchanged && !allowed.has(symbol)) throw new Error('TEJHQ_EOD_NOT_INDIAN_INSTRUMENT');
  if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)) throw new Error('TEJHQ_INVALID_SYMBOL');
  const exchange = /\.BO$/i.test(requested) ? 'bse' : 'nse';
  const cacheKey = exchange + ':' + symbol;
  const now = Number(options.now ?? Date.now());
  if (options.useCache !== false) {
    const hit = cache.get(cacheKey);
    if (hit && now - hit.cachedAt < CACHE_TTL_MS) return {...hit.report, eodCacheHit:true};
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('TEJHQ_FETCH_UNAVAILABLE');
  const timeoutMs = Math.max(500, Math.min(10000, Number(options.timeoutMs) || 6000));
  const historyUrl = BASE_URL + '/v1/ohlcv/' + exchange + '/' + encodeURIComponent(symbol);
  const statusUrl = BASE_URL + '/v1/status';
  const [history, status] = await Promise.all([
    fetchJsonBounded(fetchImpl, historyUrl, timeoutMs),
    fetchJsonBounded(fetchImpl, statusUrl, timeoutMs).catch(() => null)
  ]);
  const report = buildTejHqEodReport(requested, history, status, {now});
  if (options.useCache !== false && report.candles.length >= 2) {
    cache.set(cacheKey, {cachedAt:now,report});
    while (cache.size > CACHE_MAX_ITEMS) cache.delete(cache.keys().next().value);
  }
  return {...report,eodCacheHit:false};
}

export function clearTejHqEodCache() {
  cache.clear();
}
