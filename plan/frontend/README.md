# Frontend plan

The current `webapp/` is replaced by `apps/web`. The old app is archived (not deleted) so its visual identity can be reused.

## What changes and why

| Today | Problem | New |
|---|---|---|
| Browser writes to Supabase tables directly | Security (S1); no validation; no audit | Browser talks only to `apps/api`; the API validates, authorizes, audits |
| A Solana wallet is required to see most pages | Finance and marketing users don't have wallets | Email / Google / Microsoft login (Better Auth); wallet connect only on the crypto rail settings page |
| 12 pages organized around on-chain concepts (policies, sessions, treasury, delegation) | Doesn't match how a company thinks | Pages organized around **Spend, Budgets, Policies, Agents, Approvals, Workspace, Audit** |
| Mocked playground, random treasury numbers, synthesized delegation tree | Misleading | Only real data; honest empty states that tell the user what to connect |
| `alert()` for errors, no loading states | Poor UX | Toasts, inline form errors, skeletons, retry |
| One huge client component per page | Hard to test | Server components for reads, small client components for interaction |

## Information architecture

```
/login, /signup, /invite/[token]
/onboarding                 create org → connect first provider → set first budget
/                           Overview
/spend                      Spend explorer
/budgets                    Budget tree
/policies                   Policies + templates + simulator
/agents                     Agents list
/agents/[id]                Agent detail: keys, mandates, cards, wallet, activity, kill switch
/approvals                  Approval queue + history
/workspace                  Chat
/workspace/images           Image generation
/workspace/videos           Video generation + job gallery
/audit                      Audit log + verify + export
/connections                Providers, card programs, Solana treasury
/settings                   Org, members & roles, teams, SSO, billing, data & retention, API keys (personal)
```

Navigation shows only what the user's role allows (see the role table in [architecture](../architecture/README.md#11-identity-and-credentials)). A marketing member sees **Workspace** and their own **Spend**; an auditor sees **Spend**, **Budgets** (read), **Audit**.

## Page specifications

### Overview (`/`)
- KPI tiles: spend today, month to date vs budget, active agents, pending approvals, open holds.
- Burn chart: month-to-date spend vs linear budget line, per rail (stacked area).
- Top spenders (people and agents), top models, top merchants/payees.
- Alerts: budgets over 80%, broken connections, revoked credentials, overages, connector lag.
- Each tile links to the filtered Spend explorer.

### Spend explorer (`/spend`)
- Filters: date range, team, principal, rail, provider, model, merchant/payee, entry kind.
- Group by any dimension; table + chart; CSV export (server-generated).
- Row detail drawer: the ledger entries, the hold, the decision and its reasons, the audit event hash.
- Shows the **enforcement tier** of the credential that produced each entry.

### Budgets (`/budgets`)
- Tree editor (org → teams → principals → mandates) with inline limit/period/mode editing.
- Each node: limit, spent, held, remaining, period, hard/soft, rails, alert thresholds.
- Overbooking warning when children exceed the parent.
- Change history per node (from audit).

### Policies (`/policies`)
- Policy per scope (org, team, principal) as a form of rule cards (one card per rule type), not raw JSON.
- Templates (carried over from the old SDK): Research agent, Procurement agent, Marketing team, Customer-support bot, Developer.
- **Simulator**: pick a principal and a hypothetical action (model, amount, merchant, payee, time) → see allow/deny/approval and the reasons. Backed by `POST /policies/simulate` which runs the real engine.

