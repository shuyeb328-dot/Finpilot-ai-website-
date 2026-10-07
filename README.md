# FinPilot AI 2.3 — Financial Brain

FinPilot AI is a website-first financial operating system. Version 2.3 upgrades the Executive Operating System with a structured Financial Brain, normalized findings, evidence records and decision lineage.

## Included
- Executive Command Center
- Financial Brain
- Agent Fleet
- Round Table Assist
- Action Center with approval gates
- Transactions, budgets, goals, investments, debt and What-If Lab
- Live Internet Search
- One-Click Full Stock Analysis
- Isolated pseudo paper-trading agent arena
- Financial Health
- Cloud Vault adapter UI
- Persistent Memory
- Local/offline decision engine
- Server-side AI gateway reference (API key stays server-side)

## Production deployment

This repository now includes `render.yaml` for a Node.js Web Service deployment. Render Web Services provide a public `onrender.com` URL for server-side apps like FinPilot, and the service is configured to bind to `0.0.0.0` and use the server health endpoint. citeturn1search1

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shuyeb328-dot/Finpilot-ai-website-)

After deployment, add the `SERPAPI_API_KEY` secret in Render. Do not commit the key to GitHub; Render environment variables are designed for secrets. citeturn1search5

## 2.3 changes
- Schema version `2300`
- Financial Brain domains: profile, transactions, assets, liabilities, recurring obligations, budgets, goals, evidence, findings and decision history
- Structured findings for cash flow, liquidity, debt and goals
- Evidence ledger with confidence values
- Round Table verdicts reference the findings/evidence used
- Local migration from the previous `finpilot_web_v1800` state
- High-impact execution remains approval-gated

## Run
```bash
npm start
```
Then open `http://127.0.0.1:8787/`.

## Optional AI gateway
Set `LLM_API_URL`, `LLM_API_KEY` and optionally `LLM_MODEL` on the server. Never put provider secrets in browser code.

See `FINANCIAL-BRAIN-SCHEMA.md` and `PRODUCT-ARCHITECTURE.md` for the current model.
