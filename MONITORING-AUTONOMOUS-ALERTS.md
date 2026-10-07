# FinPilot AI 2.8 — Autonomous Monitoring & Alerts

The monitoring engine continuously evaluates the local Financial Brain while the website is open.

## Rules
- Liquidity: warn below 6 months; high below 3 months.
- Cash flow: alert when monthly free cash is negative.
- Debt: alert on 12%+ APR.
- Goals: flag goals below 20% progress.
- Recurring obligations: review when tracked recurring commitments exceed 20% of monthly income.
- Evidence: warn when the evidence ledger is stale.
- Learning: surface repeated decision-error patterns.

Monitoring is deterministic and local-first. It never moves money or executes high-impact actions.
