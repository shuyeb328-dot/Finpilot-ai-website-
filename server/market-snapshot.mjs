import {createHash} from 'node:crypto';

const DEFAULT_MAX_AGE_MS = 120_000;
const FUTURE_TOLERANCE_MS = 30_000;

function finite(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value) {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}

export function normalizeMarketSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\\.(?:NS|BO)$/, '').replace(/\\s+/g, '');
}

function timestampMs(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\\d{10,13}$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n < 100_000_000_000 ? n * 1000 : n;
  }
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseCandle(row) {
  if (!row) return null;
  let time, open, high, low, close, volume;
  if (Array.isArray(row)) {
    // Binance-style tuple: [openTime, open, high, low, close, volume, ...]
    time = row[0]; open = row[1]; high = row[2]; low = row[3]; close = row[4]; volume = row[5];
  } else {
    time = row.time ?? row.timestamp ?? row.date;
    open = row.open; high = row.high; low = row.low; close = row.close; volume = row.volume;
  }
  const o = positive(open), h = positive(high), l = positive(low), c = positive(close);
  if (o === null || h === null || l === null || c === null) return null;
  if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) return null;
  const timeMs = timestampMs(time);
  return {
    time: timeMs === null ? null : new Date(timeMs).toISOString(),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: Math.max(0, finite(volume) ?? 0)
  };
}

