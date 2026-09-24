# @aperture/api

Aperture control-plane API: orgs, members, budgets, policies, approvals, audit, inbound webhooks.

**Today:** only `/healthz` (process up) and `/readyz` (dependencies reachable), via `@aperture/runtime`.
**Built in:** Phase 3 (identity, orgs, budgets, policies, audit) and grows through Phase 8 (card webhooks) — see [plan](../../plan/phases/phase-03-identity-and-control-plane/README.md).

```bash
pnpm --filter @aperture/api dev      # tsx watch, port 4000 (override with PORT)
pnpm --filter @aperture/api build    # esbuild bundle -> dist/index.cjs
pnpm --filter @aperture/api test
```

Environment: see [.env.example](.env.example). Container image: `docker build -f infra/docker/service.Dockerfile --build-arg APP=api .`
