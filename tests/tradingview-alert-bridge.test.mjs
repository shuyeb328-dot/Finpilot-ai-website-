import assert from 'node:assert/strict';
import { createTradingViewAlertBridge } from '../server/tradingview-alert-bridge.mjs';

let current = Date.parse('2026-10-10T10:00:00.000Z');
const secret = 'finpilot-test-secret-do-not-use-in-production-2026';
const bridge = createTradingViewAlertBridge({ secret, now: () => current, maxAlerts: 2 });

const disabled = createTradingViewAlertBridge({ secret: '', now: () => current });
assert.equal(disabled.status().acceptingWebhooks, false);
assert.equal(disabled.receive({ secret: '', ticker: 'AAPL', action: 'BUY' }).status, 503);
assert.equal(createTradingViewAlertBridge({ secret: 'too-short', now: () => current }).status().configurationState, 'INVALID_SECRET_LENGTH');

assert.equal(bridge.receive({ secret: 'wrong-secret', ticker: 'AAPL', action: 'BUY' }).status, 401);
assert.equal(bridge.receive({ secret, ticker: 'AAPL<script>', action: 'BUY' }).error, 'INVALID_ALERT_SYMBOL');
assert.equal(bridge.receive({ secret, ticker: 'AAPL', action: 'MARKET BUY' }).error, 'UNSUPPORTED_ALERT_ACTION');
assert.equal(bridge.receive({ secret, ticker: 'AAPL', action: 'BUY', time: 'not-a-date' }).error, 'INVALID_ALERT_TIMESTAMP');
assert.equal(bridge.receive({ secret, ticker: 'AAPL', action: 'BUY', time: current + 10 * 60_000 }).error, 'ALERT_TIMESTAMP_IN_FUTURE');
assert.equal(bridge.receive({ secret, ticker: 'AAPL', action: 'BUY', time: current - 4 * 60 * 60_000 }).error, 'ALERT_TIMESTAMP_STALE');

const payload = {
  secret,
  alert_id: 'aapl-up-001',
  ticker: 'NASDAQ:AAPL',
  action: 'BUY',
  interval: '15',
  time: new Date(current).toISOString(),
  price: '250.25'
};
const first = bridge.receive(payload);
assert.equal(first.status, 202);
assert.equal(first.accepted, true);
assert.equal(first.alert.action, 'LONG');
assert.equal(first.alert.symbol, 'NASDAQ:AAPL');
assert.equal(first.alert.reportedPrice, 250.25);
assert.equal(first.alert.quoteValidation, 'REQUIRED');
assert.equal(first.alert.executionEligible, false);
assert.equal(first.alert.executionState, 'NOT_EXECUTED');
assert.match(first.alert.note, /never submits an order/i);
assert.equal(JSON.stringify(first).includes(secret), false);
assert.equal(bridge.receive(payload).duplicate, true);
assert.equal(bridge.status().duplicateCount, 1);

current += 60_000;
const second = bridge.receive({
  secret, alert_id: 'btc-down-001', ticker: 'BINANCE:BTCUSDT', action: 'SELL',
  timeframe: '5', time: new Date(current).toISOString(), close: '{{close}}'
});
assert.equal(second.alert.action, 'SHORT');
assert.equal(second.alert.reportedPrice, null);

current += 60_000;
bridge.receive({
  secret, alert_id: 'reliance-001', ticker: 'NSE:RELIANCE', action: 'CLOSE',
  timeframe: 'D', time: new Date(current).toISOString()
});
assert.equal(bridge.list(20).length, 2, 'queue must remain within its configured bound');
assert.equal(bridge.list(1).length, 1);
assert.equal(bridge.list(1)[0].symbol, 'NSE:RELIANCE');
assert.equal(bridge.status().realMoneyTrading, false);
assert.equal(bridge.status().execution, 'SIMULATION_REVIEW_ONLY');
assert.equal(JSON.stringify(bridge.status()).includes(secret), false);

console.log('tradingview-alert-bridge: authentication, validation, freshness, dedupe, bounded queue, and paper-only gates passed');
