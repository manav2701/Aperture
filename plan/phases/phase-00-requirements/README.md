# Phase 0 — Requirements from you

**Goal:** everything the build needs that only you can provide: decisions, accounts, keys, legal answers, and a design partner.
**Duration:** about 1 week, runs in parallel with Phase 1 (only the items marked **Phase 1 blocker** are needed before Phase 1 starts).
**Depends on:** nothing.

> **Never paste secrets into chat, issues, or commits.** Put them in the local `.env` files described in Phase 1 (gitignored) or in the SOPS-encrypted files described in [deployment](../../deployment/README.md#secrets). When a key is only for testing, set the lowest possible limit at the provider.

## A. Decisions (with recommendations)

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| D1 | Legal entity and jurisdiction for Aperture | A UAE free-zone company (e.g. in5, Hub71, DMCC, IFZA) — cheap, lets you invoice GCC customers. Consider a US entity (Stripe Atlas) only if Stripe Issuing needs it (see D5) | Phase 8 |
| D2 | Product name and domains | Keep "Aperture" if the domain and trademark are clear; subdomains `app.`, `api.` (or `app./api` path), `gw.`, `docs.`, `staging-app.`, `staging-gw.` | Phase 3 |
| D3 | Where to host staging/production | Your own server if it meets 4 vCPU / 8 GB / 160 GB SSD / Ubuntu 24.04 and has a public IP; otherwise a VPS (EU region; UAE later for residency) | Phase 3 |
| D4 | Time budget | Full-time for ~25 weeks, pilot after Phase 5 | Now |
| D5 | Card rail priority | If your Stripe account (UAE) **can't** enable Issuing in a sandbox, choose: (a) Stripe Atlas US entity, (b) a design partner with a US/EU entity whose Issuing account we connect to, or (c) prioritize NymCard. Recommendation: try (b) first, keep (a) as fallback | Phase 8 |
| D6 | x402 custody model | Wait for the legal opinion (C1). Default plan: Aperture-hosted signer with delegate allowances; fallback: customer-hosted signer | Phase 9 |
| D7 | Keep the name/visual identity of the current UI? | Keep fonts and colors, rebuild components on shadcn/ui | Phase 3 |

Write your answers in a short file `plan/phases/phase-00-requirements/DECISIONS.md` (no secrets).

## B. Accounts and access

### Phase 1 blockers

- [ ] **GitHub**: private repository (this one), GitHub Actions enabled, branch protection on `main` (require PR + green CI), GitHub Container Registry enabled.
- [ ] **Supabase** dashboard access for the existing project (`fkvoweryeifabfebzsos`) — needed for the day-1 lockdown.
- [ ] **List of any wallets that received real funds** whose mnemonics were stored in the `policies` table (they must be emptied).
- [ ] Access to wherever the current gateway and webapp are deployed (Railway, Vercel, etc.) so the unsafe endpoints can be taken down and `OPENROUTER_API_KEY` removed.

### Infrastructure (needed by Phase 3)

- [ ] Domain DNS moved to **Cloudflare** (free plan) — https://dash.cloudflare.com
- [ ] Server: SSH access for a `deploy` user with sudo, Docker installed — or a VPS account (e.g. Hetzner https://www.hetzner.com/cloud)
- [ ] Object storage for backups and media: **Cloudflare R2** (https://developers.cloudflare.com/r2/) or **Backblaze B2** (https://www.backblaze.com/cloud-storage) — create a bucket and an access key
- [ ] **Sentry** (https://sentry.io) — free plan, one project per app
- [ ] **Grafana Cloud** (https://grafana.com/products/cloud/) free plan — OTLP endpoint and token
- [ ] Uptime monitor: **Better Stack** (https://betterstack.com/uptime) or self-hosted Uptime Kuma
- [ ] Transactional email: **Resend** (https://resend.com) or **Postmark** — API key, verified sending domain
- [ ] **Google OAuth client** for "Sign in with Google" — https://console.cloud.google.com/apis/credentials
- [ ] (Optional) **Microsoft Entra** app registration for "Sign in with Microsoft" — https://entra.microsoft.com
- [ ] An **age** key pair for SOPS (Phase 1 shows how) stored in your password manager

### AI providers (needed by Phase 4; put small credit on each, ~USD 10)

- [ ] **OpenRouter**: account, credits, a **management key** — https://openrouter.ai/settings/keys (docs: https://openrouter.ai/docs/api-reference/api-keys/create-api-key)
- [ ] **OpenAI**: an organization (not a personal account), a project, an **Admin API key** — https://platform.openai.com/settings/organization/admin-keys; set a **project budget** in the dashboard as a backstop
- [ ] **Anthropic**: an organization in the Claude Console (the Admin API is not available to individual accounts), a workspace, one or two normal API keys, and an **Admin API key** — https://platform.claude.com/docs/en/manage-claude/admin-api ; set a workspace spend limit
- [ ] **Google**: a GCP project with billing, Gemini API enabled, an API key, a **budget with Pub/Sub notifications**, and a service account with Billing Account Viewer + API Keys Admin — https://docs.cloud.google.com/billing/docs/how-to/budgets
- [ ] **Hugging Face**: an organization and a fine-grained token — https://huggingface.co/settings/tokens
- [ ] **fal.ai** (https://fal.ai) and **Runway developer API** (https://dev.runwayml.com) accounts with small credit — for Phase 6
- [ ] (Do **not** use OpenAI Sora: its API was retired on 24 Sep 2026)

### Payments (needed by Phase 8, and Phase 10 for Aperture's own billing)

- [ ] **Stripe** account for Aperture (to bill customers later; Stripe Payments works for UAE businesses)
- [ ] Try enabling **Issuing** in a Stripe **sandbox** — https://dashboard.stripe.com/issuing/overview — and record whether it's allowed for your account's country (feeds D5)
- [ ] **Stripe CLI** installed — https://docs.stripe.com/stripe-cli
- [ ] **NymCard**: contact partnerships/sales (https://www.nymcard.com) and ask the questions in section D
- [ ] (Optional) Intro calls with **Alaan / Qashio** about APIs and partnership

### Solana (needed by Phase 9)

- [ ] Two wallets in **Phantom** or **Solflare** on **devnet**: "Treasury (test)" and "Notary (test)"
- [ ] **Helius** (https://www.helius.dev) free RPC key (and a second provider, e.g. QuickNode or Triton, for failover)
- [ ] Devnet USDC from **Circle's faucet** — https://faucet.circle.com
- [ ] Read the x402 SVM spec — https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md
- [ ] Contact **PayAI** and **Dexter** (the two main Solana x402 facilitators) to ask: do you have devnet endpoints, and do you accept `TransferChecked` signed by a token-account **delegate** (not the owner)?

### Collaboration

- [ ] A **Slack** workspace for testing, and permission to create a Slack app — https://api.slack.com/apps
- [ ] A password manager vault shared with future teammates (1Password / Bitwarden)

## C. Legal and compliance questions (ask a UAE lawyer; one engagement)

- [ ] **C1 (VARA)**: If Aperture holds a Solana SPL-token *delegate* key that can move up to a capped, revocable allowance from a token account owned by a business customer, and signs only when the customer's policies allow — is that a custody or wallet-provision activity requiring a VARA licence? What if the signer runs in the customer's own infrastructure?
- [ ] **C2 (cards)**: Aperture answers real-time authorization requests and calls the card program's API on behalf of the program owner (the customer). Any licensing need for Aperture in the UAE?
- [ ] **C3 (data)**: Obligations under the UAE PDPL (and DIFC/ADGM if relevant) for processing prompts and usage metadata of customer employees; is a DPA + in-country self-hosting option sufficient for government-linked customers?
- [ ] **C4**: Templates for Terms of Service, Privacy Policy, Data Processing Agreement, and a pilot agreement.

## D. Questions for NymCard

1. Can the program manager make **real-time approve/decline decisions** on authorizations (a synchronous webhook or external authorization host)? What is the timeout, and what happens on timeout?
2. Webhook **signature/authentication** scheme?
3. Can **velocity limits** and MCC/merchant/country controls be updated per card via API at high frequency (e.g., after every transaction)? Any rate limits?
4. Sandbox access for a software partner, and commercial model (can the customer own the program while Aperture integrates via API credentials they issue)?
5. Can a card be single-use or auto-cancel after N transactions?

## E. The design partner (Hala contact)

Goal: turn one positive conversation into a structured pilot starting after Phase 5.

1. **Discovery call (30 min)** — ask:
   - Which AI tools do teams use today (ChatGPT/Claude apps, APIs, Midjourney, Runway, Copilot…)? Which teams?
   - How are they paid for (company card, invoices, personal cards reimbursed)?
   - Who approves AI spend today? What went wrong recently (surprise bills, shared keys, data concerns)?
   - Data residency or procurement constraints (must data stay in the UAE? vendor registration?)
   - Would marketing use a governed chat/image/video workspace?
2. **Pilot proposal (1 page)** — scope (visibility across their providers + budgets + gateway + workspace for 1–2 teams), duration (6–8 weeks), success criteria (e.g., "100% of AI API spend attributed to a team; zero unapproved spend over USD X; marketing generates content inside budget"), what they provide (admin keys, 2 champions), what it costs (free pilot → paid plan).
3. **Letter of intent** at the end of the pilot if the criteria are met — useful for fundraising and accelerators.

## F. Budget for this build

| Item | One-time | Monthly |
|---|---|---|
| Provider test credits (OpenRouter, OpenAI, Anthropic, Google, fal, Runway) | ~USD 60–100 | top-ups as needed |
| Server + storage + email | — | ~USD 20–60 |
| Legal opinion (C1–C4) | varies (ask for a fixed fee) | — |
| Optional Stripe Atlas (only if D5 = a) | ~USD 500 | — |

## Exit criteria

- [ ] Phase 1 blockers done (section B, first list)
- [ ] `DECISIONS.md` written for D1–D7
- [ ] Provider accounts and keys ready before Phase 4 starts
- [ ] Lawyer engaged (answers needed before Phase 9 goes to mainnet)
- [ ] Discovery call with the design partner done; pilot proposal sent
