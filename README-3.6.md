# FinPilot 3.600 — Options-Math-Greeks

3.6 adds theoretical Black-Scholes-style pricing and Greeks (Delta/Gamma/Theta/Vega) with explicit non-live labeling.

## Safety
- Analysis only; no trade execution.
- Live data must be attributable; unavailable providers produce WAIT/blocked states.
- Scenario probabilities are not guaranteed profit probabilities.
- High-impact derivatives decisions require explicit human approval.
