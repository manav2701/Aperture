# @aperture/web

Next.js (App Router) dashboard and workspace.

**Today:** a static landing page with the Aperture palette and fonts carried over from the legacy dashboard, plus baseline security headers in `next.config.ts`.
**Built in:** Phase 3 (dashboard shell, auth, budgets, policies), Phase 5–6 (workspace chat, images, video) — see [plan/frontend](../../plan/frontend/README.md).

```bash
pnpm --filter @aperture/web dev     # http://localhost:3000
pnpm --filter @aperture/web build
```

On Vercel, set the project's Root Directory to `apps/web`; Vercel detects pnpm from the lockfile.
