# Security review (Phase 10)

This walks the threat model in `plan/security/README.md`. For each control it records the evidence: a test, a configuration file, or a scan. Status:

- **done** means implemented and tested;
- **partial** means implemented with a known gap;
- **open** means not built yet.

Last reviewed: 2026-09-29, at the end of Phase 10 on fakes.

| Threat                                  | Control                                                                                                                            | Status  | Evidence                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Direct database access from the browser | API only; Postgres on an internal network                                                                                          | done    | `infra/compose.prod.yml` (postgres on `internal` only); `infra/supabase/lockdown.sql`                                                            |
| Cross-tenant data access                | Forced RLS on every table with `org_id`; `withOrg` per transaction                                                                 | done    | `packages/db/test/tenancy.test.ts` (enumerates every `org_id` table); `apps/api/test/control-plane.test.ts` "hides other organizations entirely" |
| Broken authorization                    | Every route declares access; team scoping                                                                                          | done    | `control-plane.test.ts` "guards every org-scoped route with a permission"; `packages/core/src/rbac.test.ts`                                      |
| Agent abuses the control plane          | Agent keys only work on gateway routes; control plane needs a session                                                              | done    | Gateway routes use `admit` (keys); API `/api/v1/*` requires a Better Auth session                                                                |
| SSRF                                    | Upstream URLs from a fixed provider list; x402 seller URLs are fetched by the agent, never the server; Semgrep taint rule          | done    | `.semgrep/aperture.yml` `no-fetch-of-request-controlled-url`; `packages/connectors` provider base URLs are constants                             |
| Stolen Aperture key                     | HMAC + pepper, shown once, instant revoke, budgets                                                                                 | partial | `gateway.test.ts` "stops accepting a key the moment it is revoked". **Open:** per-key IP allowlist                                               |
| Stolen provider/admin credentials       | Envelope encryption (AES-256-GCM, KEK outside the DB), never returned                                                              | done    | `packages/crypto` tests; `account.test.ts` export excludes secrets                                                                               |
| Webhook forgery and replay              | Stripe signature on the raw body (5 min tolerance) plus `webhook_receipts`; Slack signing secret (5 min); Stripe Billing signature | done    | `cards.test.ts` (signatures, duplicates); `apps/api/test/slack.test.ts`; `account.test.ts` forged billing webhook                                |
| Signer abuse                            | Separate service and KEK, internal network, shared secret, open-hold-only signing, per-agent rate limit, self-verification         | done    | `apps/signer/src/signer.test.ts`; `apps/gateway/test/x402.test.ts`; smoke: signer has no published port                                          |
| Tampered audit log                      | Hash chain, insert-only role and trigger, offline verifier, optional on-chain anchor                                               | done    | `packages/db/test/audit.test.ts`; `tools/cli` `audit-verify --check-anchor`; `verify-db`                                                         |
| Insider approves own spend              | Separation of duties server-side (dashboard and Slack)                                                                             | done    | `approvals-and-mandates.test.ts`; `slack.test.ts` (owner refused)                                                                                |
| PCI scope creep                         | Card numbers never requested: client guard plus Semgrep rule (object and form-encoded)                                             | done    | `.semgrep/aperture.ts` rule tests; `packages/cards` "refuses to ever ask Stripe for a card number"                                               |
| Supply chain                            | pnpm `minimumReleaseAge`, pinned Actions, gitleaks history scan, `pnpm audit` in CI                                                | done    | `pnpm-workspace.yaml`; `.github/workflows/ci.yml`                                                                                                |
| Secret leakage in logs                  | pino redaction                                                                                                                     | done    | `packages/runtime/src/logger.test.ts`                                                                                                            |
| XSS / CSRF                              | Nonce CSP, `SameSite=Lax`, same-origin writes, no `dangerouslySetInnerHTML`                                                        | done    | `apps/web/proxy.ts`; `sameOriginWrites` in `apps/api/src/http/access.ts`; smoke "web sends a nonce CSP"                                          |
| Brute force / credential stuffing       | Rate limits on auth; **2FA required for owner/admin/finance** before any change; magic link and Google can't bypass it             | done    | `apps/api/test/two-factor.test.ts`                                                                                                               |
| Denial of service                       | Body limits, per-key/org concurrency limits, Cloudflare in front                                                                   | partial | `apps/gateway/src/limits.ts`. **Open:** Cloudflare WAF/rate rules (needs the domain)                                                             |
| x402 seller/facilitator attacks         | Payee binding, per-payment caps, own settlement verification, delivery tracking                                                    | done    | `apps/gateway/test/x402.test.ts`; `packages/jobs` x402 upkeep test                                                                               |
| Prompt exposure                         | Prompt logging off by default; per-org retention                                                                                   | done    | `privacy jobs` test; Settings → Privacy                                                                                                          |

## Scans (2026-09-29)

- Semgrep (`p/typescript`, `p/nodejs`, `p/secrets`, `.semgrep/aperture.yml`): 0 findings.
- Gitleaks, full history: no leaks.
- `pnpm audit --prod --audit-level high`: no high or critical.

## Not yet done (needs production or money)

- An OWASP ZAP authenticated scan of staging, and fixing high/medium findings.
- The "pen-test lite" checklist on production: authorization bypass across orgs and roles, key brute force, webhook forgery, SSRF through every URL input, session fixation, CSRF, media upload validation. Most of these are covered by automated tests; repeat them by hand on production once it exists.
- An external penetration test, once revenue allows.
- SOC 2 evidence collection: access reviews, change management through PRs with branch protection.
