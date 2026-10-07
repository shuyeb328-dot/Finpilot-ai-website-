# FinPilot AI 2.9 — Financial Data Connectors & Import Engine

FinPilot 2.9 adds a local-first financial data ingestion layer.

## Included
- CSV statement import
- Date + description + amount mapping
- Debit + credit mapping
- Optional account/category mapping
- Transaction normalization
- Duplicate fingerprint protection
- Account detection
- Import batch history
- Evidence lineage for imported data
- Normalized CSV export
- Local parsing: raw CSV is not uploaded by this flow
- Existing monitoring, simulations, agent intelligence and learning retained

## Safety boundary
This connector imports and normalizes data. It does not initiate transfers, trades, payments, or other financial transactions.

## Next connector targets
The architecture is ready for authenticated providers later. Provider credentials must remain server-side; browser/mobile builds must never contain provider secrets.

# 3.0 Compliance & Financial Risk

3.0 adds jurisdiction-aware governance controls, an always-visible financial risk notice, Compliance & Risk center, audit events, a compliance endpoint, and server-side AI guardrails. The default product mode is financial information, education and decision support; regulated investment-advice workflows remain disabled unless separately configured and legally reviewed.
