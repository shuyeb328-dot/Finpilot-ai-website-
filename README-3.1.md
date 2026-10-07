# FinPilot AI 3.1 — Stock Intelligence

Adds a first-class Stock Intelligence workspace to the 3.0 Compliance & Financial Risk build.

## Included
- Stock Intelligence navigation module
- Ticker analysis workflow
- SBC evidence snapshot test case
- Technical signal matrix: RSI, ADX, VWAP, volume
- Price structure: support, 52-week range, breakout zone
- Target/scenario framework
- Composite research-risk score
- Valuation context
- Evidence lineage with source links and freshness
- Compliance gate: decision support only; no trade execution; personalized regulated advice requires appropriate risk/suitability controls

## API
`GET /api/stock-report?ticker=SBC`

The SBC report is an evidence snapshot for testing the website engine. It is not a live market-data connection. Other tickers return a provider-unavailable response until a market-data connector is configured.

## Next production step
Connect a licensed/authorized market-data provider and OHLC/indicator history. Then the same website engine can generate live candlestick charts, indicator history, alerts, scenario probabilities, and source freshness checks without exposing provider credentials to the browser.
