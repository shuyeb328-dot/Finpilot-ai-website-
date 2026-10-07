# FinPilot AI 3.0 — Compliance & Financial Risk Layer

## Purpose
FinPilot defaults to financial information, education, simulation and decision support. It does not execute trades, payments or transfers and does not represent that it is a licensed investment adviser.

## India / SEBI guardrails
The product architecture treats personalized securities advice as a regulated-advice-sensitive workflow. Risk profiling and suitability gates are required before such a workflow can be enabled by an appropriately authorized operator. The application does not itself certify registration or legal compliance.

Official references checked for this build:
- SEBI Investment Advisers Regulations: https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1740726382475.pdf
- SEBI Master Circulars listing: https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6
- SEBI Investor: https://investor.sebi.gov.in/

## Product controls
- No transaction execution.
- No guaranteed-return language.
- Explicit investment-loss warnings.
- Risk-profile and suitability gates for regulated advice mode.
- Evidence/freshness gate for market-sensitive claims.
- Human approval for high-impact actions.
- Local governance/audit events.
- Jurisdiction selector and policy version.

## Important
This implementation is a technical compliance-control layer, not legal advice, a regulatory opinion, registration, certification, or substitute for counsel/compliance review. Requirements can change by jurisdiction, product, service and business model.
