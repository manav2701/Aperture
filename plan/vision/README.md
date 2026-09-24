# Vision and goals

## One line

**Aperture is the governance control plane for AI spend: one place where an organization decides who — person or AI agent — may spend how much, on what, through which rail, and gets a tamper-evident record of every decision.**

## The problem

AI spending in organizations has three shapes, and today they are governed by three different tools, or not at all:

1. **Token spend.** Developers, marketers, analysts, and auditors call OpenAI, Anthropic, Google, OpenRouter, Hugging Face, fal, Runway and others — through API keys, through apps, and through agents. Keys get shared, limits are per-provider and coarse, and nobody can answer "what did the marketing team spend on video generation this week, and who approved it?"
2. **Agent purchases with fiat.** Agents are starting to buy things (SaaS seats, data, travel, supplies) with cards. Card programs give merchant-category and amount limits, but they don't know which agent, task, or budget a purchase belongs to.
3. **Machine-to-machine payments.** Agents pay per request with stablecoins through x402 (Solana carries ~70% of x402 volume; USDC is ~99% of agent payment volume). The wallet that pays has no organizational policy, no approvals, and no link to the company's budgets.

The damage is real: a 2026 Cloud Security Alliance survey (reported by Ramp) found 65% of enterprises running AI agents had an agent-related incident in 12 months, and 35% reported direct financial loss. Research on agent authorization (see [research/](../research/README.md#research-papers-and-standards)) keeps reaching the same conclusion: authority must be **scoped, attenuated when delegated, checked before the action, and recorded**.

## What Aperture is

- **A control plane.** Identity (people, teams, agents), budgets, policies, approvals, mandates, and audit live in Aperture.
- **Connected to rails the customer already owns.** Their provider accounts, their card program, their wallet. Aperture enforces through the rails' own control points (API admin endpoints, real-time card authorization, transaction signing) and through its own gateway.
- **One ledger, one budget, every rail.** A team's USD 1,000 monthly budget can be consumed by GPT tokens, a Runway video, a card purchase, or an x402 payment — and is checked the same way each time.

## What Aperture is not

- **Not a bank, card issuer, or custodian.** We never hold customer money or card numbers. This keeps us out of money-transmission, card-program, and virtual-asset custody licensing (see [security/](../security/README.md#regulatory-notes) for the VARA caveat on key control).
- **Not a model provider or reseller.** Customers bring their own provider keys (BYOK). We never front token costs.
- **Not an observability tool first.** Dashboards are a by-product; enforcement is the product.

## Who it's for

| Segment | Example | Why they buy | Entry point |
|---|---|---|---|
| **GCC organizations with many teams using AI** | The Hala contact's organization; government-linked and enterprise companies in Dubai / Abu Dhabi | Finance wants control and visibility; non-developer teams (marketing, audit) want safe access to AI tools; data residency matters | Provider connectors (Phase 4) → gateway + workspace (Phases 5–6) |
| **AI-native companies running agents** | Startups whose product is an agent that spends | Need per-agent budgets, approvals, cards, and audit for customers and investors | Gateway + SDK + cards (Phases 5, 7, 8) |
| **Crypto-native agent builders on Solana** | Teams using x402 to buy data/compute | Need allowances, allowlists, and org policy on agent wallets without giving up custody | x402 rail (Phase 9) |

### Personas and what each needs

| Persona | Needs | Aperture surface |
|---|---|---|
| Owner / Admin | Set up the org, connect providers and rails, kill switch | Settings, Connections, Agents |
| Finance (CFO, controller) | Budgets, approvals above thresholds, month-end reports | Budgets, Approvals, Spend, exports |
| Team lead | Split the team budget, approve team requests | Budgets (own subtree), Approvals |
| Member — developer | API keys within budget, SDK, MCP | Keys, SDK docs |
| Member — marketing / non-technical | Chat, image, video generation without API keys | Workspace |
| Auditor | Read-only evidence: who spent what, who approved, proof the log wasn't altered | Audit, exports, verify tool |
| Agent (non-human) | A key or mandate with a clear budget and scope | Data-plane APIs, MCP, x402 signer |

## Why we win (differentiators)

| Competitor category | What they do | What they don't do that we do |
|---|---|---|
| **Ramp** (AI Token Spend Management, Jul 2026; Agent Cards, Mar 2026) | Unified AI spend dashboard, limits by team/project/key, single-use agent cards | US-centric; no governed workspace for non-developers; no hierarchical agent mandates; no x402/stablecoin rail; no self-hosted/in-country option |
| **UAE spend platforms** (Alaan, Qashio, Pemo) | Corporate cards and expenses | No AI token governance, no agent identity, no gateway (as of our research) |
| **LLM gateways** (LiteLLM, Portkey, Bifrost, OpenRouter, Cloudflare) | Virtual keys, budgets, routing | Only see traffic through themselves; no cards, no crypto, no org-wide ledger or approvals |
| **Agent wallets** (Privy, Turnkey, Coinbase, Crossmint) | Per-transaction wallet policies | Stateless per-transaction rules (no daily/monthly/org budgets); no link to token or card spend |
| **Stripe** (Issuing for agents, SPT, MPP, x402 seller side) | Rails and primitives | It's infrastructure; the org policy, approvals, and cross-rail budget are left to the builder — that's us |

The durable advantage is the **authority graph**: a single model of who delegated what to whom, enforced on every rail, with proofs an auditor can verify.

## Goals

### Product goals by the end of Phase 10

1. An organization can connect OpenRouter, OpenAI, Anthropic, Google (Gemini), and Hugging Face and see spend by person, team, agent, provider, and model within 5 minutes of it happening (provider-reporting latency permitting).
2. Budgets are enforced in real time on the gateway, card authorizations, and x402 payments, and within minutes (detect-and-revoke) on provider keys used outside the gateway.
3. A non-technical user can chat, generate images, and generate videos inside a budget without ever seeing an API key.
4. Every allow/deny/approve decision is in a hash-chained audit log that an auditor can export and verify offline.
5. Aperture never holds customer funds or full card numbers.

### Business goals (first 12 months)

| Milestone | Target |
|---|---|
| First design partner using the product (pilot) | After Phase 5 (~12 weeks) |
| First paying customer | Within 2 months of pilot start |
| Paying organizations | 5 by month 9, 10–15 by month 12 |
| Revenue model validated | At least one customer paying for governance (not just dashboards) |
| Fundraising position | Pre-seed on traction (pilots + revenue), or stay bootstrapped |

### Engineering goals

- Gateway overhead **p99 < 30 ms** (excluding upstream model latency).
- Card authorization decision **p99 < 400 ms** (Stripe's hard timeout is 2 s).
- Ledger invariant (hard budgets are never exceeded by approved holds) proven by property-based tests with concurrency.
- Zero plaintext secrets in the database or logs.

## Business model (hypothesis to validate with pilots)

| Plan | For | Includes | Price hypothesis |
|---|---|---|---|
| Free | Individuals, evaluation | 1 org, 2 connections, visibility only, 7-day history | USD 0 |
| Team | Small teams | Connections, budgets, gateway, workspace, 5 seats | USD 20–30 per seat / month |
| Business | Companies with agents | + cards and x402 rails, approvals, mandates, SSO, 1-year audit retention | USD 500–1,500 / month base + seats |
| Enterprise / self-hosted | Regulated and government-linked orgs | In-country deployment, custom retention, support | Annual contract |

Charging a percentage of governed spend is tempting but ties revenue to the customer's AI bill and invites procurement friction; keep it as a later option for high-volume agent customers.

## Go-to-market

1. **Design partner in Dubai.** Turn the Hala conversation into a structured pilot (Phase 0 has the steps).
2. **Solana ecosystem.** The x402 rail and on-chain audit anchoring qualify for ecosystem grants and accelerators — non-dilutive funding for a bootstrapped team.
3. **Content.** Publish the engineering (ledger with holds, x402 allowance design, audit chain) — it's genuinely novel and attracts technical buyers.

## Non-goals (for the next 12 months)

- Browser extension for shadow-AI blocking (roadmap after Phase 10).
- Being a model router that optimizes quality/latency (we route for policy, not for quality).
- Issuing our own cards or running our own card program.
- Our own custom on-chain program for payments (Swig/Squads are the path if customers demand on-chain enforcement).
- Arabic/RTL UI (planned after the first GCC pilots confirm the need).

## Biggest risks

| Risk | Mitigation |
|---|---|
| Ramp (or providers themselves) ship "good enough" governance globally | Focus on what they don't do: multi-rail ledger, agent mandates, workspace for non-developers, GCC data residency, self-hosting |
| Provider admin APIs change or stay limited (e.g., Anthropic keys can't be created via API) | Connector design tolerates partial capabilities; gateway is the always-available hard control |
| Regulation (VARA for key control, card-program rules) | Non-custodial by design; legal opinion in Phase 0 before the x402 rail goes live |
| Solo-founder capacity | Strict phase scope; pilot after Phase 5; later phases can slip without breaking the product |
| A security incident in a governance product is fatal | Security is built into every phase, not bolted on in Phase 10 |
