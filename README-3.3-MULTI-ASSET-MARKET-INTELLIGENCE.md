# FinPilot AI 3.3 — Multi-Asset Market Intelligence

## Upgrade
- Provider adapter for Binance public crypto market data.
- Supported crypto assets: BTC, ETH, SOL, BNB, XRP.
- Timeframes: 15m, 1h, 4h, 1d.
- Multi-timeframe consensus across 15m/1h/4h.
- RSI, ATR, EMA20, SMA20/50/200, volume participation.
- Automatic support/resistance and scenario levels.
- Risk score adjusted for timeframe disagreement.
- Explicit LIVE vs FALLBACK evidence state.
- Non-BTC provider failures never reuse BTC snapshot data.
- Market universe endpoint for UI/provider discovery.

## Safety
This remains financial information and decision support, not personalized regulated investment advice. No trade execution is implemented. Scenario levels are not guaranteed targets.

## API
- `GET /api/market-universe`
- `GET /api/stock-report?ticker=BTC&interval=1h&multi=1`
- `GET /api/stock-report?ticker=ETH&interval=4h&multi=1`
