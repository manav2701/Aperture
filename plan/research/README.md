# Research: third-party services, competitors, and papers

Read on 2026-09-23. Each section ends with **Implications** for Aperture. Items marked **VERIFY** were not fully confirmed from public docs and must be checked when the relevant phase starts.

## Capability matrix (the short version)

How much control each rail gives us, and therefore which enforcement tier we can reach (tiers are defined in [architecture](../architecture/README.md#12-enforcement-tiers)).

| Rail / provider | Create credentials via API | Set spend limit via API | Revoke/disable via API | Usage data freshness | Best tier |
|---|---|---|---|---|---|
| **Aperture gateway** (any provider behind it) | yes (ours) | yes (ours) | yes (ours) | real time | **T0 inline** |
| **OpenRouter** | yes (management key) | **yes, per key** (`limit`, `limit_reset`) | yes | per request (`usage.cost`) | **T1 provider-native** |
| **OpenAI** | yes (projects, service-account keys) | no (project budgets are dashboard-only) — rate limits per model per project are settable | yes (delete key) | usage 1-minute buckets; costs daily | T2 detect & revoke |
| **Anthropic** | **no** (keys created in Console only) | no for Console orgs (spend-limit API is Enterprise-only) | yes (set key `inactive`) | ~5 minutes, 1-minute buckets | T2 detect & revoke |
| **Google Gemini API** | keys via API Keys API | spend-cap budgets exist (preview, console) | yes (delete/restrict key) | hours | T2/T3 |
| **Hugging Face** | tokens | Enterprise-only org spending limit | yes | billing page | T3 (route via gateway for T0) |
| **fal.ai / Runway / Veo** | keys in dashboards | prepaid credits | dashboards | per job | T0 via gateway |
| **Stripe Issuing** | cards via API | yes (`spending_controls`) | yes (card `inactive`/`canceled`) | real time (webhooks) | **T0** (real-time authorization) |
| **NymCard** | cards via API | yes (velocity limits, MCC/merchant/country controls) | yes | webhooks | T1 (T0 **VERIFY**) |
| **x402 on Solana** | ours (delegate keys) | yes: on-chain allowance (hard cap) | stop signing now; owner revokes on-chain | real time | **T0 + on-chain T1** |

---

## Fiat cards

### Stripe Issuing

- **Real-time authorization.** Each purchase sends `issuing_authorization.request` to your endpoint; respond with `{"approved": true|false}` (optionally `amount` when `pending_request.is_amount_controllable`) within **2 seconds** or Stripe applies your timeout setting (approve or decline) or Autopilot. Monitor `request_history.reason` for `webhook_timeout` / `webhook_error`. — [docs](https://docs.stripe.com/issuing/controls/real-time-authorizations)
- **Spending controls** on cards and cardholders: `allowed_categories`, `blocked_categories`, `allowed_merchant_countries`, `blocked_merchant_countries`, `allowed_card_presences`, `spending_limits[] {amount, interval, categories}`. Controls run **before** the real-time webhook. Default USD 500/day limit if none set and an unconfigurable USD 10,000 per-authorization cap. Aggregation is best-effort with up to **30 s** delay. Intervals start at midnight **UTC**. — [docs](https://docs.stripe.com/issuing/controls/spending-controls)
- **Lifecycle controls**: `lifecycle_controls[cancel_after][payment_count]=1` makes a single-use card. ≤ USD 1 uncaptured auths don't count; force posts do count and still go through after cancellation. — [docs](https://docs.stripe.com/issuing/controls/lifecycle-controls)
- **Authorization lifecycle**: `pending` → `closed` / `reversed` / `expired`; incremental authorizations re-send `issuing_authorization.request` on the same object; partial reversals; expiry releases holds; late captures are possible after expiry. — [docs](https://docs.stripe.com/issuing/purchases/authorizations)
- **Transactions**: captures usually within 24 h (hotels/airlines/car rental up to 31 days); partial capture, **over-capture** (can't be blocked), multi-capture, **force capture** (no authorization, can't be blocked), refunds (linking to the original auth is "an inexact science"), refund reversals (negative refund). Spending controls, the webhook, and card status **don't apply to captures**. — [docs](https://docs.stripe.com/issuing/purchases/transactions)
- **Issuing for agents**: virtual cards per agent, single-use cards, card `metadata` (e.g. `agent_id`) is delivered in the authorization payload, Radar risk scores (`network_risk_score`), dispute API. Two products: cards for your own business (apply in Dashboard) and cards for your platform (contact Stripe). — [docs](https://docs.stripe.com/issuing/agents)
- **Testing**: sandbox + test helpers: `POST /v1/test_helpers/issuing/authorizations` (create), `/{id}/capture` (with `capture_amount`, `close_authorization`), `/{id}/increment`, `/{id}/reverse`, `/{id}/expire`, `/test_helpers/issuing/transactions/create_force_capture`, `/create_unlinked_refund`, `/{id}/refund`. US test funding via top-ups; UK/EU via funding instructions. — [docs](https://docs.stripe.com/issuing/testing)
- **Availability**: local issuing in the **US and 22 European countries + UK/Canada**. **Not the UAE.** Cross-border programs exist for multinationals; stablecoin-backed cards (private preview) in 30+ LATAM/Caribbean/Africa countries; Issuing balances can be funded by Bridge stablecoin balances (sandbox can use Solana devnet). — [docs](https://docs.stripe.com/issuing/global)
- **Agentic payments**: Shared Payment Tokens (SPT, Oct 2025) — scoped, revocable tokens; supports Visa Intelligent Commerce, Mastercard Agent Pay, BNPL since March 2026. — [docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens)
- **MPP (Machine Payments Protocol)** by Stripe + Tempo: HTTP 402 challenge → agent pays (SPT card min USD 0.50, or USDC stablecoin min 0.01 on Tempo) → retries. Seller side. `mppx` library. — [docs](https://docs.stripe.com/payments/machine/mpp)
- **x402 on Stripe**: seller-side acceptance of USDC on Base, private preview, 1.5% per charge, min 0.01 USDC. — [The Block](https://www.theblock.co/post/389352/stripe-adds-x402-integration-usdc-agent-payments)

**Implications**
1. Stripe's real-time authorization is the fiat equivalent of the old transfer hook. Our webhook = reserve against the ledger.
2. Captures can exceed or bypass authorizations (over-capture, force capture). The ledger must accept "spend without a hold" and alert/freeze, not assume holds are the only spend.
3. Stripe's intervals are UTC and aggregated with delay → our ledger is authoritative; Stripe `spending_controls` are a **backstop** set slightly above our limits.
4. We can't issue cards for UAE entities via Stripe. **Bring-your-own-issuer**: the customer (or a partner fintech) owns the Issuing account; Aperture gets a restricted key and is the authorization endpoint. Aperture never touches money.
5. Card metadata (`agent_id`, `budget_id`, `mandate_id`) makes authorization decisions O(1) lookups.

### NymCard (UAE)

- UAE card-issuing / BaaS platform with public APIs; virtual cards "in under 20 minutes". — [site](https://nymcard.com/en-ae/card-issuing/)
- Per-card **authorization controls**: countries, MCC lists (up to 1,000 codes), merchant IDs — allow/deny, set at product or card level. — [docs](https://docs.nymcard.com/get-started/product-management/authorization-controls)
- **Velocity limits**: amount and count limits; daily/monthly/yearly/lifetime/`NUM_OF_DAYS`; product or card level; advanced limits with MCC/merchant/origin conditions; managed via API. — [docs](https://docs.nymcard.com/get-started/product-management/velocity-limits)
- **Webhooks** for `TRANSACTION` events with `message_type = AUTHORIZATION` (purchase, refund, reversal…), clearing, card status; retried until acknowledged. — [docs](https://docs.nymcard.com/get-started/webhooks/webhooks-samples)
- **VERIFY**: public docs do not describe a synchronous "approve/decline in the webhook response" (external authorization / JIT funding). Ask NymCard (Phase 0).

**Implications**: design the card connector with two modes: **real-time decisioning** (Stripe, and NymCard if available) and **limit mirroring** (push per-card velocity limits = remaining budget after every event; bounded overspend of at most the in-flight transactions).

### UAE spend-management platforms

Alaan, Qashio (raised USD 32.3M), Pemo, Pluto, Mamo offer corporate cards and expense tools with AI-assisted receipts and categorization. No AI-token governance or agent identity found. — [Fintech News UAE](https://fintechnews.ae/32573/payments/corporate-credit-cards-uae/), [Qashio](https://www.qashio.com/)

**Implications**: potential partners (card rail + distribution) as much as competitors. Ask about APIs in Phase 0.

### Ramp (US)

- **Agent Cards** (Mar 2026): tokenized single-use virtual cards per agent and transaction via API/MCP, merchant controls, inherit the issuing user's approval chain. — [Ramp](https://agents.ramp.com/cards)
- **AI Token Spend Management** (16 Jul 2026): connects Anthropic, OpenAI, Cursor, Gemini; breakdown by provider/team/person/project/API key; limits by team/project/key; anomaly alerts; weekly briefings. AI token spend on Ramp grew 20.7× since June 2025. — [Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/ramp-launches-ai-token-spend-130000381.html), [Ramp blog](https://ramp.com/blog/ai-agent-spending-controls)

**Implications**: validates the market. Differentiate on multi-rail ledger + mandates + workspace for non-developers + x402 + GCC/self-hosting.

---

## AI providers (admin APIs)

### OpenRouter

- Management key creates keys: `POST /api/v1/keys` with `name`, `limit` (USD), `limit_reset` (`daily`/`weekly`/`monthly`/null, resets **midnight UTC**), `include_byok_in_limit`, `expires_at`, `workspace_id`, `external.user`. Key string shown **once**; identified by `hash`. List/get/update(disable)/delete endpoints exist. — [create](https://openrouter.ai/docs/api-reference/api-keys/create-api-key), [FAQ](https://openrouter.zendesk.com/hc/en-us/articles/51680687417499-Can-I-create-one-API-key-per-user-with-its-own-spending-limit-Management-API-keys)
- Limit enforcement rejects requests **before** they reach the provider; concurrent bursts can slightly overshoot. — [limits](https://openrouter.ai/docs/api_reference/limits)
- Every response includes `usage` with `cost` and `cost_details.upstream_inference_cost`; for streaming it's in the last SSE message; `/generation?id=` for later lookup. — [usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting)
- BYOK supported. — [BYOK](https://openrouter.ai/docs/use-cases/byok)

**Implications**: best provider-native control. Use per-principal OpenRouter keys with limits mirrored from our ledger (T1), and OpenRouter as the default upstream for the gateway (its `usage.cost` gives exact settlement).

### OpenAI

- Admin API: projects, project users, **service accounts (creating one returns an API key)**, project API keys (list/retrieve/delete), per-project per-model **rate limits** (update), audit logs, usage (1-minute buckets, group by project/key/model), **costs (daily buckets)**. — [service accounts](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/service_accounts/methods/create), [costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
- **Project budgets can't be set via API** (community reports). — [forum](https://community.openai.com/t/api-endpoint-to-manage-project-budgets/1380411)

**Implications**: T2 detect-and-revoke: estimate cost from 1-minute usage × price catalog, delete the service-account key on breach; ask the customer to set a project budget in the dashboard as backstop (Phase 0 checklist).

### Anthropic (Claude Platform)

- Admin API (Admin key `sk-ant-admin…`, OAuth `org:admin`, or org-scoped service account key): users, invites, workspaces, workspace members, API keys (**read, rename, change status only — keys are created in the Console**), service accounts, rate-limit reads. — [Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api)
- Workspaces support per-workspace monthly spend limits (set in Console); the spend-limits API is for Claude Enterprise (claude.ai) orgs. — [workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces)
- Usage & Cost API: `/v1/organizations/usage_report/messages` (1m/1h/1d buckets, filter/group by `api_key_id`, `workspace_id`, `model`…), `/v1/organizations/cost_report` (daily, USD); data usually within **5 minutes**; polling once per minute is fine. — [usage-cost](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)

**Implications**: T2. Import existing keys, map key → person/agent, poll 1-minute usage, set key `inactive` on breach. Workspace per team with Console spend limit as backstop.

### Google (Gemini API / Vertex)

- Budget alerts via Pub/Sub → programmatic reactions (disable billing, delete keys). — [disable billing](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)
- **Spend cap budgets** (preview): Gemini API and Vertex AI are eligible; per project and per service; estimated costs, not instantaneous; lifting is manual; API configurability not documented. — [spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)

**Implications**: T2/T3 at best (hours of lag). Recommend Gemini traffic through the gateway; use spend caps as backstop.

### Hugging Face

- Inference Providers bill to an org with `X-HF-Bill-To: <org>` (or a resource group); Enterprise Hub admins can set a spending limit and disable providers; usage on the billing page. — [pricing](https://huggingface.co/docs/inference-providers/pricing)

**Implications**: route through the gateway (HF router is OpenAI-compatible) for T0; otherwise T3 visibility.

### Media generation

| Provider | Model of work | Price examples (Sep 2026) | Notes |
|---|---|---|---|
| Google Veo (Gemini API) | long-running operation, 1–2 min | Veo 3.1 Lite $0.05/s, Fast $0.10/s, Standard $0.40/s; Veo 3 $0.75/s | [costgoat](https://costgoat.com/pricing/google-veo) |
| Runway API | tasks, credits ($0.01/credit, $10 min top-up) | Gen-4 Turbo $0.05/s, Gen-4.5 $0.12/s | [guide](https://apiframe.ai/guides/runway-api-guide) |
| fal.ai | queue API, prepaid credits | video $0.05–$0.40/s, images $0.02–$0.09; **failed (5xx) requests and queue time not billed** | [fal pricing](https://fal.ai/docs/documentation/model-apis/pricing), [queue](https://docs.fal.ai/model-apis/model-endpoints/queue) |
| OpenAI Sora 2 API | async `/v1/videos` | $0.10–$0.70/s | **API retired 24 Sep 2026** — do not build on it. [costgoat](https://costgoat.com/pricing/sora) |

**Implications**: media costs are known before the job (duration × price/second × variants) → perfect fit for **authorize-then-capture holds**. Job TTLs are minutes, not seconds.

### Gateways (build vs. adopt)

- **LiteLLM**: MIT core (virtual keys, budgets, team budgets, `budget_duration`, budget reservation, fail-closed option, /videos for Sora/Veo/Runway); enterprise-only per-model budgets, SSO beyond 5 users, audit logs. **PyPI supply-chain compromise on 24 Mar 2026** (versions 1.82.7/1.82.8 via a poisoned Trivy CI step; secrets from ~2,488 companies exposed). — [budgets](https://docs.litellm.ai/docs/proxy/users), [incident](https://docs.litellm.ai/blog/security-update-march-2026), [Trend Micro](https://www.trendmicro.com/en_us/research/26/c/inside-litellm-supply-chain-compromise.html)
- **Portkey Gateway**: TypeScript, Gateway 2.0 open-sourced under Apache 2.0 (2026), self-hostable; reportedly being acquired by Palo Alto Networks. — [GitHub](https://github.com/portkey-ai/gateway), [review](https://chatforest.com/reviews/portkey-ai-gateway-review/)
- **Bifrost** (Go, Apache 2.0): virtual keys with hierarchical budgets (customer → team → key → provider), all checked independently. — [docs](https://docs.getbifrost.ai/overview)

**Implications**: hierarchical budgets on the request path are table stakes. Our value is the org-wide, multi-rail ledger and mandates, so we write a thin TypeScript passthrough gateway and keep provider translation out of scope. Portkey remains a fallback if we ever need broad provider translation.

---

## Crypto rail

### x402 protocol (v2)

- `PAYMENT-REQUIRED` header carries base64 `PaymentRequired { x402Version: 2, accepts[], resource, error?, extensions? }`; each requirement: `scheme` ("exact"), `network` (CAIP-2, Solana mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`), `amount` (atomic units), `asset` (mint), `payTo`, `maxTimeoutSeconds`, `extra` (`feePayer`, `memo`, optional `recentBlockhash`/`lastValidBlockHeight`). Facilitator endpoints `/verify`, `/settle`, `/supported`; `SettleResponse { success, transaction, network, payer, errorReason, amount }`. — [spec v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- **SVM `exact` scheme**: the client builds a transaction with a `TransferChecked` (SPL Token or Token-2022) to the **ATA of `payTo`**, partially signs it, and the facilitator adds the fee-payer signature and submits.
  - **Path 1 (all facilitators)**: 3–7 instructions in order: compute unit limit, compute unit price, `TransferChecked`, optional Lighthouse/Memo. Memo with the seller's `extra.memo` or a ≥16-byte random nonce is required.
  - **Path 2 (opt-in)**: simulation-based smart-wallet verification with an **allowlist** of wrapping programs: Squads Multisig v4, Squads Smart Account, Swig (legacy, v2), SPL Governance, Metaplex Core, Lighthouse. Fee payer must not appear in any instruction. Default caps: 400k CU, 50k microlamports priority fee. Operators may override the allowlist.
  — [scheme_exact_svm](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)
- Market: Solana ~70% of x402 volume (Aug 2026), 23.2M transactions in four weeks; USDC ~99% of agent payment volume; on Solana, facilitators **Dexter** (~69% of tx) and **PayAI** (~31%). — [Crypto Briefing](https://cryptobriefing.com/solana-x402-market-share-dominance/), [Solana Compass](https://solanacompass.com/news/solana-processes-76-of-all-x402-ai-agent-transactions-232-million-in-four-weeks), [Yahoo](https://finance.yahoo.com/markets/crypto/articles/ai-agents-starting-pay-things-180819027.html)

**Implications**
1. A custom policy program as the payer would fail Path 1 and isn't on the Path 2 allowlist → **don't build one**.
2. A plain `TransferChecked` signed by a **delegate** passes Path 1's structure. **VERIFY on devnet in Phase 9** that Dexter/PayAI accept a delegate authority (source owner ≠ signer).
3. On-chain enforcement later = Swig or Squads (allowlisted), not our own program.

### Solana wallet building blocks

- **Spend permissions** = SPL Token `approveChecked` / `revoke`; works for classic SPL Token (USDC, USDT) and Token-2022; the delegate can transfer up to the allowance; one delegate per token account; no built-in periods. — [solana.com](https://solana.com/docs/payments/advanced-payments/spend-permissions)
- **Swig**: smart wallet with up to 65k roles (authority + permissions), token spend limits, time-based limits, session keys; on the x402 Path 2 allowlist. — [Swig](https://swig.mintlify.app/), [Breakpoint 25](https://solanacompass.com/learn/breakpoint-25/swig-the-future-of-smart-wallets-on-solana)
- **Squads**: smart accounts with spending limits, sub-accounts, program allowlists (v5). — [Squads v5](https://squads.xyz/blog/squads-protocol-v5), [smart-account-program](https://github.com/Squads-Protocol/smart-account-program)
- **Turnkey** policy engine: per-transaction conditions on SPL transfers (amount, recipient, mint); **no cumulative/time-window limits**. — [docs](https://docs.turnkey.com/concepts/policies/examples/solana)
- **Privy** server wallets: policies with per-tx caps, allowlists, time windows; Solana supported. — [Privy](https://www.privy.io/agent-wallets)

**Implications**: the non-custodial design is **per-agent budget token account owned by the customer's treasury + delegate allowance to an Aperture-held signer**. The allowance is the on-chain hard cap; Aperture's ledger enforces daily/monthly/velocity/allowlists before signing. Turnkey/Privy don't solve cumulative budgets, so they'd only replace our key storage, not our ledger.

---

## Platform building blocks

- **Better Auth**: TypeScript auth with organization plugin and SSO plugin (OIDC + SAML 2.0, per-organization providers). — [SSO](https://better-auth.com/docs/plugins/sso)
- **Trident** (Ackee, supported by the Solana Foundation): guided + coverage fuzzing for Anchor programs; relevant only if we write on-chain code later. — [GitHub](https://github.com/Ackee-Blockchain/trident)

## Regulation (not legal advice — get an opinion in Phase 0)

- **VARA (Dubai)**: custody is judged by substance — "whether a firm exercises control over client assets or private keys in practice". Wallet-provision activity also needs a licence. — [Al Suwaidi](https://alsuwaidi.ae/virtual-asset-custody-services-regulation-in-dubai/), [VARA FAQ](https://www.vara.ae/en/faq/)

**Implications**: holding a **delegate key** that can move up to an allowance from a customer's account may be viewed as control. Options: (a) legal opinion that a capped, revocable delegate held for a business customer is not custody; (b) run the signer inside the customer's infrastructure (self-hosted signer); (c) use a licensed wallet provider. Phase 9 is gated on this.

---

## Research papers and standards

| Source | Key idea | How we use it |
|---|---|---|
| Wang, Yang, Chen, Ji, Payer — *When HTTP 402 Meets the Blockchain: Risks on Emerging x402 Payments*, USENIX Security 2026 ([arXiv 2607.19545](https://arxiv.org/abs/2607.19545)) | All 15 facilitators studied violated security rules; attacks: free shopping, asset theft, service denial, gas abuse; 119M Base/Solana transactions analysed | As a **payer**, never trust the 402 blindly: bind seller domain → `payTo`, cap per-call amounts, verify settlement on-chain ourselves, keep per-seller delivery stats |
| South et al. — *Authenticated Delegation and Authorized AI Agents* ([arXiv 2501.09674](https://arxiv.org/abs/2501.09674)) | Extend OAuth/OIDC with agent credentials; translate natural-language permissions into auditable access control | Mandates: human-issued, scoped, machine-checkable, audited |
| *Overlaying Governance: A Compositional Authorization Framework for Delegation and Scope in Agentic AI* ([arXiv 2606.03518](https://arxiv.org/abs/2606.03518)) | Delegation types, **resource scope attenuation**, overlaying agentic semantics on existing policies | Child mandate ⊆ parent mandate, enforced and property-tested |
| *Authorization Propagation in Multi-Agent AI Systems* ([arXiv 2605.05440](https://arxiv.org/abs/2605.05440)) | Transitive delegation, aggregation inference, temporal validity; invocation-bound capability tokens; execution-count revocation | Every hop re-checks the whole ancestor chain; revocation cascades; mandates carry expiry and use counts |
| *Before the Tool Call: Deterministic Pre-Action Authorization* / Open Agent Passport ([arXiv 2603.20953](https://arxiv.org/abs/2603.20953)) | Synchronous policy check before tool execution, signed audit; 0/879 attacks succeeded under restrictive policy; median 53 ms | Our decision point sits before money moves; fail-closed; signed audit records |
| *Agent-to-Agent Finance* ([arXiv 2607.00245](https://arxiv.org/abs/2607.00245)) | Agent wallets need spending caps, time limits, asset restrictions, counterparty allowlists, emergency revocation, human-approval thresholds, audit labels | Checklist for the x402 rail |
| Google **AP2** ([spec](https://ap2-protocol.org/specification/)) | Intent / Cart / Payment mandates as W3C Verifiable Credentials | Our mandate format should be exportable as a VC later; start with signed JWS |
| **OWASP Top 10 for Agentic Applications 2026** ([overview](https://neuraltrust.ai/blog/owasp-top-10-for-agentic-applications-2026)) | Excessive agency, tool misuse; "least agency" principle; mandatory observability | Default-deny scopes for agent keys; agents can't call control-plane mutations |
