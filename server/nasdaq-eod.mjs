const NASDAQ_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36',
  'Origin': 'https://www.nasdaq.com',
  'Referer': 'https://www.nasdaq.com/'
};

function formatDate(date) {
  return String(date.getUTCFullYear()) + '-' + String(date.getUTCMonth()+1).padStart(2,'0') + '-' + String(date.getUTCDate()).padStart(2,'0');
}

function parsePrice(value) {
  const clean = String(value ?? '').replace(/[$,\s]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]), day = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/**
 * Fetch daily OHLCV for a simple US-listed ticker from Nasdaq's public
 * historical endpoint. This data is historical context, never a live quote.
 */
export async function fetchNasdaqEod(symbol, { fetchImpl = globalThis.fetch, now = new Date(), timeoutMs = 6500 } = {}) {
  const ticker = String(symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,10}$/.test(ticker)) throw new Error('NASDAQ_PUBLIC_US_SYMBOL_ONLY');
  if (typeof fetchImpl !== 'function') throw new Error('NASDAQ_FETCH_UNAVAILABLE');

  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('NASDAQ_INVALID_REFERENCE_TIME');
  const from = new Date(current.getTime() - 120 * 86400000);
  const url = 'https://api.nasdaq.com/api/quote/' + encodeURIComponent(ticker)
    + '/historical?assetclass=stocks&fromdate=' + formatDate(from)
    + '&todate=' + formatDate(current) + '&limit=100';
  const response = await fetchImpl(url, {
    headers: { ...NASDAQ_HEADERS },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response?.ok) throw new Error('NASDAQ_PUBLIC_HTTP_' + String(response?.status ?? 'UNKNOWN'));

  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('NASDAQ_PUBLIC_INVALID_JSON'); }
  const rawRows = payload?.data?.tradesTable?.rows;
  if (Number(payload?.status?.rCode) !== 200 || !Array.isArray(rawRows)) {
    const detail = payload?.status?.bCodeMessage?.[0]?.errorMessage;
    throw new Error(String(detail || 'NASDAQ_PUBLIC_DATA_UNAVAILABLE').slice(0, 180));
  }

  const rows = rawRows.map(row => {
    const time = parseDate(row?.date);
    const open = parsePrice(row?.open), high = parsePrice(row?.high);
    const low = parsePrice(row?.low), close = parsePrice(row?.close);
    const volume = parsePrice(row?.volume);
    return time && [open, high, low, close].every(v => Number.isFinite(v) && v > 0)
      ? { time, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : 0 }
      : null;
  }).filter(Boolean).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

  if (rows.length < 2) throw new Error('NASDAQ_PUBLIC_INSUFFICIENT_VALID_CANDLES');
  return {
    rows,
    provider: 'Nasdaq public historical data · EOD · analysis only',
    live: false,
    executionEligible: false,
    executionEligibilityReason: 'HISTORICAL_DATA_ANALYSIS_ONLY',
    sourceTimestampType: 'HISTORICAL_EOD',
    dataFreshness: 'END_OF_DAY',
    asOf: rows.at(-1).time,
    dataDisclaimer: 'Daily historical OHLC from Nasdaq public endpoint. This is not a live quote and is analysis-only.'
  };
}
