# FinPilot 3.4 — Derivatives Decision Room

Adds a real-time derivatives analysis layer for connected assets.

## Futures
- Live mark price attempt
- Funding rate
- Open interest
- Multi-timeframe underlying trend
- Bull/bear/neutral model scenario probabilities
- CEO and CFO decision layer

## Options
- Live option exchange metadata attempt
- Contract/expiry/strike discovery
- Contract quote attempt
- Underlying multi-timeframe evidence
- CEO/CFO decision layer

## Safety
- Never fabricates contract data when the provider is unavailable.
- Probabilities are model scenario scores, not guaranteed profit probabilities.
- No trade execution.
- Leverage/suitability warning is always shown.
- High-impact transactions require explicit human approval.

## Endpoint
`GET /api/derivatives-report?ticker=BTC&instrument=FUTURE&riskBudget=1`

Supported instruments: `FUTURE`, `OPTION`.
