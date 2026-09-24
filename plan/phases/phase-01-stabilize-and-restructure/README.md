# Phase 1 — Stabilize, secure, restructure

**Goal:** shut off everything unsafe in the current deployment, archive the hackathon code without losing it, and stand up a clean, conventional monorepo with CI — so every later phase builds on solid ground.
**Duration:** ~1.5 weeks.
**Depends on:** Phase 0 "Phase 1 blockers".

## Status (2026-09-24): code complete, operational steps pending

Done on branch `phase-1/stabilize-and-restructure`:

- [x] Supabase exposure confirmed by a read-only probe: every public table readable with the public key, including 10 plaintext mnemonics. Lockdown script written: [`infra/supabase/lockdown.sql`](../../../infra/supabase/lockdown.sql)
- [x] Open proxy and demo payment routes deleted; hardcoded Supabase fallbacks removed (commit before archiving, so it can be deployed on its own)
- [x] `legacy-v0` tag (local); hackathon code moved to `legacy/` with a README; third-party docs, duplicate frames, junk configs deleted
- [x] Monorepo: pnpm 11 + Turborepo; `packages/config`, `packages/runtime`; `apps/api|gateway|worker|signer` (Hono, health endpoints, esbuild bundles); `apps/web` (Next.js placeholder)
- [x] Tooling: strict TypeScript 6.0, ESLint (typescript-eslint strict + anti-slop rules), Prettier, Vitest, knip, legacy-import guard, custom Semgrep rules with tests, Gitleaks with reviewed ignore list, Renovate
- [x] CI (`.github/workflows/ci.yml`, actions pinned to SHAs, actionlint-clean): quality, security, and per-service image build + smoke test
- [x] Local dev stack (`infra/compose.dev.yml`), shared service Dockerfile
- [x] README, CONTRIBUTING, SECURITY, ADRs 0001–0011

Pending — needs you (see the final report / Phase 0):

- [ ] Run `infra/supabase/lockdown.sql`, rotate Supabase keys, verify with the curl below
- [ ] Empty any real funds from the 10 wallets whose mnemonics were exposed
- [ ] Rotate the OpenRouter key used by the old Railway gateway
- [ ] Push the branch and tag, open the PR, confirm CI green, enable branch protection
- [ ] Vercel: set Root Directory to `apps/web` (the old `webapp/` path no longer exists)

Deviations from the original task list, all recorded in [ADR 0011](../../../docs/adr/0011-phase-1-tooling.md): pnpm 11 instead of 10; TypeScript pinned to 6.0; no empty placeholder packages; esbuild instead of tsup; no pre-commit hooks; shadcn/ui deferred to Phase 3. The Docker Compose stack and service Dockerfile were validated statically on the development machine (Docker Desktop was not running); CI builds and smoke-tests every image.

## Starting point

The repository at `d9e0687` as described in [current-state](../../current-state/README.md): security findings S1–S10, mocks in the UI, Stacks leftovers, three Anchor programs, no CI.

## Scope

**In:** emergency lockdown; archive/delete per the inventory; monorepo skeleton with empty apps and packages; tooling (TypeScript, ESLint, Prettier, Vitest, fast-check, knip, Semgrep, gitleaks, Renovate); CI; local dev stack; new README, SECURITY.md, CONTRIBUTING.md, ADRs.
**Out:** any product feature (that starts in Phase 2).

## Tasks

### 1.1 Emergency lockdown (day 1, before anything else)

1. Supabase dashboard → Table editor → for **every** table: enable RLS and remove any permissive policies (deny all by default). Confirm with the anon key:
   ```bash
   curl "https://<project>.supabase.co/rest/v1/policies?select=*" \
     -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"
   # expected: [] or a permission error — never rows
   ```
