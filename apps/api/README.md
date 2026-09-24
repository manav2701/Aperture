# @aperture/api

Aperture control-plane API: authentication, organizations, members and invitations, teams, principals, budgets, policies (with a simulator) and the audit log. Card webhooks and approvals come in later phases.

- Routes live in `src/routes/`, and each declares the permission it needs (`src/http/access.ts`).
- Contract: [docs/api/openapi.json](../../docs/api/openapi.json), also served at `/api/v1/openapi.json`.
- Design decisions: [ADR 0013](../../docs/adr/0013-phase-3-identity-and-tenancy.md).

```bash
pnpm --filter @aperture/api dev        # tsx watch, port 4000; reads ../../.env
pnpm --filter @aperture/api build      # esbuild bundle -> dist/index.mjs (+ dist/migrations)
pnpm --filter @aperture/api test       # Postgres in Docker via Testcontainers
pnpm --filter @aperture/api test -u    # also refreshes docs/api/openapi.json
```

## Environment

| Variable                                   | Required          | Notes                                                                                                   |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | yes               | Non-owner role in `aperture_app`, so row-level security applies                                         |
| `DATABASE_MIGRATION_URL`                   | no                | Owner connection for migrations; defaults to `DATABASE_URL`                                             |
| `RUN_MIGRATIONS`                           | no                | `true` applies migrations at startup                                                                    |
| `WEB_ORIGIN`                               | yes               | Public web origin, e.g. `https://aperture-1.vercel.app`                                                 |
| `BETTER_AUTH_SECRET`                       | yes               | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no                | Enables "Continue with Google"                                                                          |
| `RESEND_API_KEY`                           | yes in production | Without it, emails are written to the log                                                               |
| `EMAIL_FROM`                               | no                | Defaults to `Aperture <onboarding@resend.dev>`                                                          |
| `PORT`, `LOG_LEVEL`, `NODE_ENV`            | no                | Shared service settings (`@aperture/runtime`)                                                           |

Container image: `docker build -f infra/docker/service.Dockerfile --build-arg APP=api .`
