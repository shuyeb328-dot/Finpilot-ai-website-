# FinPilot Agent Core + Isolated Paper Arena

## Purpose
The Agent Paper Arena is a separate pseudo-paper-trading environment. It never sends broker/exchange orders and never mutates the real Financial Brain portfolio.

## Core layers
1. **Agent Factory** — built-in and user-created specialists.
2. **Deep Core** — hypothesis, evidence cross-check, opposing case/red-team, risk budget, decision + invalidation.
3. **Paper Portfolio** — isolated virtual cash, positions, orders, P&L and journal per agent.
4. **Paper Round Table** — every enabled paper agent independently scores the same market snapshot.
5. **Consensus + dissent** — BUY/SELL/HOLD vote, average edge, confidence and dissent are recorded.
6. **Virtual execution gate** — only the paper arena can create a simulated order.
7. **Leaderboard** — virtual equity and return are tracked independently.

## Market snapshot
The arena accepts a hypothetical or user-supplied snapshot:
- symbol
- price
- momentum
- quality
- valuation
- risk
- evidence quality

These are simulation inputs, not claims that the market has those values.

## Safety boundary
- No broker API.
- No exchange API.
- No bank API.
- No real order execution.
- Real FinPilot cash/investment/debt state is not used as paper cash.
- Paper reset affects only the paper arena.

## Decision structure
Each agent produces:
- action
- confidence
- edge
- bull score
- bear score
- thesis
- reasoning steps
- invalidation trigger

The Round Table then records:
- BUY / SELL / HOLD votes
- final paper decision
- confidence
- average edge
- dissenting agents

This is a deterministic simulation engine, not a claim of human-like consciousness or unrestricted hidden reasoning.
