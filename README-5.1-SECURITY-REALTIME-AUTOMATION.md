# FinPilot 5.1 — Security, Real-Time Automation & Bounded Agent Autonomy

- Hardened security headers: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS in production.
- Server-side rate limiting.
- Server-side SSE market stream with explicit live/unavailable status.
- Bounded agent auto-optimization for refresh cadence, cache TTL and concurrency.
- Agents cannot alter compliance rules, execution guards, credentials, or place trades.
- Human approval remains mandatory for high-impact financial actions.
- No secrets are sent to the browser.
