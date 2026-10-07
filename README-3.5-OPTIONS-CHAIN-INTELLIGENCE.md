# FinPilot AI 3.5 — Options Chain Intelligence

Adds a contract-ranking layer to the Derivatives Decision Room.

## Capabilities
- Live Binance European Options chain discovery when reachable.
- Nearest-expiry contract scan for supported crypto underlyings.
- Call/put ranking using moneyness, bid/ask spread, volume and open-interest evidence.
- Bull / bear / neutral scenario scores.
- CEO Agent strategic decision.
- CFO Agent capital-risk veto / conditional approval.
- Explicit distinction between model confidence and probability of profit.
- Hard WAIT state when live chain evidence is unavailable.
- No fabricated option prices, Greeks, IV, OI or probabilities.
- No transaction execution.
- Human approval remains mandatory for high-impact leveraged decisions.

## API
`GET /api/option-chain-scan?ticker=BTC&limit=18`

The endpoint is a public-data adapter. For production deployment, use a production-grade market-data provider with documented SLA, rate limits and historical options data. Binance documents its European Options public endpoints and option contract types in its developer documentation.

## Safety
This module is financial information/decision support, not a guarantee of outcome or a substitute for suitability, risk review, or regulated advice. Contract-specific buying decisions must remain user-approved.