function idFor(parts) {
  return 'ms_' + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

/**
 * Creates the one canonical, auditable representation of a provider market response.
 * Forecast eligibility is deliberately strict: correct symbol, positive price, a valid
 * provider timestamp, fresh data, explicit live status, and at least two valid OHLC bars.
 */
export function buildMarketSnapshot(report, options = {}) {
  const capturedAtMs = timestampMs(options.capturedAt ?? Date.now()) ?? Date.now();
  const capturedAt = new Date(capturedAtMs).toISOString();
  const maxAgeMs = Math.max(1_000, finite(options.maxAgeMs) ?? DEFAULT_MAX_AGE_MS);
  const requestedTicker = String(options.requestedTicker || '').trim().toUpperCase();
  const actualTicker = String(report?.ticker || report?.symbol || '').trim().toUpperCase();
  const requestedSymbol = normalizeMarketSymbol(requestedTicker);
  const actualSymbol = normalizeMarketSymbol(actualTicker);
  const symbolMatches = Boolean(requestedSymbol && actualSymbol && requestedSymbol === actualSymbol);
  const market = String(report?.market || (report?.currency === 'USD' && report?.provider?.toLowerCase?.().includes('binance') ? 'CRYPTO' : '') || 'UNKNOWN').toUpperCase();
  const currency = String(report?.currency || (market === 'CRYPTO' ? 'USD' : market.startsWith('INDIA') ? 'INR' : 'UNKNOWN')).trim().toUpperCase();
  const price = positive(report?.price);
  const sourceTimestampMs = timestampMs(report?.asOf);
  const ageMs = sourceTimestampMs === null ? null : capturedAtMs - sourceTimestampMs;
  const rawCandles = Array.isArray(report?.candles) ? report.candles : [];
  const candles = rawCandles.map(normaliseCandle).filter(Boolean).slice(-220);

  let status = 'UNAVAILABLE';
  let reasons = [];
  if (!report || typeof report !== 'object') {
    reasons.push('NO_MARKET_REPORT');
  } else if (!actualSymbol) {
    status = 'UNRESOLVED_SYMBOL'; reasons.push('REPORT_SYMBOL_MISSING');
  } else if (!requestedSymbol || !symbolMatches) {
    status = 'SYMBOL_MISMATCH'; reasons.push('REQUESTED_AND_RETURNED_SYMBOLS_DIFFER');
  } else if (price === null) {
    status = 'INVALID_PRICE'; reasons.push('PRICE_MISSING_OR_NON_POSITIVE');
  } else if (sourceTimestampMs === null || ageMs < -FUTURE_TOLERANCE_MS) {
    status = 'INVALID_TIMESTAMP'; reasons.push('SOURCE_TIMESTAMP_MISSING_OR_INVALID');
  } else if (ageMs > maxAgeMs) {
    status = 'STALE'; reasons.push('QUOTE_OLDER_THAN_MAX_AGE');
  } else if (report.live !== true) {
    status = 'DELAYED'; reasons.push('PROVIDER_DID_NOT_MARK_QUOTE_LIVE');
  } else if (candles.length < 2) {
    status = 'INCOMPLETE_CANDLES'; reasons.push('FEWER_THAN_TWO_VALID_OHLC_CANDLES');
  } else {
    status = 'VERIFIED_LIVE';
    reasons.push('SYMBOL_PRICE_TIMESTAMP_AND_OHLC_VALIDATED');
  }

  const provider = String(report?.provider || 'UNKNOWN');
  const sourceAsOf = sourceTimestampMs === null ? null : new Date(sourceTimestampMs).toISOString();
  const id = idFor([actualSymbol || 'NONE', sourceAsOf || 'NO_TIME', String(price ?? 'NO_PRICE'), provider, String(candles.length), status]);
  const forecastEligible = status === 'VERIFIED_LIVE';

  return {
    schemaVersion: 1,
    snapshotId: id,
    capturedAt,
    requested: {ticker: requestedTicker || null, symbol: requestedSymbol || null, interval: String(options.interval || '1h')},
    instrument: {
      ticker: actualTicker || null,
      symbol: actualSymbol || null,
      name: String(report?.name || ''),
      market,
      exchange: String(report?.exchange || 'UNKNOWN'),
      currency,
      symbolMatches
    },
    quote: {
      price,
      previous: positive(report?.previous),
      changePct: finite(report?.changePct),
      volume: Math.max(0, finite(report?.volume) ?? 0),
      dayHigh: positive(report?.dayHigh),
      dayLow: positive(report?.dayLow)
    },
    timing: {
      sourceAsOf,
      capturedAt,
      ageMs: ageMs === null ? null : Math.max(0, ageMs),
      maxAgeMs,
      fresh: ageMs !== null && ageMs >= -FUTURE_TOLERANCE_MS && ageMs <= maxAgeMs,
      providerMarkedLive: report?.live === true
    },
    technicals: {
      rsi: finite(report?.rsi),
      sma20: positive(report?.sma20),
      sma50: positive(report?.sma50),
      support: positive(report?.support ?? report?.recentLow),
      resistance: positive(report?.resistance ?? report?.recentHigh)
    },
    candles: {interval: String(options.interval || report?.interval || '1h'), count: candles.length, rawCount: rawCandles.length, rejectedCount: Math.max(0, rawCandles.length - candles.length), rows: candles},
    provenance: {
      provider,
      dataFreshness: String(report?.dataFreshness || (report?.live === true ? 'PROVIDER_MARKED_LIVE' : 'NON_LIVE_OR_UNKNOWN')),
      disclaimer: String(report?.dataDisclaimer || 'Verify the source timestamp and broker/exchange quote before acting.')
    },
    quality: {
      status,
      reasons,
      forecastEligible,
      paperExecutionEligible: forecastEligible
    }
  };
}

/** Create an immutable schema for a forecast ledger row; outcomes are filled only later. */
export function buildForecastRecord({snapshot, horizonMinutes = 60, modelVersion = 'finpilot-baseline-v1', forecast = {}, createdAt = new Date().toISOString()} = {}) {
  const nowMs = timestampMs(createdAt) ?? Date.now();
  const created = new Date(nowMs).toISOString();
  const horizon = Math.max(1, Math.min(525_600, Math.round(finite(horizonMinutes) ?? 60)));
  const snapshotId = snapshot?.snapshotId || null;
  const probabilities = {};
  for (const key of ['up', 'down', 'targetFirst', 'stopFirst']) {
    const p = finite(forecast?.probabilities?.[key]);
    probabilities[key] = p !== null && p >= 0 && p <= 100 ? p : null;
  }
  const price = positive(snapshot?.quote?.price);
  const eligible = snapshot?.quality?.forecastEligible === true && price !== null;
  const recordId = idFor([snapshotId || 'NO_SNAPSHOT', created, String(horizon), String(modelVersion), String(price ?? 'NO_PRICE')]).replace(/^ms_/, 'fc_');
  return {
    schemaVersion: 1,
    forecastId: recordId,
    createdAt: created,
    dueAt: new Date(nowMs + horizon * 60_000).toISOString(),
    horizonMinutes: horizon,
    modelVersion: String(modelVersion),
    marketSnapshotId: snapshotId,
    ticker: snapshot?.instrument?.ticker || null,
    market: snapshot?.instrument?.market || 'UNKNOWN',
    currency: snapshot?.instrument?.currency || 'UNKNOWN',
    referencePrice: price,
    quoteAsOf: snapshot?.timing?.sourceAsOf || null,
    dataStatus: snapshot?.quality?.status || 'UNAVAILABLE',
    forecastStatus: eligible ? 'PENDING_OUTCOME' : 'BLOCKED_UNVERIFIED_DATA',
    probabilitiesCalibrated: false,
    probabilities,
    expectedReturnPct: finite(forecast?.expectedReturnPct),
    targetPrice: positive(forecast?.targetPrice),
    stopPrice: positive(forecast?.stopPrice),
    outcome: null,
    evaluatedAt: null
  };
}
