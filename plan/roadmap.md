# Roadmap: every step from here

Written 2026-10-07. Phases 1–10 are built.

> **Decision, 2026-10-08:** production (the Google Cloud move, P0 and owner steps E16–E20) is **on hold until after Phase 16**. Staging on Render + Vercel + Neon stays the only environment. Work goes straight into Phases 11 and 12, then 13–16; production comes last. This page puts everything that's left in one order: what I build (the **build track**), what only you can do (the **owner track**, detailed in [your-checklist.md](your-checklist.md)), and where the two meet.

## What we're adding, and what we're not

This came out of reviewing Credo AI, IBM watsonx.governance, JFrog's MCP Registry, Finout, Langfuse, and LiteLLM (October 2026).

**Adding** (it makes enforcement stronger or easier to sell):
- AI inventory, coverage %, shadow AI, posture, attestations, and **agent cards** → Phase 11
- **Seats and subscriptions** (ChatGPT, Claude, Cursor, Copilot, M365 Copilot, Gemini), receipts, self-declaration, **Claude Code / Codex telemetry**, a Claude Code plugin → Phase 12
- Configurable **rate limits**, **anomaly detection** with actions, **budget-aware routing** (model ceilings, soft landing, one model per session), remote MCP tool rules → Phase 13
- **Cost centres, chargeback, forecasts**, accounting exports → Phase 14
- **Bedrock / Azure / Vertex** connectors, a **LiteLLM connector**, OTel export, SCIM, Aperture as a **connector inside Claude, ChatGPT, Claude Code, Cursor**, framework adapters, compliance **evidence packs** → Phase 15
- **Browser extension** for discovery and steering → Phase 16

