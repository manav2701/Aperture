# @aperture/signer

Aperture internal Solana signing service for approved x402 holds (never exposed publicly).

**Today:** only `/healthz` (process up) and `/readyz` (dependencies reachable), via `@aperture/runtime`.
**Built in:** Phase 9 (x402 signing). Runs on an internal network only and must never get a public route — see [plan](../../plan/phases/phase-09-crypto-x402-rail/README.md).

```bash
pnpm --filter @aperture/signer dev      # tsx watch, port 4300 (override with PORT)
pnpm --filter @aperture/signer build    # esbuild bundle -> dist/index.cjs
pnpm --filter @aperture/signer test
```

Environment: see [.env.example](.env.example). Container image: `docker build -f infra/docker/service.Dockerfile --build-arg APP=signer .`
