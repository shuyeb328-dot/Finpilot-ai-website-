# FinPilot AI 2.3 — Financial Brain Schema

The Financial Brain is the shared structured state used by the local decision engine, specialist agents, Round Table and Action Center.

## Core domains
- `profile`: currency, country, household, risk tolerance.
- `cash`, `income`, `spending`, `emergency`: core cash-flow and liquidity state.
- `transactions[]`: dated income/expense events.
- `assets[]`: structured asset inventory.
- `debts[]`: liabilities, balances and rates.
- `recurring[]`: recurring obligations.
- `budgets[]`: category limits and spend.
- `goals[]`: target, saved amount and progress.
- `investments`: existing portfolio value plus future instrument-level data.
- `evidence[]`: claims used by agents/decisions, with confidence and source type.
- `findings[]`: normalized domain findings with severity, score and detail.
- `decisionHistory[]`: immutable-in-practice local records of Round Table verdicts and referenced evidence.
- `actions[]`: recommendations awaiting user-controlled execution.
- `memory[]`: persistent agent context.

## Decision lineage
Financial data → Findings → Evidence → Specialist views → Round Table → CEO/Judge verdict → Action → User approval → Completion.

High-impact actions are never represented as silently executed transactions. They remain explicit approval-gated tasks.

## Current limitations
2.3 uses browser-local persistence. Bank/account aggregation, institution-level verification, market feeds and server-side multi-user persistence are intentionally separate integrations and are not fabricated as live data.
