# FinPilot AI Operating Layer

## Purpose

FinPilot uses one operating layer to report the status and relationships of its existing OS components. The operating layer composes, rather than replaces, the existing market-data, specialist-agent, evidence, learning, research, Training Fabric, risk, security, and evolution modules.

## Operating planes

The control-plane endpoint `GET /api/os-control-plane` returns the central `OS_REGISTRY`, the status and evidence level of every registered OS, grouped plane readiness, learning status, and safety policy.

- **Orchestration and Workspace:** main core, decision brain, unified workspace.
- **Agents, Mesh and Memory:** specialist agent scheduling, managed Agent Factory, and decision memory.
- **Data and Market Intelligence:** market/data source quality, search and research, and the shared market stream hub.
- **Training, Research and Evolution:** forecast outcome learning, Training Fabric, autonomous research, and candidate evolution.
- **Safety and Governance:** AI security, trading/risk policy, release governance, and optional routing integrations.

Status must remain truthful. A missing adapter or absent telemetry is not a healthy status. The market stream is on-demand: no subscribers does not mean a failure.

## Managed Agent Factory

The server endpoint `GET /api/ai-os/agents` lists declarative specialist definitions; `POST /api/ai-os/agents` validates and registers them. A definition has a name, role, objective, bounded interval, domain and allowlisted data scopes. Arbitrary code, credentials, money movement, live orders and automatic execution are not supported by this registry.

Creating a managed agent registers a definition only. Scheduling and executing arbitrary new agent behavior require a separate reviewed capability; the current API must not suggest otherwise. Agents remain user-triggered and any high-impact action remains approval-gated.

When `DATABASE_URL` is configured and the PostgreSQL table is available, definitions are stored in `finpilot_ai_os_agents` and restored at process startup. Without a working database, the registry reports `PROCESS_MEMORY` and `persistent:false`; definitions may be lost at restart. Client-local definitions are still maintained by the browser UI, and registry-sync failure must be visible.

## Training and continuous learning

The existing Deep Learning OS measures timestamped forecasts against later matching market observations and stores its current forecast ledger in browser local storage. The browser Training Fabric performs curriculum evaluation, red-team cases, simulations, calibration and promotion staging; it is also browser-local today. Those features evaluate agent behavior; they do not fine-tune foundation-model weights.

The server autonomous research scheduler is opt-in through `FINPILOT_AUTO_RESEARCH=true` and needs a valid configured search provider. It must not be enabled without checking provider limits, API cost, database persistence and hosting constraints.

Continuous operations require more than a browser tab or an interval timer. Reliable 24/7 operation requires an always-on worker/scheduler, persistent database, health monitoring, restart-safe job claims, bounded retries, source rate limits, and alerts. A free web host may sleep or restart; therefore the web process by itself must not be advertised as a 24/7 guarantee.

## Market Training OS

The server-side `server/ai-os-market-training.mjs` worker is the first durable market-learning pipeline. It ingests a bounded configurable watchlist (default: BTC, ETH, SPY and NIFTY), accepts only provider-verified live snapshots with a non-unknown source timestamp, de-duplicates observations, and stores them in PostgreSQL when configured. After sufficient observations, it creates a transparent momentum-baseline forecast; later matching quotes after the horizon settle that forecast and produce Brier/log-loss scores. This is an evaluation baseline, not an AI foundation model, and its probabilities are not declared calibrated.

The worker is opt-in. Automatic scheduling requires all three: `FINPILOT_AI_OS_TRAINING_ENABLED=true`, a working `DATABASE_URL`, and the market snapshot adapter. Default interval is 15 minutes, bounded to 5–60 minutes; default forecast horizon is 60 minutes and bounded to 15–240 minutes. `FINPILOT_AI_OS_TRAINING_WATCHLIST` can configure up to eight symbols. If PostgreSQL is absent or fails, the worker reports memory-only or database-error status and will not start its automatic timer. An operator-triggered cycle endpoint is disabled unless `FINPILOT_AI_OS_MANUAL_CYCLE_ENABLED=true`, because it makes external market-data requests.

This worker does not yet fine-tune a foundation model or change specialist-agent behavior. It builds durable, scored market evidence that can become a training/evaluation dataset. Do not label the system as continuously learning from global markets until this worker is enabled with persistence and an always-on host, and the stored forecasts are accumulating and being settled. A free web service that sleeps cannot guarantee 24/7 operation.

Endpoints:
- `GET /api/ai-os/training/status`: schedule, storage, data/forecast counts, outcome metrics and blockers.
- `POST /api/ai-os/training/cycle`: bounded read-only cycle only when the manual-cycle feature flag is enabled; it never places orders.

## Promotion gates

Candidate improvements should be benchmarked against a fixed baseline on chronological, held-out data. Promotion checks should include accuracy and probability calibration, net simulated returns after costs where applicable, drawdown/risk regressions, data-source freshness, and safety tests. Shadow or canary evaluation does not equal verified improvement. There is no automatic source-code mutation, automatic candidate promotion or live-money execution in this operating layer.

## API and verification

- `GET /api/os-control-plane`: all OS modules, status evidence and five operating planes.
- `POST /api/os-control-plane/cycle`: produces a bounded status-driven read-only plan; it does not perform external actions.
- `GET /api/ai-os/agents`: managed-agent registry and persistence status.
- `POST /api/ai-os/agents`: validates and stores a declarative specialist definition only.

The CI contract covers registry membership, operating-plane readiness bounds, explicit no-execution guarantees, managed-agent scope validation, duplicate prevention, interval validation and UI status visibility.
