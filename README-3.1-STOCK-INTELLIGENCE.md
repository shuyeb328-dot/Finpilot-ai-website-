# FinPilot AI 3.1 — Live Stock Intelligence

## Upgrade
Stock Intelligence now supports a market-data adapter architecture for crypto assets and BTC:
- Live provider attempt via Binance public ticker + 1h OHLCV
- RSI, ATR, 20/50/200 SMA, EMA20 and volume participation
- Recent support/resistance detection
- Breakout, ATR-extension and mean-reversion scenario levels
- Multi-factor research-risk score
- Live vs fallback evidence status
- Evidence lineage and compliance gate
- No trade execution

## API
`GET /api/stock-report?ticker=BTC`

The endpoint attempts the live provider first. If the provider is unavailable, BTC returns a clearly labeled fallback snapshot rather than pretending the data is live.

## Next production step
For production deployment, configure a dedicated market-data provider/API key server-side for reliable exchange coverage and historical depth. Never put provider secrets in browser code.
