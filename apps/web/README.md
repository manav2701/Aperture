# @aperture/web

Next.js (App Router) dashboard: sign-up and sign-in (password, magic link, Google), invitations, onboarding, and a role-aware org shell with Overview, Budgets, Policies (editor and simulator), Audit log, and Settings (organization, members, teams).

- Reads happen in server components through `lib/api/server.ts`, which forwards the session cookie to `API_INTERNAL_URL`. Writes run in the browser through `lib/api/browser.ts`, and `/api/*` is proxied to the API (`next.config.ts`).
- API types are generated from [docs/api/openapi.json](../../docs/api/openapi.json) into `lib/api/schema.d.ts` with `pnpm --filter @aperture/web api:types`. A test fails when the file is stale.
- A strict Content-Security-Policy with a per-request nonce is set in `proxy.ts`. Don't use inline `style` attributes.

```bash
pnpm --filter @aperture/web dev     # http://localhost:3000 (API expected on :4000)
pnpm --filter @aperture/web build
pnpm --filter @aperture/web test
```

On Vercel: Root Directory `apps/web`, and set `API_INTERNAL_URL` to the API's public URL (for example the Render service URL).
