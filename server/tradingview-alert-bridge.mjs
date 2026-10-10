import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_QUEUE = 200;
const MAX_ALERT_AGE_MS = 3 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const SYMBOL_RE = /^[A-Z0-9._:-]{1,40}$/;
const ACTION_MAP = new Map([
  ['BUY', 'LONG'], ['LONG', 'LONG'],
  ['SELL', 'SHORT'], ['SHORT', 'SHORT'],
  ['EXIT', 'EXIT'], ['CLOSE', 'EXIT'],
  ['HOLD', 'HOLD'], ['WAIT', 'HOLD']
]);

const cleanText = (value, max = 100) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const digest = value => createHash('sha256').update(String(value), 'utf8').digest();
function tokenMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  const sameDigest = timingSafeEqual(digest(candidate), digest(expected));
  return sameDigest && candidate.length === expected.length;
}
function parseTimestamp(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    return Number.isFinite(ms) ? ms : null;
  }
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);
    return text.length >= 13 ? numeric : numeric * 1000;
  }
  const valueMs = Date.parse(text);
  return Number.isFinite(valueMs) ? valueMs : null;
}
function boundedLimit(value, fallback = 8) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(50, Math.trunc(n))) : fallback;
}

export function createTradingViewAlertBridge({ secret = '', now = () => Date.now(), maxAlerts = MAX_QUEUE } = {}) {
  const configuredSecret = typeof secret === 'string' ? secret : '';
  const configured = configuredSecret.length >= 32 && configuredSecret.length <= 256;
  const capacity = Math.max(1, Math.min(MAX_QUEUE, Math.trunc(Number(maxAlerts) || MAX_QUEUE)));
  const alerts = [];
  const seen = new Map();
  let acceptedCount = 0;
  let duplicateCount = 0;
  let rejectedCount = 0;
  let lastAcceptedAt = null;

  function prune(currentTime) {
    for (let i = alerts.length - 1; i >= 0; i--) {
      if (currentTime - Date.parse(alerts[i].receivedAt) > 48 * 60 * 60 * 1000) alerts.splice(i, 1);
    }
    for (const [key, timestamp] of seen) {
      if (currentTime - timestamp > 48 * 60 * 60 * 1000) seen.delete(key);
    }
  }

  function reject(status, error, details = {}) {
    rejectedCount++;
    return { ok: false, status, error, ...details };
  }

  function receive(payload) {
    const currentTime = Number(now());
    prune(currentTime);
    if (!configured) return reject(503, 'TRADINGVIEW_WEBHOOK_NOT_CONFIGURED', {
      message: 'Set TRADINGVIEW_WEBHOOK_SECRET to a private random value of 32–256 characters.'
    });
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return reject(400, 'INVALID_ALERT_PAYLOAD');
    }
    const candidate = cleanText(payload.secret ?? payload.token ?? '', 256);
    if (!tokenMatches(candidate, configuredSecret)) return reject(401, 'UNAUTHORIZED_WEBHOOK');

    const symbol = cleanText(payload.ticker ?? payload.symbol ?? payload.s ?? '', 40).toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return reject(400, 'INVALID_ALERT_SYMBOL');
    const rawAction = cleanText(payload.action ?? payload.side ?? payload.signal ?? payload.order_action ?? '', 24).toUpperCase();
    const action = ACTION_MAP.get(rawAction);
    if (!action) return reject(400, 'UNSUPPORTED_ALERT_ACTION', {
      allowedActions: ['BUY', 'SELL', 'LONG', 'SHORT', 'EXIT', 'CLOSE', 'HOLD', 'WAIT']
    });

    const rawTimestamp = payload.time ?? payload.timestamp ?? payload.bar_time ?? null;
    const eventTimeMs = parseTimestamp(rawTimestamp);
    if (rawTimestamp !== null && eventTimeMs === null) return reject(400, 'INVALID_ALERT_TIMESTAMP');
    if (eventTimeMs !== null) {
      if (eventTimeMs > currentTime + FUTURE_TOLERANCE_MS) return reject(400, 'ALERT_TIMESTAMP_IN_FUTURE');
      if (currentTime - eventTimeMs > MAX_ALERT_AGE_MS) return reject(409, 'ALERT_TIMESTAMP_STALE');
    }

    const timeframe = cleanText(payload.timeframe ?? payload.interval ?? '', 16).toUpperCase();
    const alertId = cleanText(payload.alert_id ?? payload.alertId ?? payload.id ?? '', 100);
    const stableInput = [
      alertId,
      symbol,
      action,
      timeframe,
      eventTimeMs ?? Math.floor(currentTime / 60_000)
    ].join('|');
    const dedupeKey = createHash('sha256').update(stableInput).digest('hex');
    const existing = seen.get(dedupeKey);
    if (existing !== undefined) {
      duplicateCount++;
      return { ok: true, accepted: false, duplicate: true, status: 200, message: 'Duplicate alert ignored.' };
    }

    const reportedPriceRaw = payload.price ?? payload.close ?? payload.last ?? null;
    const reportedPriceNum = reportedPriceRaw === null || reportedPriceRaw === undefined ? NaN : Number(reportedPriceRaw);
    const reportedPrice = Number.isFinite(reportedPriceNum) && reportedPriceNum > 0 ? reportedPriceNum : null;
    const createdAt = new Date(currentTime).toISOString();
    const id = dedupeKey.slice(0, 24);
    const alert = {
      id,
      symbol,
      action,
      timeframe: timeframe || 'UNKNOWN',
      source: 'TradingView',
      eventAt: eventTimeMs === null ? null : new Date(eventTimeMs).toISOString(),
      receivedAt: createdAt,
      timeQuality: eventTimeMs === null ? 'RECEIPT_TIME_ONLY' : 'PROVIDER_MESSAGE_TIMESTAMP',
      reportedPrice,
      quoteValidation: 'REQUIRED',
      executionEligible: false,
      executionState: 'NOT_EXECUTED',
      status: 'REVIEW_REQUIRED',
      note: 'Webhook alert is an unverified signal only. FinPilot must independently verify the matching market quote and risk gates; this receiver never submits an order.'
    };
    alerts.unshift(alert);
    if (alerts.length > capacity) alerts.length = capacity;
    seen.set(dedupeKey, currentTime);
    acceptedCount++;
    lastAcceptedAt = createdAt;
    return { ok: true, accepted: true, status: 202, alert: { ...alert } };
  }

  function list(limit = 8) {
    prune(Number(now()));
    return alerts.slice(0, boundedLimit(limit)).map(item => ({ ...item }));
  }

  function status() {
    prune(Number(now()));
    return {
      configured,
      configurationState: !configuredSecret ? 'MISSING' : configured ? 'READY' : 'INVALID_SECRET_LENGTH',
      acceptingWebhooks: configured,
      queueCount: alerts.length,
      acceptedCount,
      duplicateCount,
      rejectedCount,
      lastAcceptedAt,
      execution: 'SIMULATION_REVIEW_ONLY',
      realMoneyTrading: false,
      note: configured
        ? 'Webhook receiver is enabled; incoming alerts remain review-only until independent quote and risk checks pass.'
        : 'Webhook receiver is disabled until a private 32–256 character TRADINGVIEW_WEBHOOK_SECRET is configured.'
    };
  }

  return { receive, list, status };
}
