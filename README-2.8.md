# FinPilot AI 2.8 — Autonomous Monitoring & Alerts

2.8 adds a deterministic local monitoring engine on top of the Financial Brain, Decision Memory and Real Agent Intelligence layers.

## Monitoring rules
- Emergency reserve below 6 months / 3 months
- Negative monthly free cash
- High-APR debt at 12%+
- Goal progress below 20%
- Material recurring obligations
- Stale evidence ledger
- Repeated decision-error patterns

## Behavior
- Runs immediately at startup.
- Re-checks every 5 minutes while the tab is visible and monitoring is enabled.
- Creates prioritized alerts and scan history.
- Allows explicit user resolution.
- Never executes money movement, trades, account changes, or other high-impact actions.
- Works without an AI/API key.
