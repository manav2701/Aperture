# Code conventions (and how we avoid slop code)

The goal: any competent TypeScript developer can open any file and understand it without the author in the room. These conventions are enforced by tooling where possible and by the review checklist otherwise.

## Repository and structure

- pnpm workspaces + Turborepo. Apps in `apps/`, libraries in `packages/`, one-off tools in `tools/`, infrastructure in `infra/`, documentation in `docs/`.
- Package names `@aperture/<name>`. Apps depend on packages; packages never depend on apps.
- **Dependency direction**: `core` depends on nothing internal (pure). `db` depends on `core`. `connectors` depend on `core`. Apps compose everything. Enforced by `eslint-plugin-boundaries` (or dependency-cruiser).
- Feature folders inside apps (`apps/api/src/budgets/{routes,service,schemas}.ts`), not "controllers/, services/, models/" spread across the tree.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- **No `any`** (lint error). Use `unknown` and narrow with Zod.
- Money is `Micros` (branded `bigint`) — lint rule bans arithmetic on `number` in money modules and bans `parseFloat` in `packages/core/money`.
- IDs are branded strings per entity (`BudgetId`, `PrincipalId`) so they can't be swapped by accident.
- Prefer plain functions and plain objects; classes only for things with lifecycle (clients, connectors).
- Named exports only (except where Next.js requires default exports).

## Validation and errors

- **Zod at every boundary**: HTTP input, webhook payloads, env vars (`packages/config/env.ts` parses `process.env` once at startup and exits on missing/invalid values — no hardcoded fallbacks for secrets or URLs).
- Errors: throw `AppError` subclasses with a stable `code` (`budget_exceeded`, `policy_denied`, `not_found`, …) and HTTP mapping in one place. No `catch {}` that swallows errors; no `catch` that only logs and continues unless it's explicitly best-effort and says why in a comment.
- Never return stack traces or internal messages to clients.

## Data access

- All SQL through Drizzle in `packages/db`. Repositories take a `tx` parameter so callers control transactions.
- Every tenant query takes `orgId` explicitly; RLS is defence in depth, not the primary check.
- Money-moving operations (`reserve`, `settle`, `release`, …) live only in `packages/db/ledger` and are the only code allowed to write `budget_usage`, `holds`, `ledger_entries`.
- Timestamps are `timestamptz`, always UTC in the DB; time decisions use the DB's `now()` inside the transaction.

## HTTP services

- Hono with `@hono/zod-openapi`: every route declares its input/output schemas and its required permission; the OpenAPI document is generated and committed to `docs/api/`.
- Middlewares: request id, logging, auth (session or Aperture key), org scope, permission check, rate limit, body size limit.
- Health: `/healthz` (process up), `/readyz` (DB reachable, migrations current).

## Logging and observability

- pino, JSON, one logger per module with a `module` field. Levels: `error` (needs a human), `warn` (unexpected but handled), `info` (state changes), `debug` (off in prod).
- No `console.log` in committed code (lint).
- Redaction list maintained in `packages/config/logging.ts`; test asserts secrets never appear.

## Frontend

- Server components for data reads, client components only for interaction.
- No `alert()`/`confirm()` (lint); use the toast and dialog components.
- No business rules in React — show what the API says.
- Forms with react-hook-form + shared Zod schemas.

## Testing

- Tests live next to code (`*.test.ts`) except e2e (`apps/web/e2e/`) and load (`tools/load/`).
- Every bug fix starts with a failing test.
- Property tests for anything with an invariant (see [testing](../testing/README.md#invariants-and-their-property-tests)).
- No mocks of our own database in integration tests — use Testcontainers.
- Test names describe behaviour: `denies when team budget is exhausted even if agent budget has room`.

## Git and reviews

- Branch per phase task: `phase-3/budgets-api`. Small PRs (< 400 lines changed where possible).
- **Conventional Commits** (`feat(gateway): …`, `fix(ledger): …`, `chore(ci): …`).
- Every PR: what/why, how to test, screenshots for UI, checklist below.
- `main` is always deployable; staging deploys from `main`.
- Architectural decisions → a short ADR in `docs/adr/NNNN-title.md` (context, decision, consequences).

## The anti-slop rules

"Slop" is code that looks finished but isn't: mocks in production paths, silent fallbacks, copy-pasted logic, comments that narrate instead of explain. Examples from the current repo and the rule that prevents each:

| Slop pattern (seen in the current repo) | Rule |
|---|---|
| Mocked responses shipped to users ([gateway/page.tsx:180](../../webapp/app/gateway/page.tsx#L180)), `Math.random()` metrics ([treasury/page.tsx:39](../../webapp/app/treasury/page.tsx#L39)) | No fake data outside tests and seed scripts. Empty states instead. Lint rule bans `Math.random` outside tests. |
| Hardcoded fallbacks for secrets and URLs ([lib/supabase.ts:15](../../webapp/lib/supabase.ts#L15)) | Env parsed by Zod at startup; missing → crash with a clear message. |
| `catch (e) { /* Ignored */ }` ([gateway/page.tsx:163](../../webapp/app/gateway/page.tsx#L163)) | No empty catches (lint). Best-effort paths log a `warn` with context and a comment explaining why it's safe. |
| Same key-generation code in three places (gateway server, two pages) | One implementation in a package; UI never generates secrets. |
| README claims features the code doesn't have | README and docs are updated in the same PR as the behaviour; "Definition of done" includes docs. |
| Comments that restate code ("// Log request asynchronously") | Comments explain *why* or document a non-obvious constraint (e.g., "Stripe gives us 2 s; no network calls on this path"). |
| Unused schema (Prisma) and dead scripts in `package.json` | `knip` in CI reports unused files, exports, and dependencies. |
| Emoji-laden console output and marketing language in code | Plain log messages with structured fields. |
| One 500-line page component | Components > 200 lines or functions > 50 lines need a reason in review. |

## Definition of done (every task)

- [ ] Behaviour implemented with no mocks in production code paths
- [ ] Unit tests; property tests if there's an invariant; integration test if it touches the DB or an external API
- [ ] Types strict, lint clean, `knip` clean
- [ ] Errors mapped to stable codes; logs structured and redacted
- [ ] Audit events emitted for decisions and configuration changes
- [ ] Docs updated (README of the package/app, API docs, runbook if operational)
- [ ] Security checklist of the phase reviewed
- [ ] Deployed to staging and the phase's "try it yourself" step for this feature passes
