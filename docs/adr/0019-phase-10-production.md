# 0019 — Production hardening and launch readiness (Phase 10)

**Status:** Accepted. Built and tested locally; the production environment waits on a server and a domain.
**Date:** 2026-09-29

## Decisions

1. **Two-factor authentication**, using Better Auth's TOTP plugin with backup codes.
   - Owners, admins and finance can read but not change anything until they turn it on (`ENFORCE_TWO_FACTOR`, on by default). Reads stay open so they can reach the setup page.
   - The plugin only guards password sign-in. A session hook refuses magic-link and Google sessions for accounts that have two-factor, so neither can bypass it.
2. **Privacy controls.**
   - Per-org retention for request logs (7–3650 days) and media (1–3650 days), applied daily by `privacy.retention`. Media objects are deleted with their rows.
   - A JSON export of everything, without secrets or key hashes.
   - Owner-only deletion with a 30-day grace period. After it, `privacy.deletions` revokes keys and agents, disables connections and alerts. The final purge is a runbook step, because it is irreversible.
   - The ledger and the audit chain are never deleted (legal hold).
3. **Aperture's own billing** through Stripe Billing: Checkout, the Customer Portal, and a signed webhook that keeps `org_billing` current.
   - Plan limits (members, agents, connections) are enforced **only when billing is configured**, so self-hosted installs are unlimited.
   - Pilots are unlimited until their end date (`admin pilot`).
   - Prices are the vision's hypothesis: Team USD 49, Business USD 499.
4. **Production topology** (`infra/compose.prod.yml`):
   - Caddy for TLS, load balancing and unbuffered streaming;
   - two replicas each of the API and the gateway;
   - the worker;
   - the signer on an internal-only network;
   - Postgres with WAL-G: continuous WAL, nightly base backups, 30-day retention, client-side encryption.
   - The web app stays on Vercel. `compose.selfhost.yml` adds a standalone web image for self-hosting.
5. **Releases:** a `v*` tag builds the images, waits for approval on the GitHub `production` environment, deploys over SSH, migrates once (`MIGRATE_ONLY`), rolls the services, and runs `pnpm smoke`. The gateway drains streams for 60 s on shutdown (O2).
6. **Observability:** a dependency-free Prometheus `/metrics` on each service, behind `METRICS_TOKEN`, scraped by Grafana Alloy into Grafana Cloud. Series:
   - HTTP rate, latency and status by route pattern;
   - gateway outcomes;
   - card decisions and their latency;
   - signer refusals.

   Uptime and the status page come from Better Stack.

7. **Performance:** the local benchmark (`docs/performance.md`) shows the gateway cost is database round trips (about 76 per request), not CPU. Phase 10 caches the standing mandate and model prices; ledger statement batching is next if production misses the 30 ms budget.

## Consequences

- Not done here, because each needs production, money or people:
  - production itself (server, domain, Cloudflare);
  - the ZAP scan and the manual pen-test on production;
  - the external pen test and SOC 2;
  - the docs site build (content is in `docs/guides`);
  - the status page;
  - lawyer review of `docs/legal`;
  - the pilot.
- Existing staging users (owner, admin, finance) must enable two-factor before they can make changes once this deploys. Set `ENFORCE_TWO_FACTOR=false` on Render to postpone that.
