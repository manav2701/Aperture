# @aperture/worker

Runs the background jobs from [`@aperture/jobs`](../../packages/jobs/README.md) (connector sync, alerts, hold expiry, prices, ledger checks) as its own service, with `/healthz` and `/readyz`.

On hosts without background workers, the API runs the same jobs in-process instead (`RUN_WORKER=true`). Don't run both unless you want redundancy: advisory locks keep each job from running twice at once.

Environment: `DATABASE_URL` (the app role), `WEB_ORIGIN`, `APERTURE_KEK_V1`, and optionally `RESEND_API_KEY` and `EMAIL_FROM`.

```bash
pnpm --filter @aperture/worker dev
```