**Not building** (other companies own these markets, or they don't fit a solo founder):
- Regulatory knowledge graphs and policy packs written by standards experts (Credo, IBM)
- LLM observability, evals, prompt management (Langfuse). We export to it instead
- Cloud, Kubernetes, and data-warehouse FinOps (Finout)
- A model-translating gateway, response caching, prompt compression, PII/prompt-injection guardrails (LiteLLM gives these away)
- Our own prompt-based model router. Commodity; plug in Not Diamond or RouteLLM only if asked
- Logging in to anyone's consumer AI account, or reading conversation content

## The build track

| # | Work | Est. | Needs from you |
|---|---|---|---|
| P0 | Production on Google Cloud: G1–G8 in [production-gcp.md](deployment/production-gcp.md#6-what-i-still-have-to-build-before-step-10). **On hold until after Phase 16** | 2 days | A scratch GCP project |
| [11](phases/phase-11-posture-inventory-attestation/README.md) | Posture, inventory and coverage, shadow AI, attestations, agent cards | 3.5 wk | Nothing |
| [12](phases/phase-12-seats-and-tools/README.md) | Seats, subscriptions, receipts inbox, terminal-tool telemetry, Claude Code plugin | 3.5 wk | Domain (for the receipts inbox); a Claude Team / ChatGPT Business workspace for a live test |
| [13](phases/phase-13-guardrails-and-routing/README.md) | Rate limits, anomaly detection, budget-aware routing, remote MCP rules | 3 wk | Nothing |
| [14](phases/phase-14-finance-layer/README.md) | Cost centres, chargeback, close, forecasts, accounting CSV | 2 wk | The pilot's cost-centre list; an accountant on VAT |
| [15](phases/phase-15-interop-and-distribution/README.md) | Cloud connectors, LiteLLM, OTel, SCIM, accounting push, listings, adapters, evidence packs | 3.5 wk | AWS/Azure test accounts, Okta/Entra dev tenant, marketplace accounts |
| [16](phases/phase-16-browser-extension/README.md) | Browser extension | 3 wk + review | Chrome Web Store and Edge Add-ons accounts |

About **19 weeks** of build. Phases 11–13 are fixed in order. 14–16 move around based on what the pilot asks for, and any part of 15 nobody needs is skipped.

## The owner track

From [your-checklist.md](your-checklist.md):

| Step | What | Unblocks |
|---|---|---|
| A | Push commits, Render env vars, turn on 2FA | Staging stays current |
| B | Devnet wallets, Helius key, the delegate spike (tell me outcome A or B) | Phase 9 on devnet |
| C | Media S3 env vars, Vercel, Slack app, security clean-up, provider admin keys you'll use | Media, Slack approvals, live connector tests |
| E16–18 | Decisions, accounts, **domain + Resend verification**, GCP setup steps | Production, emails to anyone, the receipts inbox |
| E19–20 | First release, restore drill | Production is live |
| E21–22 | Aperture billing; **lawyer review of terms, privacy, DPA** (add the Phase 11 disclaimer and Phase 12/16 data to it) | Charging customers; the pilot |
| E24 | Pilot onboarding | Real feedback |
| D | Stripe Issuing access (D5) | Live cards; moving subscriptions onto cards (12.9) |
| E23 | Legal opinion C1 | Solana mainnet |

## One timeline

```
Week      1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21
Build    |---- Phase 11 ----|---- Phase 12 ----|-- Phase 13 --|- 14 --|----- Phase 15 -----|-- Phase 16 --| P0 + production
You      A,B,C, domain (for the receipts inbox), legal review  | pilot on staging if the partner accepts it
                                                     Stripe Issuing (D5) and legal C1 whenever they arrive
```

Production (GCP setup, first release, restore drill) moves to the end, after Phase 16 (decision 2026-10-08). A pilot can still run on staging if the design partner accepts that.

## Milestones

| | When | What's true |
|---|---|---|
| **M1 Staging complete** | ~week 1 | Owner steps A–C done; everything built so far runs on staging |
| **M2 Production live** | after Phase 16 (on hold) | Domain, GCP, first release, restore drill passed |
| **M3 Pilot-ready** | ~week 8 | Phases 11–12 live: connect providers and seats, see every AI user and agent with a coverage %, posture score, agent cards, seat savings, signed attestation. Legal docs reviewed |
| **M4 Pilot running** | week 8 → | Design partner onboarded with agreed success criteria; Phase 13 lands during the first month (runaway-agent catch, soft landing) |
| **M5 Finance-ready** | ~week 13 | Monthly close and per-department statements for the pilot's finance team |
| **M6 Distribution** | ~week 17 | Listed as a Claude / ChatGPT connector and Claude Code plugin; SDK packages on npm |
| **M7 Cards live** | when D5 clears | Stripe Issuing sandbox suite passes; card rail on for the pilot |
| **M8 Mainnet x402** | when C1 clears | `MAINNET_X402_ENABLED=true` |

## What the pilot demo looks like at M3

1. Connect OpenRouter / OpenAI / Anthropic and the company's ChatGPT or Claude workspace.
2. **Inventory:** every person, agent, key, and seat, with "68% enforced · 20% visible · 12% external".
3. **Seats:** 40 seats, 11 idle, 3 people expensing personal plans → estimated monthly saving.
4. **Claude Code:** cost per developer from telemetry, even on subscriptions.
5. **Posture:** score with fix links; fix one live and the score goes up.
6. **Agent card** for their main agent: budget, rules, keys, spend, approvals.
7. **Attestation** for last month, verified on `/verify`.

## Decisions I need from you

1. **Order after Phase 13:** finance first (14) or interop first (15)? Default: 14, because finance signs.
2. **Which seat products does the pilot use?** Phase 12 builds connectors 1–3 (ChatGPT, Claude, Cursor) and only adds Copilot, M365 Copilot, and Gemini if needed.
3. **Inbound email provider** for receipts once the domain exists (Resend inbound if available, otherwise another provider).
4. **Is the browser extension worth 3 weeks** before more pilots? It could slip behind a second design partner.

## Research to confirm before each phase starts

Each phase README marks these **VERIFY**. The main ones:
- Admin and analytics APIs per seat product, and which plan unlocks each (Phase 12)
- Claude Code, Codex, and Gemini CLI telemetry names and managed-settings keys (Phase 12)
- Remote MCP connector requirements in Claude and ChatGPT, and the Claude Code plugin format (Phases 12, 15)
- LiteLLM admin API endpoints; Bedrock, Azure, and Vertex cost sources (Phase 15)
- Accounting import templates and UAE VAT treatment (Phase 14)
