# Phase 3 — Identity, control-plane API, and the new dashboard shell

**Goal:** real users can sign up, create an organization, invite teammates with roles, and manage budgets and policies through a secure API and a new dashboard — deployed to staging.
**Duration:** ~2.5 weeks.
**Depends on:** Phase 2; Phase 0 infrastructure accounts (domain, server, email, Google OAuth).

## Starting point

Tested core domain (Phase 2); empty `apps/api` and `apps/web`.

## Scope

**In:** Better Auth (email/password, magic link, Google; Microsoft optional); organizations, members, invites, roles, teams, principals; budgets and policies CRUD with the tree; policy simulator endpoint; audit query API; authorization framework; RLS; envelope-encryption package and `connections` table (used in Phase 4); dashboard shell with onboarding, overview (empty states), budgets, policies, members/teams settings, audit list; staging deployment with CI auto-deploy.
**Out:** connectors, gateway, keys (Phases 4–5); SSO/SAML (later).

## Tasks

### 3.1 Auth (`packages/auth`, mounted in `apps/api`)
- Better Auth with Drizzle adapter; plugins: organization, magic link, two-factor (required for owner/admin/finance at first login after Phase 10; optional now).
- Cookie settings: `HttpOnly`, `Secure`, `SameSite=Lax`. Same-origin setup: Caddy routes `app.<domain>/api/*` → `apps/api`, so the browser only ever talks to one origin (no CORS, no cross-subdomain cookies).
- Rate limits on sign-in, sign-up, magic-link, password reset.
- Email via Resend/Postmark with plain, branded templates.

### 3.2 Organizations and people
- Tables: `teams`, `members` (Better Auth), `principals` (auto-created for each member; agents come in Phase 5).
- Endpoints: create org (creator becomes owner; org timezone default `Asia/Dubai`), invite (email link, role, team), accept, change role, remove (guard: never remove the last owner — A5), transfer ownership, teams CRUD, move member between teams (L11).
- Offboarding (A6): removing a member pauses principals they own and flags their agents for reassignment.

### 3.3 Authorization framework (`apps/api/src/authz`)
- `can(actor, action, resource)` implementing the [role table](../../architecture/README.md#11-identity-and-credentials), including team-lead scoping to their team's budget subtree.
- Every route declares `permission` in its OpenAPI definition; a test enumerates routes and fails if any lacks one.
- Postgres RLS on all tenant tables: `USING (org_id = current_setting('app.org_id')::uuid)`; the request middleware runs `SET LOCAL app.org_id` inside each transaction.

### 3.4 Budgets, policies, audit APIs
- `GET/POST/PATCH /budgets` (tree read with usage for the current period; create child; edit limit/period/mode/rails/thresholds; archive — never delete while referenced, L10); timezone change effective next period (L14).
- `GET/PUT /policies/{scope}/{scopeId}` (versioned; Zod-validated), `POST /policies/simulate`.
- `GET /audit` (filters, pagination), `POST /audit/verify` (range), `GET /audit/export` (JSONL stream).
- Every mutation writes an audit event in the same transaction.

### 3.5 Secrets foundation (`packages/crypto`)
- Envelope encryption (AES-256-GCM, random data key, AAD = `org_id|connection_id`), KEK versioning, `rewrap` helper for rotation.
- `connections` table and repository (no connectors yet).

### 3.6 Dashboard shell (`apps/web`)
- Layout with role-aware navigation ([frontend IA](../../frontend/README.md#information-architecture)); org switcher; user menu.
- Pages: sign-in/up, invite accept, onboarding (create org → set timezone → first budget), Overview (empty states pointing to Connections), Budgets tree editor, Policies (rule cards + templates + simulator), Settings → Members, Teams, Org; Audit list + verify + export.
- Typed API client generated from OpenAPI (`openapi-typescript` + `openapi-fetch`).

### 3.7 Staging deployment
- `infra/compose.staging.yml`, `Caddyfile`, `deploy.sh`, `rollback.sh`; SOPS-encrypted `staging.env.sops`.
- GitHub Actions: on merge to `main`, build/push images to GHCR, deploy to staging, run smoke test.
- Cloudflare DNS: `staging-app.<domain>` (web + `/api`), later `staging-gw.<domain>`.
- Sentry and OpenTelemetry wired for web and api.

## Edge cases covered

L10, L11, L12 (UI warning), L14, P10 (agent keys rejected by control plane — route guard in place now), A5, A6.

## Tests

- **Unit:** `can()` truth table (every role × action × own/other team); invite token expiry; timezone-change scheduling.
- **Integration:** every route with (a) no session → 401, (b) wrong org → 404/403, (c) insufficient role → 403, (d) correct role → 2xx — generated from the route table; RLS test that a query with `app.org_id` of org A can't read org B rows even with a forged `WHERE`.
- **E2E (Playwright):** sign up → create org → invite second user (use a test mailbox such as Mailpit in dev) → accept → owner builds a 3-level budget tree → member sees only their own spend page → auditor can export audit and can't edit budgets.
- **Security:** ZAP baseline against staging; Semgrep clean.

## Security checklist

- [ ] Every route has a declared permission (test)
- [ ] Cross-org access tests pass; RLS enabled on all tenant tables
- [ ] Auth rate limits active; cookies `Secure`/`HttpOnly`/`SameSite=Lax`
- [ ] CSP header set; no inline scripts except Next nonce
- [ ] Secrets only via SOPS on the server; none in CI logs
- [ ] Audit event for every mutation

## Deployment

Staging live at `staging-app.<domain>` with auto-deploy from `main`. Nightly database backup (full WAL-G setup comes in Phase 10; a nightly `pg_dump` to object storage is enough for staging now).

## Try it yourself

1. Open `https://staging-app.<domain>`, sign up with your email, create "Aperture Test Org".
2. Invite a second email as **Finance** and a third as **Member** (Marketing team). Accept both invites in private windows.
3. As owner: build Org USD 500/month → Marketing USD 200/month → Member USD 20/day.
4. As Member: confirm you can't open Budgets editing or Settings.
5. Policies → Marketing → add "allow models `openai/gpt-4o*`, `anthropic/claude-*`" and "approval over USD 5". Use the **simulator**: Member, model `openai/o3`, USD 1 → **deny** with reason; `anthropic/claude-sonnet-5`, USD 7 → **require approval**.
6. Audit → Export → run `pnpm audit-verify export.jsonl` locally → "valid"; edit one character → "invalid at seq N".

## Exit criteria

- [ ] All "try it yourself" steps pass on staging
- [ ] Authorization and RLS test suites green
- [ ] Auto-deploy to staging on merge works, with rollback tested once

## Risks / open questions

- Better Auth version churn: pin the version; upgrade deliberately with the changelog.
