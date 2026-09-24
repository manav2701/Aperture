# @aperture/worker

Aperture background jobs: connector sync, limit mirroring, hold expiry, settlement.

**Today:** only `/healthz` (process up) and `/readyz` (dependencies reachable), via `@aperture/runtime`.
**Built in:** Phase 4 (connector sync, limit mirroring) and later jobs listed in plan/architecture section 16 — see [plan](../../plan/phases/phase-04-provider-connectors/README.md).

```bash
pnpm --filter @aperture/worker dev      # tsx watch, port 4200 (override with PORT)
pnpm --filter @aperture/worker build    # esbuild bundle -> dist/index.cjs
pnpm --filter @aperture/worker test
```

Environment: see [.env.example](.env.example). Container image: `docker build -f infra/docker/service.Dockerfile --build-arg APP=worker .`
