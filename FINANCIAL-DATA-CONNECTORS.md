# FinPilot AI 2.9 — Financial Data Connectors & Import Engine

## Import flow
CSV statement → local parser → column mapping → normalization → duplicate fingerprint → Financial Brain → evidence lineage → monitoring.

## Supported CSV shapes
- Date + Description + Amount
- Date + Description + Debit + Credit
- Optional category and account columns

Raw CSV files are parsed locally by the website in this version. No raw statement is sent to an AI provider by the import flow.

## Duplicate protection
Each transaction receives a deterministic fingerprint based on date, type, amount, description and account. Existing fingerprints are skipped.

## Safety
Imports change the local Financial Brain only. No bank transaction is executed and no external financial account is modified.