### Agents (`/agents`, `/agents/[id]`)
- Create agent: name, owner, team, budget, policy template.
- Detail tabs: **Keys** (Aperture keys, provider keys via connectors — shows tier), **Mandates** (tree of this agent's mandates and sub-agents — the real delegation visualizer), **Cards**, **Wallet** (budget token account, allowance, balance), **Activity**, **Kill switch** (pause/resume/revoke with confirmation and reason).

### Approvals (`/approvals`)
- Queue with full context: who/what, amount, budget impact ("after approval: 92% of team budget"), policy reason, similar past approvals.
- Approve (optionally with a lower cap or shorter expiry) / deny with reason.
- History with a "suggest policy change" panel.

### Workspace (`/workspace/*`) — for non-developers
- **Chat**: model picker filtered by policy, streaming responses through the gateway using the member's own principal, per-conversation cost, budget meter in the header, prompt logging notice when the org enables it.
- **Images**: prompt, model, size, count → cost preview → generate → gallery with per-image cost.
- **Videos**: prompt, model, duration, resolution → cost preview (reserved on submit) → job list with status and "held" amount → player when done.
- When a request is denied or needs approval, show the reason and a "Request approval" button in place.

### Audit (`/audit`)
- Paginated chain: seq, time, actor, action, subject, decision, hash (short).
- "Verify chain" runs server-side verification for a range and shows the result; "Export" produces JSONL + the day roots, verifiable with `tools/audit-verify`.
- Anchor status per day (with Solana explorer links when anchoring is enabled).

### Connections (`/connections`)
- Cards per provider with capability badges (create keys, set limits, revoke, usage lag) and the resulting tier.
- Connect wizards with exact instructions and links to the provider's console (e.g. "create an Anthropic Admin key here"), a **Test connection** button, and last sync time/lag.
- Card programs: Stripe (restricted key + the webhook URL to paste + the "timeout = decline" reminder), NymCard.
- Solana treasury: connect wallet (Phantom, Solflare, Squads via wallet adapter), per-agent budget accounts, allowance top-up and revoke (transactions signed in the user's wallet).

### Settings (`/settings`)
- Org (name, timezone, display currency, fail mode), members & roles, teams, SSO (later), billing (Stripe Billing customer portal), data & retention (prompt logging default, retention days), personal Aperture keys.

## Design system

- Tailwind v4 + **shadcn/ui** components in `packages/ui`, customized with the existing Aperture fonts (Inter, Space Grotesk, JetBrains Mono) and palette as CSS variables (light and dark).
- Charts with Recharts, one shared chart theme; numbers right-aligned with tabular figures; money always formatted by one `formatMoney(micros, currency)` helper.
- Accessibility: keyboard navigation, focus rings, labels on every input, color is never the only signal (icons + text for allow/deny), WCAG AA contrast.
- Responsive down to 360 px; tables become cards on mobile.
- RTL/Arabic: not in v1; use logical CSS properties (`ms-`, `me-`, `ps-`, `pe-`) from the start so adding `dir="rtl"` later is cheap.

## Data and state conventions

- **Reads**: React Server Components call `apps/api` with the session cookie through a typed client generated from the API's OpenAPI document (`openapi-typescript` + `openapi-fetch`).
- **Mutations**: client components with TanStack Query mutations; optimistic updates only where rollback is trivial (e.g. toggles), never for money.
- **Forms**: react-hook-form + the same Zod schemas the API uses (`packages/core` exports them).
- **Live updates**: Overview and Approvals poll every 10 s (Server-Sent Events later).
- No business logic in the frontend: limits, decisions, costs all come from the API.

## Delete / archive list from the current webapp

- Delete: `app/api/proxy`, `app/api/compute`, `app/api/weather`, `netlify.toml`, mock code in `gateway/page.tsx`, `treasury/page.tsx`, `delegation/page.tsx`.
- Archive to `legacy/webapp`: everything else (pages, components, `lib/solana.ts`, frames).
- Reuse: fonts, color tokens from `globals.css`, `BudgetForecastWidget` idea (rebuilt on real data in Overview).

## Frontend tests

- Component tests (Vitest + Testing Library) for money formatting, budget tree editing, policy rule cards, approval actions.
- Playwright end-to-end flows per phase (listed in each phase README): sign up → onboarding; create budget; create agent + key; workspace chat within budget; deny → request approval → approve; kill switch; audit export.
- Visual regression is not worth it at this stage.
