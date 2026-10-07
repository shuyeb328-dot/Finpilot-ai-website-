# FinPilot AI 2.6 — Real Agent Intelligence

This release upgrades specialist agents from simple status/findings into a structured reasoning pipeline.

## Pipeline
Question → Evidence → Analysis → Counterargument → Confidence → Recommendation → Action preparation → Approval requirement → Decision history

## New API
`POST /api/agent-run`

The deterministic endpoint accepts an agent name and Financial Brain snapshot and returns structured reasoning. It does not execute financial transactions.

## Safety
High-impact actions remain approval-gated. AI credentials, when configured, stay server-side.

## Offline behavior
The client has a local fallback when the gateway is unavailable.
