# Current state audit (commit `d9e0687`, 2026-09-23)

This is where the plan starts. It lists what exists, what is unsafe or broken, and what happens to each part. Phase 1 executes the "Action" column.

## Summary

The repository is a hackathon/demo build that pivoted from Stacks to Solana. It contains three Anchor programs (the real technical work), a TypeScript SDK, a Next.js dashboard with twelve pages, an Express "gateway", four agent-framework adapters, and a large amount of leftover documentation and assets. Several parts are presentation mocks. **Some of the live behaviour is unsafe and should be shut off before anything else** — see [Security findings](#security-findings).

## Inventory and action

Legend — **Keep**: moves into the new structure mostly as-is. **Rewrite**: the idea survives, the code is replaced. **Archive**: moved under `legacy/` and tagged `legacy-v0`, not built by CI. **Delete**: removed (still recoverable from git history).

| Path | What it is | State | Action | Reason |
|---|---|---|---|---|
| `programs/policy-manager` | Anchor program: Token-2022 transfer hook enforcing per-tx/daily/velocity/allowlist, clawback | Works for its own mint; several fields never settable; double-counts spend | **Archive** | A transfer hook only governs mints created with it; real USDC/USDT are classic SPL tokens. Replaced by delegate allowances + policy signer ([architecture](../architecture/README.md#rail-4--x402-on-solana)) |
| `programs/session-tracker` | Anchor program: time-boxed session budgets via CPI | Works | **Archive** | Session budgets move to the off-chain ledger + on-chain allowance |
| `programs/org-registry` | Anchor program: orgs, teams, members, roles, kill switch | Works | **Archive** | Org identity belongs in the control plane (email/SSO users), not on-chain |
| `patches/anchor-syn`, `Cargo.toml`, `Cargo.lock`, `Anchor.toml`, `scripts/build.sh` | Vendored Anchor patch and dependency downgrades for SBF 1.75 | Fragile | **Archive** | Only needed for the archived programs |
| `tests/aperture.ts` | 8 Anchor integration tests | Pass only in the author's WSL setup | **Archive** | Tests archived programs |
| `sdk/` | TS SDK for the programs + middleware (policy guard, session renewer, anomaly detector, templates) | Tied to programs | **Rewrite** | New `packages/sdk` for the gateway, mandates and x402. Policy templates idea is kept |
| `gateway/src/index.ts` | Express server: key CRUD and chat proxy to OpenRouter | **Does not enforce any policy**; weak key generation; open CORS | **Rewrite** | New `apps/gateway` ([Phase 5](../phases/phase-05-ai-gateway-text/README.md)) |
| `gateway/prisma/schema.prisma` | Prisma introspection of the Supabase DB | Unused by the code | **Delete** | Replaced by Drizzle schema in `packages/db` |
| `gateway/Dockerfile`, `railway.json` | Deploy config | Fine but for the old server | **Delete** | New Dockerfiles per app |
| `webapp/` | Next.js 16 dashboard, 12 pages, Supabase direct access from the browser | Mix of real Supabase reads/writes, on-chain reads, mocks | **Archive**, then **Rewrite** as `apps/web` | New information architecture ([frontend](../frontend/README.md)); browser must never write to the database directly |
| `webapp/app/api/proxy/route.ts` | x402-style proxy | **Open SSRF relay, unauthenticated identity** | **Delete immediately** (Phase 1, step 1) | See findings S2, S3 |
| `webapp/app/api/compute`, `api/weather` | Demo paid APIs | Demo | **Delete** | Replaced by a proper x402 test seller in `tools/` ([Phase 9](../phases/phase-09-crypto-x402-rail/README.md)) |
| `webapp/public/frames/*.jpg` (5.6 MB), `docs/ezgif-*` (5.6 MB duplicate) | Landing page animation frames | Duplicated | **Delete** the `docs/` copy; move landing page to a separate marketing site later | Repo weight, duplication |
| `webapp/netlify.toml` | Contains the text `hi` | Junk | **Delete** | Broken config |
| `adapters/mcp` | MCP server with 5 tools calling a local Solana RPC | Demo | **Rewrite** as `packages/mcp` ([Phase 7](../phases/phase-07-approvals-mandates-delegation/README.md)) | Tool list is a good starting point |
| `adapters/n8n`, `adapters/openclaw`, `adapters/hermes` | Framework adapters | Thin demos | **Archive** | Re-add later on top of the new SDK when a customer asks; don't maintain four surfaces now |
| `examples/demo.ts` | Program demo | Tied to programs | **Archive** | |
| `docs/*.md` (11 files), `docs/*.sql`, PDFs, `.docx`, `stacks docs.txt`, `x402_docs.txt` | Stacks-era guides, demo cheat sheets, schema snapshots, third-party docs | Outdated; some describe storing mnemonics in plaintext | **Archive** (`legacy/docs`); delete third-party PDFs/docx | Misleading for new contributors; third-party docs shouldn't live in the repo |
| `supabaseConfig.sql` | Schema reference incl. `agent_mnemonic` column | Unsafe design | **Archive** | Replaced by Drizzle migrations |
| Root `package.json` | Named `x402-policy-manager`; scripts point to `backend/`, `contracts/`, `agent/` which don't exist; Stacks deps | Broken | **Rewrite** | Workspace root for the monorepo |
| `README.md` | Presentation README | Claims features that don't exist (7 gateway guardrails, ElysiaJS + Prisma) | **Rewrite** | Must describe reality |
| `tmp-aperture-ws/`, `target/`, `.anchor/`, `node_modules/` | Local build artefacts (ignored) | — | Clean locally | |

## Security findings

Ranked by severity. File references are to the current tree.

| ID | Severity | Finding | Where | Fix (phase) |
|---|---|---|---|---|
| S1 | **Critical** | The browser writes directly to Supabase tables (`policies`, `sessions`, `agent_virtual_keys`, `org_members`) with the public key. Prisma introspection shows RLS on only 6 tables; `policies` (which has `agent_mnemonic`), `sessions`, `payment_history`, `daily_spending` show no RLS flag. Anyone with the public key (it is in the JS bundle and hardcoded in source) can likely read and write them. | [webapp/lib/supabase.ts:15](../../legacy/webapp/lib/supabase.ts#L15), [webapp/app/policies/page.tsx:83](../../legacy/webapp/app/policies/page.tsx#L83), [gateway/src/index.ts:18-19](../../legacy/gateway/src/index.ts#L18-L19) | Phase 1: verify in the Supabase dashboard, enable RLS deny-all on every table, rotate keys, export and wipe |
| S2 | **Critical** | `/api/proxy?target=` fetches any URL server-side and forwards request headers — an open SSRF relay and open proxy. | [webapp/app/api/proxy/route.ts:16](https://github.com/manav2701/Aperture/blob/legacy-v0/webapp/app/api/proxy/route.ts#L16), [:65](https://github.com/manav2701/Aperture/blob/legacy-v0/webapp/app/api/proxy/route.ts#L65) | Phase 1: delete the route |
| S3 | **Critical** | Agent identity is the unauthenticated `x-agent-address` header — anyone can spend "as" any agent. | [webapp/app/api/proxy/route.ts:17](https://github.com/manav2701/Aperture/blob/legacy-v0/webapp/app/api/proxy/route.ts#L17) | Phase 1: delete; Phase 5: authenticated virtual keys |
| S4 | **Critical** | Agent mnemonics (wallet recovery phrases) stored in plaintext in `policies.agent_mnemonic`; docs instruct users to do this. Any wallet whose mnemonic was stored must be treated as compromised. | `supabaseConfig.sql`, `docs/REAL-WALLETS-GUIDE.md` | Phase 1: move funds out of any such wallet, null the column, drop it |
| S5 | **High** | The "governed" chat endpoint accepts any Bearer token and forwards it to OpenRouter on the server's key — anyone can use the operator's OpenRouter credit. | [gateway/src/index.ts:187](../../legacy/gateway/src/index.ts#L187) | Phase 1: take the gateway offline or rotate/remove `OPENROUTER_API_KEY` from the deployment |
| S6 | High | API keys generated with `Math.random()` (not cryptographically secure) and stored in plaintext. | [gateway/src/index.ts:141](../../legacy/gateway/src/index.ts#L141), [webapp/app/gateway/page.tsx:129](../../legacy/webapp/app/gateway/page.tsx#L129), [webapp/app/agents/page.tsx:100](../../legacy/webapp/app/agents/page.tsx#L100) | Phase 5: `crypto.randomBytes`, store only a hash |
| S7 | High | Hardcoded Supabase project URL and key fallbacks in source. | see S1 | Phase 1: remove fallbacks, fail on missing env |
| S8 | Medium | `cors({ origin: '*' })` on the gateway. | [gateway/src/index.ts:28](../../legacy/gateway/src/index.ts#L28) | Phase 5: explicit origins; data-plane APIs don't need browser CORS |
| S9 | Medium | Admin-level RBAC decided by querying tables with an address string provided in the query string (`?wallet=`), no signature. | [gateway/src/index.ts](../../legacy/gateway/src/index.ts) `GET /api/v1/keys` | Phase 3: session-based auth |
| S10 | Low | No rate limiting, no request size limits, verbose error messages returned to clients. | gateway, webapp API routes | Phases 3/5 |

Git history was scanned for committed `.env` files and common key patterns (`sk-or-v1-`, `sk_live_`, `sk_test_`, service-role JWTs): **none found**. The Supabase publishable key and project URL are in history; that's acceptable only once RLS denies everything (S1).

## Correctness bugs in the on-chain programs (for the record)

These don't need fixing because the programs are archived, but they explain why "it passed the demo" isn't "it works":

- `transfer_hook` adds `amount` to `spent_today` **twice** ([lib.rs:318](../../legacy/programs/policy-manager/src/lib.rs#L318) and [lib.rs:356](../../legacy/programs/policy-manager/src/lib.rs#L356)), so the daily limit is effectively halved.
- `monthly_limit`, `cooldown_seconds`, `allowed_hours_*`, `escalation_threshold`, `parent_policy`, `delegated_budget` exist on `PolicyAccount` but no instruction sets them; they stay `0`, so those checks never run.
- `emergency_clawback` checks ownership by deserializing the policy account as `SessionAccountOffline` ([lib.rs:167](../../legacy/programs/policy-manager/src/lib.rs#L167)); it works only because both structs start with a pubkey.
- `close_session` verifies the owner but the session's `auto_renew` flag is never used on-chain.

## Presentation mocks to remove

| Where | Mock |
|---|---|
| [webapp/app/gateway/page.tsx:180](../../legacy/webapp/app/gateway/page.tsx#L180) | Playground returns a hardcoded "response" after a 1.2 s timeout |
| [webapp/app/treasury/page.tsx:39-40](../../legacy/webapp/app/treasury/page.tsx#L39-L40) | Daily/monthly spend are `Math.random()` |
| [webapp/app/delegation/page.tsx:49](../../legacy/webapp/app/delegation/page.tsx#L49) | Delegation tree is synthesized |
| README | "7 guardrail checks", "ElysiaJS + Prisma", "14 compliance tests" — not in the code |

## What we salvage (ideas, not code)

- **Policy vocabulary**: per-transaction cap, daily/monthly caps, velocity, cooldown, time windows, escalation threshold, allowlists, delegation depth. All become rules in the new policy engine.
- **Session budgets**: become time-boxed budgets / mandates with expiry.
- **Emergency controls**: become the kill switch (revoke keys, freeze cards, stop signing).
- **Role set**: Owner, CFO, Team Lead, Developer, Auditor → Owner, Admin, Finance, Team Lead, Member, Auditor (+ Agent as a non-human principal).
- **Policy templates** (Research Agent, Procurement Agent, …) → policy templates in the new UI.
- **MCP tool list** (`check_policy`, `pay_x402`, `request_approval`, `pause_agent`, `resume_agent`) → the new MCP server's first tools.
- **Visual identity** of the dashboard (fonts, colors) can carry over into the new design system if you like it.

## Data currently in the live Supabase project

Before wiping, export for reference (Phase 1): `orgs`, `teams`, `org_members`, `agent_virtual_keys` (key values are compromised by S6 — treat as revoked), `agent_request_logs`, `policies` (without `agent_mnemonic`), `sessions`, `payment_history`. Nothing in it needs to migrate into the new schema; it is demo data.
