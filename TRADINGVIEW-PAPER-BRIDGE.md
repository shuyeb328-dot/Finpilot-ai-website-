# TradingView alert inbox for FinPilot Paper Arena

## What this integration does

FinPilot can optionally accept JSON alert webhooks from TradingView at:

`https://finpilot-ai-8wn6.onrender.com/api/tradingview/webhook`

Accepted alerts appear in the Paper Arena's **TradingView Alert Inbox**. The inbox is a review queue, not an order router. It never executes a broker order, and an alert's reported price is never used as a verified FinPilot market quote. Selecting **Review in Paper Arena** copies the symbol into the paper ticket and requests the separate FinPilot quote check.

The embedded TradingView chart remains a chart widget. This webhook is the separate path for alert messages; embedding the chart alone does not connect account data or provide an executable price feed.

## Enable the receiver safely

1. In the Render dashboard, open the `finpilot-ai` web service and go to **Environment**.
2. Add `TRADINGVIEW_WEBHOOK_SECRET` with a private random value 32–256 characters long. Use a password manager or a secure random generator. Do not paste the value into GitHub, source code, screenshots, support tickets, or public alert messages.
3. Save the variable and wait for Render to redeploy the service.
4. In TradingView, create an alert, enable its webhook URL, and use the full endpoint URL above.
5. Copy the JSON message template from FinPilot's Alert Inbox and replace `REPLACE_WITH_TRADINGVIEW_WEBHOOK_SECRET` in the alert message with exactly the value stored in Render.
6. Set `action` to the signal meaning for that alert: `BUY` or `LONG` for a long signal; `SELL` or `SHORT` for a short signal; `EXIT` or `CLOSE` to close/exit; `HOLD` or `WAIT` for a no-trade signal.
7. Save the alert, trigger it with a safe test condition, then refresh the FinPilot inbox.

Example alert body (replace the secret placeholder before use):

```json
{
  "secret": "REPLACE_WITH_TRADINGVIEW_WEBHOOK_SECRET",
  "alert_id": "{{ticker}}-{{interval}}-{{timenow}}",
  "ticker": "{{exchange}}:{{ticker}}",
  "action": "BUY",
  "timeframe": "{{interval}}",
  "time": "{{timenow}}",
  "price": "{{close}}"
}
```

If TradingView's selected alert type does not support one of these placeholders, use its documented placeholder for that alert type. A placeholder that is not a numeric price is stored as no reported price, rather than being guessed.

## Safety and operational limits

- Receiver stays disabled unless `TRADINGVIEW_WEBHOOK_SECRET` has an acceptable length.
- Invalid secrets, symbols, unsupported actions, invalid timestamps, and stale alerts are rejected.
- Duplicated alert messages are ignored.
- The queue is bounded and currently held in process memory; it may clear on restart or deploy and old alerts are pruned. It is not yet a durable audit ledger.
- Signals are marked `REVIEW_REQUIRED`, `executionEligible: false`, and `executionState: NOT_EXECUTED`.
- FinPilot must independently verify a fresh, matching, provider-verified quote and its risk gates before any paper order can be considered.
- Real-money brokerage execution is not part of this integration.
- TradingView's widget and webhook behaviour are subject to TradingView account, alert and market-data availability limits.