2. Export demo data (CSV) from the Supabase dashboard into a private location **outside** the repo.
3. `UPDATE policies SET agent_mnemonic = NULL;` then `ALTER TABLE policies DROP COLUMN agent_mnemonic;`. Move any real funds out of wallets whose phrase was stored (Phase 0 list).
4. Rotate the Supabase anon/publishable and service-role keys (Settings → API).
5. Remove `OPENROUTER_API_KEY` from the running gateway deployment and **rotate the key at OpenRouter**; stop the old gateway service.
6. Delete `webapp/app/api/proxy/`, `webapp/app/api/compute/`, `webapp/app/api/weather/`, redeploy (or take the old webapp offline).
7. Remove hardcoded Supabase fallbacks from `webapp/lib/supabase.ts` and `gateway/src/index.ts` (they're archived next, but the deployed copy must not carry them).
8. Commit: `fix(security): shut off open proxy and unauthenticated endpoints`.

### 1.2 Archive the hackathon code

1. Tag the current state: `git tag legacy-v0 && git push origin legacy-v0`.
2. Create `legacy/` and `git mv` into it: `programs/`, `patches/`, `Anchor.toml`, `Cargo.toml`, `Cargo.lock`, `tests/`, `examples/`, `sdk/`, `adapters/`, `webapp/`, `gateway/`, `scripts/`, `supabaseConfig.sql`, and the Stacks-era `docs/*.md` + `docs/*.sql` + `docs/n8n-workflow.json` (to `legacy/docs/`).
3. Delete (recoverable from `legacy-v0`): `docs/ezgif-124788c760f338a2-jpg/` (duplicate of the webapp frames), `docs/*.pdf`, `docs/*.docx`, `docs/stacks docs.txt`, `docs/x402_docs.txt`, `legacy/webapp/netlify.toml`, `legacy/gateway/prisma/`, `tmp-aperture-ws/`.
4. Add `legacy/README.md`: what's here, why it's archived, the security warnings (S1–S6), "not built or deployed".
5. Update links inside `plan/` that pointed at the old paths (e.g. `../../webapp/...` → `../../legacy/webapp/...`).

### 1.3 Monorepo skeleton

```
pnpm-workspace.yaml     packages: apps/*, packages/*, tools/*
turbo.json              pipelines: build, dev, lint, typecheck, test, test:integration
package.json            root scripts, packageManager: pnpm@11.x, engines.node: >=24
.nvmrc                  24
(pnpm-workspace.yaml)    minimumReleaseAge + allowBuilds (pnpm 11 keeps these settings in the workspace file)
```

1. `packages/config`: `tsconfig.base.json` (strict flags from [conventions](../../conventions/README.md#typescript)), ESLint flat config (typescript-eslint `strictTypeChecked`, `no-console`, `no-restricted-syntax` for `Math.random`/`alert`, boundaries plugin), Prettier config, Vitest preset, `env.ts` helper (Zod env parsing).
2. Empty packages with `src/index.ts` and one trivial test each: `core`, `db`, `connectors`, `auth`, `crypto`, `sdk`, `mcp`, `ui`.
3. Apps:
   - `apps/api`, `apps/gateway`, `apps/worker`, `apps/signer`: Hono (worker/signer minimal), `/healthz` and `/readyz`, pino logger, env parsing, Dockerfile (multi-stage, non-root).
   - `apps/web`: Next.js App Router, TypeScript, Tailwind v4, a placeholder page, fonts and palette from the legacy app (shadcn/ui is set up in Phase 3 with the first real components).
4. `infra/compose.dev.yml`: Postgres 17 (with a named volume), MinIO; `.env.example` per app (no real values).

### 1.4 Tooling and CI

1. Vitest workspace config; `fast-check` installed in `packages/core`.
2. `knip` config; Semgrep with `p/typescript`, `p/nodejs`, `p/secrets` rules + two custom rules (no `expand: ['number']` on Stripe calls; no `Math.random`).
3. `gitleaks` in CI with a reviewed `.gitleaksignore`. (Pre-commit hooks were dropped — see ADR 0011.)
4. Renovate config: weekly grouped updates, `minimumReleaseAge: 3 days`, automerge only for patch devDependencies.
5. `.github/workflows/pr.yml`: install (frozen lockfile, cache) → typecheck → lint → test → knip → Semgrep → gitleaks → `pnpm audit --prod --audit-level high` → build all. **All third-party actions pinned to commit SHAs.** Least-privilege `permissions:` block.
6. `.github/CODEOWNERS`, PR template with the Definition-of-done checklist.

### 1.5 Documentation

1. New root `README.md`: what Aperture is (from [vision](../../vision/README.md)), current status ("rebuilding — see plan/"), how to run locally, repo map.
2. `CONTRIBUTING.md` (conventions summary, commit style, how to run tests), `SECURITY.md` (how to report vulnerabilities).
3. `docs/adr/0001…0010` from the [ADR index](../../architecture/README.md#adr-index) — one page each: context, decision, consequences.

## Edge cases covered

O8 (supply chain) via pnpm settings, pinned actions, Renovate delay.

## Tests

- Each package/app has at least one passing test so the pipeline is proven end to end.
- A CI job that fails if any file outside `legacy/` imports from `legacy/`.
- Semgrep custom rules have their own test fixtures (a file that must trigger, one that must not).

## Security checklist

- [ ] Anon key can't read or write any table (1.1 step 1 command returns nothing)
- [ ] Old proxy route returns 404 on the deployed old app (or the app is offline)
- [ ] OpenRouter key rotated; old key revoked
- [ ] No hardcoded URLs/keys in non-legacy code (`gitleaks` + Semgrep clean)
- [ ] GitHub Actions pinned by SHA; `permissions: contents: read` default
- [ ] Branch protection on `main` enabled

## Deployment

Nothing new is deployed in this phase. The old deployments are locked down or taken offline (1.1).

## Try it yourself

1. Run the curl in 1.1 step 1 with the (new) anon key → no rows.
2. Open the old proxy URL (`https://<old-app>/api/proxy?target=https://example.com`) → 404 or offline.
3. Clone fresh, then:
   ```bash
   corepack enable && pnpm install
   docker compose -f infra/compose.dev.yml up -d
   pnpm dev            # starts web on :3000, api on :4000, gateway on :4100
   curl localhost:4000/healthz   # {"status":"ok"}
   curl localhost:4100/healthz
   pnpm test && pnpm lint && pnpm typecheck
   ```
4. Open a PR with a trivial change → all CI checks run and pass; try adding `Math.random()` in `packages/core` → CI fails with the lint rule.

## Exit criteria

- [ ] Security checklist complete
- [ ] `legacy-v0` tag exists; `legacy/` contains the archived code; deletions done
- [ ] `pnpm install && pnpm dev && pnpm test` work on a clean clone
- [ ] CI green on `main`, required for merge
- [ ] README, CONTRIBUTING, SECURITY, ADRs committed

## Risks / open questions

- If the old deployments can't be accessed (lost credentials), revoke the OpenRouter key and rotate Supabase keys anyway — that neutralizes S1 and S5.
