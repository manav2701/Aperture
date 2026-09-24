# Phase 10 — Production hardening, deployment, and launch

**Goal:** a production environment that is secure, observable, backed up, and supportable; Aperture's own billing and legal documents; and the design-partner pilot running on production.
**Duration:** ~2.5 weeks.
**Depends on:** Phases 1–9 (Phase 9 mainnet only if the legal opinion allows).

## Starting point

All features on staging with auto-deploy; basic monitoring; nightly `pg_dump` for staging.

## Scope

**In:** production infrastructure; zero-downtime deploys; WAL-G backups and restore drill; full monitoring/alerting and runbooks; security review; load and chaos testing; data retention and privacy controls; 2FA enforcement for privileged roles; Aperture's subscription billing; legal docs; docs site; self-host bundle v1; status page; pilot launch.
**Out:** multi-region; Kubernetes; SOC 2 audit (start the evidence collection, not the audit).

## Tasks

### 10.1 Production infrastructure
- `infra/compose.prod.yml` on the production server (separate from staging, or same host with strict separation if budget requires — separate is recommended).
- Two replicas each of `api` and `gateway` behind Caddy with health-based routing; graceful shutdown (drain in-flight streams, finish settlements) (O2).
- Cloudflare: proxied DNS for `app.`/`api.` paths, WAF managed rules, rate-limit rules on auth endpoints; `gw.` proxied with streaming-compatible settings (or DNS-only if buffering interferes — test).
- Production secrets via SOPS; KEKs generated fresh (never reuse staging KEKs) and backed up offline (O6).

### 10.2 Backups and recovery
- WAL-G continuous archiving + nightly base backups to object storage, encrypted; 30-day PITR.
- `restore-drill.sh`: restore into a scratch DB, run `ledger.verify` and audit chain verification on the restored data, report timings (O4). Run it now and monthly.
- Media bucket versioning and lifecycle.

### 10.3 Observability and runbooks
- Dashboards: gateway (rps, overhead p50/p99, errors by type), decisions (allow/deny/approval rates), card webhook latency and timeouts, connectors (lag, errors, revokes), holds (open by rail, expired_reconciling), signer (signatures, refusals), ledger drift, DB (connections, locks, slow queries).
- Alerts from [deployment](../../deployment/README.md#monitoring-and-alerting) wired to email + a phone push (Better Stack / Pushover).
- `docs/runbooks/`: one page per alert + procedures: rotate a KEK, revoke everything for an org (incident), restore from backup, roll back a deploy, add a connector credential for a customer.

### 10.4 Security review
- Walk the [threat model](../../security/README.md) table and tick each control with evidence (test name, config, screenshot).
- Semgrep full scan, `pnpm audit`, dependency licence check, gitleaks full history.
- OWASP ZAP authenticated scan on staging; fix high/medium.
- "Pen-test lite" checklist: authz bypass attempts across orgs/roles, key brute force/rate limits, webhook forgery, SSRF attempts through every URL-like input, session fixation, CSRF, file upload (media) validation.
- Enforce 2FA for owner/admin/finance.
- Consider an external pen test once revenue allows; start SOC 2 evidence collection (policies, access reviews, change management via PRs).

### 10.5 Load and chaos
- k6 against staging with production-like data: gateway 500 rps (fake upstream), card webhook 50 rps, 200 concurrent reserves on one budget; record baselines in `docs/performance.md`.
- Chaos: stop Postgres under load → fail-closed verified (O1); kill the worker 30 min → catch-up correct; restart gateway during streams → no lost settlements (O2); noisy-tenant test with per-org limits (O7).

### 10.6 Privacy and data controls
- Org settings: prompt logging level, retention days for request logs, media, and prompts; data export for an org (JSON/CSV); org deletion (with legal hold exception for audit data per contract).
- DPA template and sub-processor list (hosting, email, Sentry, Grafana, RPC providers) published.

### 10.7 Aperture's own billing
- Stripe Billing: products/prices for the plans in [vision](../../vision/README.md#business-model-hypothesis-to-validate-with-pilots); Checkout for sign-up; Customer Portal for plan changes and invoices; webhook to set plan limits (seats, connections, rails) enforced by the API.
- Pilot organizations flagged "pilot" (no billing) with an end date.

### 10.8 Docs and onboarding
- Docs site at `docs.<domain>` (Starlight or Nextra) generated from `docs/`: getting started, connecting each provider (with screenshots), gateway usage with OpenAI/Anthropic SDKs, SDK and MCP reference, cards, x402, audit verification, security overview, self-hosting.
- In-app onboarding checklist: connect first provider → create teams → set budgets → invite members → create first agent.

### 10.9 Self-host bundle v1
- Signed images + `compose.selfhost.yml` + `SELF_HOSTING.md` (requirements, env, backups, upgrades). Test an install on a clean VM in a UAE region (e.g. AWS `me-central-1`) to validate the residency story.

### 10.10 Launch
- Status page (Better Stack) at `status.<domain>`.
- Production smoke suite runs after every deploy.
- **Pilot kickoff** with the design partner: onboarding session, success criteria from Phase 0, weekly check-ins, a feedback channel.
- Public launch content: technical posts (ledger with holds; x402 allowance design; hash-chained audit) for the Solana and AI engineering communities.

## Edge cases covered

O1–O8, G15.

## Tests

- Restore drill passes with verification.
- Chaos scenarios pass with expected behaviour.
- Load baselines meet the [performance budgets](../../architecture/README.md#20-performance-budgets).
- Security review checklist complete with evidence.
- Full Playwright suite on production (against a dedicated internal test org) after deploy.

## Security checklist

- [ ] Fresh production KEKs, offline backups verified
- [ ] 2FA enforced for privileged roles
- [ ] WAF + rate limits active; origin server only accepts Cloudflare IPs for app/api
- [ ] SSH: key-only, no root login, fail2ban, unattended security upgrades
- [ ] Postgres not exposed; backups encrypted
- [ ] Incident response runbook rehearsed once (tabletop)

## Deployment

Production live at `app.<domain>` / `gw.<domain>`; release process = tag → approval → deploy → smoke → monitor. Staging remains the pre-production gate.

## Try it yourself

1. Tag `v1.0.0` → approve the production deployment in GitHub → watch the smoke tests pass.
2. Run `infra/scripts/restore-drill.sh` → it prints restore time and "ledger verified, audit chain verified".
3. During a k6 run on staging, stop Postgres → gateway returns 503, card authorizations time out to decline; start it → recovery without drift.
4. Sign up a new org on production through Stripe Checkout (test mode first, then live) → plan limits applied.
5. Walk through the design-partner onboarding checklist yourself on production with your own accounts.

## Exit criteria

- [ ] Production running with backups, monitoring, alerts, runbooks
- [ ] Security review complete; no open high findings
- [ ] Billing live; legal docs published
- [ ] Design partner onboarded on production and using it weekly

## After Phase 10 (roadmap candidates, driven by pilot feedback)

- Microsoft Teams approvals; SSO/SAML self-service; Arabic/RTL UI.
- Browser extension for shadow-AI discovery and blocking.
- Swig/Squads on-chain policy for customers who want it; MPP (Stripe/Tempo) connector; EVM x402.
- Verifiable-credential export of mandates (AP2 compatibility).
- UAE-hosted region; SOC 2 Type I.
