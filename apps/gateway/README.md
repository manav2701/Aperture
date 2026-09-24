# @aperture/gateway

Aperture data plane: governed AI passthrough, media jobs, x402 authorization.

**Today:** only `/healthz` (process up) and `/readyz` (dependencies reachable), via `@aperture/runtime`.
**Built in:** Phase 5 (text gateway), Phase 6 (media), Phase 9 (x402 authorize) — see [plan](../../plan/phases/phase-05-ai-gateway-text/README.md).

```bash
pnpm --filter @aperture/gateway dev      # tsx watch, port 4100 (override with PORT)
pnpm --filter @aperture/gateway build    # esbuild bundle -> dist/index.cjs
pnpm --filter @aperture/gateway test
```

Environment: see [.env.example](.env.example). Container image: `docker build -f infra/docker/service.Dockerfile --build-arg APP=gateway .`
