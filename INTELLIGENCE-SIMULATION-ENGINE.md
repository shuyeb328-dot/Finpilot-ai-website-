# FinPilot AI 2.4 — Intelligence & Simulation Engine

## Purpose
FinPilot 2.4 adds a deterministic scenario engine so financial decisions can be stress-tested without an AI provider or market-data API.

## Scenario types
- Job loss
- Large purchase
- Investment contribution
- Debt payoff
- Income drop
- Expense increase
- Goal acceleration

## Outputs
Each scenario calculates:
- Projected cash
- Cash delta versus baseline
- Monthly free cash
- Cash runway in months
- Net-worth delta
- Goal coverage snapshot
- Debt pressure
- Risk classification: MANAGEABLE / WATCH / ELEVATED / CRITICAL
- Downside and upside cash envelopes
- Assumptions used by the engine

## Safety
The engine is analytical only. It does not transfer money, place trades, repay debt, or modify external accounts. Any resulting action remains subject to FinPilot's explicit approval gate.

## Architecture
The browser contains the offline-ready deterministic implementation. The server also exposes `POST /api/simulate` for controlled backend orchestration. No financial secret is required for simulation.
