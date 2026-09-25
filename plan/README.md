# Aperture — Build Plan

This folder is the plan for turning the current Aperture repository (a Solana hackathon demo) into a production product: **one control plane that governs how an organization's people and AI agents spend money on AI — on every rail (AI provider APIs, fiat cards, and stablecoin/x402 payments) — with verifiable audit.**

Everything here was written on **2026-09-23** against the repository at commit `d9e0687` and against third-party documentation read on that date. Third-party facts are linked in [research/](research/README.md); anything marked **VERIFY** must be re-checked when that phase starts.

## How to read this

1. [vision/](vision/README.md) — what we are building, for whom, and why it wins. Read first.
2. [current-state/](current-state/README.md) — honest audit of what exists today, what is broken or unsafe, and what we keep, rewrite, archive, or delete. **The plan starts here.**
3. [research/](research/README.md) — findings from the docs of every third-party service, competitor moves, and research papers, with links.
4. [architecture/](architecture/README.md) — the target system, step by step: ledger, budgets, policy engine, mandates, gateway, connectors, rails, audit.
5. [edge-cases/](edge-cases/README.md) — the architecture stress-tested against ~80 failure scenarios, each with its handling and the test that proves it.
6. [frontend/](frontend/README.md) — the new dashboard and workspace UI.
7. [testing/](testing/README.md) — unit, property-based, fuzz, integration, end-to-end, load, and live "try it yourself" testing.
8. [security/](security/README.md) — threat model and controls.
9. [deployment/](deployment/README.md) — environments, infrastructure, CI/CD, backups, monitoring, cost.
10. [conventions/](conventions/README.md) — how code in this repo is written (and how we stop "slop" code).
11. [phases/](phases/) — the build plan, Phase 0 to Phase 10. Each phase has its own README with tasks, tests, security checklist, deployment steps, a hands-on "try it yourself" section, and exit criteria.

## The phases at a glance

Estimates assume one full-time engineer. "You can test" means a live check you can run yourself on the staging deployment at the end of the phase.

| Phase | Name | Est. | Outcome | You can test |
|---|---|---|---|---|
| [0](phases/phase-00-requirements/README.md) | Requirements from you | 1 wk (parallel) | Accounts, keys, decisions, legal questions, design-partner agreement | Checklist complete |
| [1](phases/phase-01-stabilize-and-restructure/README.md) | Stabilize, secure, restructure | 1.5 wk | Unsafe code shut off, legacy archived, clean monorepo with CI | CI green; old exploits no longer work |
| [2](phases/phase-02-core-domain/README.md) | Core domain: ledger, budgets, policy | 2.5 wk | Money, ledger with holds, budget tree, policy engine, audit chain — heavily tested | Run the property/fuzz suite; CLI simulation |
| [3](phases/phase-03-identity-and-control-plane/README.md) | Identity, control-plane API, new dashboard shell | 2.5 wk | Login, orgs, roles, budgets & policies UI, staging deploy | Sign up, invite a teammate, build a budget tree on staging |
| [4](phases/phase-04-provider-connectors/README.md) | Provider connectors (visibility + control without a gateway) | 2.5 wk | OpenRouter, OpenAI, Anthropic, Google, Hugging Face usage in one place; limits and auto-revoke | Connect your own accounts; watch spend appear; trip a limit |
| [5](phases/phase-05-ai-gateway-text/README.md) | AI gateway (text) + workspace chat | 3 wk | Governed OpenAI/Anthropic-compatible gateway with reserve/settle; chat UI for non-developers | `curl` through the gateway; exceed a budget; kill switch |
| [6](phases/phase-06-media-gateway-and-workspace/README.md) | Media gateway (image/video) + marketing workspace | 2 wk | Image and video generation with cost preview and job holds | Generate an image and a video inside a budget |
| [7](phases/phase-07-approvals-mandates-delegation/README.md) | Approvals, mandates, delegation, SDK & MCP | 2.5 wk | Human approvals (Slack/email), signed mandates, sub-agent attenuation, agent SDK and MCP server | Agent asks for more budget; approve from Slack |
| [8](phases/phase-08-fiat-cards-rail/README.md) | Fiat cards rail (Stripe Issuing, NymCard) | 3 wk | Real-time card authorization against the ledger; single-use task cards; reconciliation | Simulate purchases with Stripe test helpers |
| [9](phases/phase-09-crypto-x402-rail/README.md) | Crypto rail (x402 on Solana, USDC/USDT) | 3 wk | Non-custodial agent allowances, policy signer, x402 payments, on-chain audit anchoring | Pay a devnet x402 API; get blocked over budget |
| [10](phases/phase-10-production-and-launch/README.md) | Production hardening, deployment, launch | 2.5 wk | Production infra, backups, monitoring, security review, billing, pilot launch | Restore drill, load test, pilot onboarding |

Total: about **25 weeks** of engineering. A pilot with a design partner (for example the Hala contact) becomes possible **after Phase 5** (about 12 weeks): visibility across providers, budgets, a governed gateway, and a chat workspace.

## Key decisions (details in [architecture/](architecture/README.md#adr-index))

| # | Decision | Why, in one line |
|---|---|---|
| 1 | Aperture owns the **control plane** (identity, policy, ledger, approvals, audit); money moves on **customer-owned rails** | No custody, no money-transmission licence, bootstrappable |
| 2 | One **USD ledger** in integer micro-dollars with **authorize → capture** holds on every rail | The same budget works for tokens, cards, and USDC; 1 micro-USD = 1 USDC atomic unit |
| 3 | TypeScript monorepo (pnpm + Turborepo), Next.js web, Hono services, Postgres + Drizzle, pg-boss jobs | Conventional, one language, few moving parts, self-hostable |
| 4 | Own thin gateway (passthrough, no model translation), not a LiteLLM fork | Policy + ledger is the product; LiteLLM's PyPI supply-chain compromise (March 2026) and Python stack add risk |
| 5 | Cards via **bring-your-own issuer** (customer's Stripe Issuing or NymCard program) | Aperture never becomes the card program manager; no PAN on our servers |
| 6 | x402 via **SPL-token delegate allowances + Aperture policy signer**, not the Token-2022 transfer hook | Works with real USDC/USDT and every x402 facilitator today; on-chain hard cap without custody |
| 7 | Existing Anchor programs are **archived**, not deleted | They don't govern USDC; the code stays in git history and a `legacy` tag |
| 8 | Fail **closed** by default everywhere money moves | A governance product that fails open is not a governance product |

## Status

- [ ] Phase 0 — waiting on you
- [x] Phase 1 — code complete on branch `phase-1/stabilize-and-restructure`; operational steps (Supabase lockdown, key rotation, push, Vercel root) pending
- [x] Phase 2 — complete on branch `phase-2/core-domain` (core domain, ledger, audit, simulator; 145 tests)
- [x] Phase 3 — code complete on branch `phase-3/identity-control-plane` (auth, orgs, RBAC + RLS, budgets, policies, audit API, dashboard; see ADR 0013); staging on Vercel + Render + Neon
- [x] Phase 4 — provider connectors, usage import, T1/T2 enforcement, alerts, Connections and Spend UI (ADR 0014); live-tested on OpenRouter
- [x] Phase 5 — gateway (OpenAI, Anthropic, Gemini, HF formats), agents and keys, kill switch, workspace chat (ADR 0014); live-tested on OpenRouter and Gemini
- [ ] Phases 6–10 — not started. Postponed items are listed in [deferred.md](deferred.md)
