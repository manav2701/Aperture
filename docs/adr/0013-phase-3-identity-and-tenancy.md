# 0013 — Phase 3 identity, tenancy and delivery decisions

**Status:** Accepted
**Date:** 2026-09-25

## Context

Phase 3 adds people, organizations and a dashboard on top of the Phase 2 ledger. The plan called for a separate `packages/auth` package, the Better Auth organization plugin, and a Caddy proxy in front of both apps. Interim hosting is Vercel (web) and Render (API) with Neon Postgres, not our own server.

## Decisions

1. **Better Auth does authentication only.** Email and password (verification required, 12+ characters), magic links and Google live in `apps/api/src/auth.ts`. Organizations, members, roles, teams and invitations are Aperture's own tables and routes. The organization plugin's role model didn't fit the team-scoped grants (`team_lead`) or the principal model that agents join in Phase 5. There is no `packages/auth`: only the API uses it.
2. **Permissions are data, and every route declares one.** `packages/core/src/rbac.ts` maps six roles to 13 permissions, with `all` or `team` reach. Routes register through `router.add(access, route, handler)`, and a test fails if an org-scoped route has no permission, or if a public route is added without updating the list.
3. **Other orgs answer 404, never 403.** Resource ids can't be used to learn which organizations exist.
4. **Tenancy is enforced twice.** Handlers filter by `org_id`, and forced row-level security on every tenant table checks `app.org_id`, which `withOrg()` sets per transaction. `withSystem()` is used only for cross-org reads of the caller's own rows (`/me`, invitation acceptance). The API connects as a non-owner role in `aperture_app` so RLS applies; tests use the same kind of role.
5. **One origin for the browser.** Next.js rewrites `/api/*` to the API (`API_INTERNAL_URL`), Better Auth's base URL is the web origin, and cookies are first-party with no CORS. Writes to `/api/v1/*` must carry the web app's `Origin` header (CSRF).
6. **The OpenAPI document is the contract.** It is generated from the route schemas, committed at `docs/api/openapi.json` (a file snapshot test fails when it drifts), and the web app's types are generated from it (a test fails when they drift).
7. **Services ship as ES-module bundles** (`dist/index.mjs`, esbuild), because Better Auth is ESM-only. The API bundle carries its migrations, and `RUN_MIGRATIONS=true` applies them at startup on hosts without a release step.
8. **Postgres 18** in development, tests and Neon.
9. **Strict CSP with per-request nonces** (`apps/web/proxy.ts`). Every page renders dynamically, and the UI avoids inline styles (usage bars are native `<meter>` elements).

## Consequences

- Adding a route means choosing its permission; the registry test enforces this.
- Changing an API schema means refreshing two generated files: `pnpm --filter @aperture/api test -u`, then `pnpm --filter @aperture/web api:types`.
- Team leads can manage budgets below their team's budget and policies of their team and its people, but not the team budget itself or the org policy.
- Policy documents are edited as JSON in Phase 3. A form-based rule builder can come later without API changes.
