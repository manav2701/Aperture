# Phase 11 — Governance posture, AI inventory, and signed attestations

**Goal:** answer three questions a buyer's CISO or compliance lead asks before they trust Aperture, and again every quarter after:

1. **What AI is in use here, and who owns it?** One inventory across agents, keys, providers, models, cards, and wallets, including AI spend that Aperture doesn't govern yet.
2. **Is our setup safe?** A posture check that lists what passes and what fails in the org's own Aperture configuration, with a fix link for every failure.
3. **Can we prove it to someone else?** A signed attestation for a period: what was spent, what was blocked, what was approved, and proof that the audit log wasn't altered. Anyone can verify it without trusting us.

**Duration:** ~3 weeks.
**Depends on:** Phases 3–10. Each check uses whatever rails the org has set up. A rail that isn't set up gives "not applicable", not a failure.
**Needs nothing from you:** no new accounts, keys, or services. All data is already in our database.

## Why this phase

The idea comes from the Duban hackathon project (GISEC 2026): scan an AI deployment, show pass/fail, and issue a certificate. Buyers respond to that packaging because it gives them something to show their board, a regulator, or a customer. Aperture can do this better than an outside scanner:

| | Outside scanner (Duban-style) | Aperture |
|---|---|---|
| What it sees | A snapshot of the configuration at scan time | Every gateway call, card authorization, and x402 payment, as it happens |
| What it can claim | "On this day the checks passed" | "From 1 to 30 September every governed spend went through policy, and here is the hash proof" |
| Evidence | The scanner's word | Hash-chained audit, a Merkle root, optional on-chain anchors, and an offline verifier |

It also gives sales a lead-in for the design partner: connect one provider, get a posture score in the first session.

**A correction to the first idea.** Shadow AI can't be found from our cards rail. Every Stripe Issuing card Aperture manages is already decided by the ledger in real time, so no ungoverned spend happens on it. Ungoverned AI spend lives in three other places, and 11.4 covers them:
- Provider keys created outside Aperture. Connectors already import their usage into the `unassigned` principal, but nobody sees that as a warning yet.
- Company cards and bank accounts that pay for ChatGPT, Cursor, Midjourney, and similar. We only see these if the customer uploads a statement.
- Personal subscriptions people expense later. These are out of scope here. The browser extension on the roadmap is the long-term answer.

## Starting point

- Audit chain with `verifyChain`, `merkleRoot`, JSONL export, daily anchors (`audit_anchors`), and the offline `pnpm audit-verify` CLI.
- Ed25519 JWS signing (`@aperture/crypto` `signJws` and `verifyJws`), per-org keys in `org_signing_keys`, and a JWKS endpoint at `/.well-known/aperture/orgs/:orgId/jwks.json`.
- Every table the checks need: `principals`, `budgets`, `policies`, `members`, `two_factors`, `api_keys`, `connections`, `credentials`, `gateway_requests`, `mandates`, `cards`, `card_authorizations`, `x402_accounts`, `org_settings`, `ledger_entries`.
- Alert channels (email, Slack webhook) and pg-boss jobs in the worker.
- `fx_rates` for converting statements in other currencies.

## Scope

**In:** posture check engine with a versioned check catalogue; waivers for accepted risks; a daily posture run with regression alerts; AI inventory with a governance coverage figure; shadow-AI detection from unassigned provider usage and uploaded statements; signed attestations (JSON plus PDF) with a public verify page and a CLI verifier; RBAC permissions; dashboard pages.

**Out:** testing the models themselves (prompt injection, jailbreaks, red-teaming). That's a different and crowded market (Lakera, Protect AI, Promptfoo). Also out: live bank and card feeds (Lean, Pemo, Ramp, Brex APIs), Google Workspace or Microsoft 365 OAuth-grant discovery, the browser extension, and anonymous "scan without signing up". All are listed under [After Phase 11](#after-phase-11).

**Optional, only if a design partner asks:** tagging checks to frameworks (11.6).

## Tasks

### 11.1 Posture snapshot and check engine (`packages/core/src/posture/`)

Two layers, so the logic is pure and easy to test:

- `collectPostureSnapshot(tx, orgId, now)` in `@aperture/db`. It runs a fixed set of aggregate queries and returns a plain typed object. **It never selects secret columns** (`secret`, `private_key`, `delegate_secret`, `hash`). A test asserts this (see Security).
- `evaluatePosture(snapshot, catalogue, waivers, now)` in `@aperture/core`. It's a pure function that returns one result per check: `pass`, `fail`, `unknown` (data missing or stale), or `not_applicable`. Each result carries a list of the subjects it covers (agent ids, key ids…) so the UI can link straight to them.

Every check is a typed record: `id`, `title`, `severity` (`critical`, `high`, `medium`, `low`), `rationale`, `appliesTo` (rail or area), `evaluate`, `fixHref`, and `frameworks` (empty until 11.6). The catalogue has a `version`, and every run stores the version it used.

**Score.** Weights are critical 10, high 5, medium 2, low 1. Score = passed weight ÷ applicable weight, shown as 0–100 with a grade. `unknown` counts as failed for the score, because a governance product doesn't report "fine" when it can't see. `not_applicable` is left out of the total.

**Catalogue v1** (about 30 checks, each built on existing columns):

| ID | Check | Severity | Data |
|---|---|---|---|
| `spend.org_root_hard` | The org has a root money budget in `hard` mode | critical | `budgets` scope=org |
| `spend.agent_capped` | Every active agent has its own hard money budget, or a mandate budget, on its path | critical | `principals` kind=agent × `budgets` |
| `spend.soft_without_alerts` | No soft budget is missing alert thresholds | medium | `budgets.mode`, `alert_thresholds` |
| `spend.approval_threshold_card_x402` | Card and x402 rails have an `approval_threshold` rule at org level | high | `policies.document` |
| `spend.per_action_cap_agents` | Agents are covered by a `max_amount_per_action` rule | high | `policies` resolved per agent |
| `spend.model_allowlist` | At least one `allow_models` or `deny_models` rule exists | low | `policies` |
| `access.privileged_2fa` | Every owner, admin, and finance member has 2FA on | critical | `members` × `two_factors` |
| `access.owner_count` | There are between 2 and 3 owners (no single point of failure, no sprawl) | medium | `members.role` |
| `access.agent_has_owner` | Every agent has an `owner_user_id` who is still a member | high | `principals`, `members` |
| `keys.expiry_set` | Gateway API keys have an expiry | medium | `api_keys.expires_at` |
| `keys.idle_live` | No live key has gone unused for 30 days or more | high | `api_keys.last_used_at` |
| `keys.age` | No live key is older than 90 days | medium | `api_keys.created_at` |
| `agents.idle_with_credentials` | No agent idle for 30+ days still holds live keys, cards, or x402 delegates | high | `principals` × last activity |
| `conn.healthy` | Every connection is `active`, has no `last_error`, and synced within 24 h | high | `connections` |
| `conn.unassigned_usage` | No provider usage in the period went to the `unassigned` principal | high | `credentials.principal_id` null × usage |
| `conn.enforceable` | Credentials with usage can be limited or revoked (`created_by_aperture` or a supported T2 path) | medium | `credentials` |
| `cards.merchant_rule` | Every active card is covered by a `merchant_categories` rule or Stripe `controls` | high | `cards`, `policies` |
| `cards.task_expired_active` | No task card is still active after its `expires_at` | high | `cards` |
| `cards.unseen_auths` | No authorization Stripe approved without asking us (`decision=unseen`) in the period | critical | `card_authorizations` |
| `x402.allowance_within_budget` | No on-chain allowance is bigger than the agent's remaining budget | critical | `x402_accounts.allowance` × budget remaining |
| `x402.per_payment_cap` | `max_per_payment` is no more than the policy's per-action cap | high | `x402_accounts`, `policies` |
| `x402.payee_allowlist` | x402 agents have an `x402_payees` rule | high | `policies` |
| `mandates.bounded_expiry` | No active mandate lasts longer than 90 days | medium | `mandates.expires_at` |
| `mandates.orphaned` | No active mandate belongs to a paused or revoked subject | high | `mandates` × `principals` |
| `mandates.key_rotation` | The org signing key is younger than 12 months | low | `org_signing_keys` |
| `audit.chain_intact` | The audit chain verifies from genesis (incrementally, see V15) | critical | `audit_events` |
| `audit.anchored` | If anchoring is on, the last anchor is under 48 h old | medium | `audit_anchors` |
| `data.prompt_logging_full` | No policy sets `prompt_logging` to `full` without a waiver | medium | `policies` |
| `data.retention` | Request-log retention is 365 days or less | low | `org_settings` |
| `ledger.no_drift` | Ledger totals match budget usage (reuse the `verify-db` logic) | critical | `ledger_entries`, `budget_usage` |

**VERIFY** each threshold (30, 90, and 365 days, 2–3 owners) with the design partner, then make them org settings. The defaults stay as above.

### 11.2 Runs, waivers, and alerts

- New tables: `posture_runs` (`id`, `org_id`, `catalogue_version`, `trigger` = `scheduled`/`manual`/`attestation`, `score`, `results` jsonb, `ran_at`) and `posture_waivers` (`id`, `org_id`, `check_id`, `subject_id` (null = whole check), `reason`, `created_by`, `expires_at` (required, at most 180 days), `revoked_at`).
- A waived failure shows as `waived`, still listed, and scores as passed. Creating, revoking, and expiring a waiver each write an audit event.
- A daily pg-boss job `posture.run` runs for every org. It diffs against the last run and alerts through the existing channels on any **new** critical or high failure, and on waivers that expire within 7 days.
- `POST /orgs/{id}/posture/runs` for a manual run, rate-limited to one per minute per org.

### 11.3 AI inventory and governance coverage

- `GET /orgs/{id}/inventory` returns one row per thing that can spend, each with owner, team, budget, last activity, 30-day spend, and **governance status**:
  - `enforced`: spend goes through the gateway, a managed card, or an x402 allowance under a hard budget.
  - `visible`: imported provider usage that we can only limit afterwards (T1/T2).
  - `unassigned`: provider usage from keys not mapped to anyone.
  - `external`: AI spend found on an uploaded statement (11.4).
- The row kinds are agents, users who spend, gateway API keys, provider credentials, connections, models used (from `gateway_requests` and imported usage), cards, x402 accounts, and active mandates.
- **Coverage figure** for the period: the share of AI spend in each status. This is the headline number on the page and in the attestation, for example "82% enforced · 11% visible · 4% unassigned · 3% external". It's computed from the ledger plus `external_spend`. The two never mix (see invariant below).
- Dashboard page **Inventory** with filters by status, rail, team, and owner, plus CSV export (with formula-injection escaping).

### 11.4 Shadow-AI detection

**From provider connectors (no new data):** promote unassigned usage from a quiet catch-all bucket to an inventory item and a posture failure. Add a "claim this key" action that assigns a credential to a principal, so its usage moves to that principal from then on. Earlier usage stays where it was booked, with an audit note.

**From statements (new):**
- **AI merchant catalogue** in `packages/core/src/ai-merchants.ts`: vendor → descriptor patterns, category (chat, coding, image, video, voice, API), and the matching Aperture provider id when there is one. Start with about 40 vendors: OpenAI/ChatGPT, Anthropic/Claude, Google (Gemini, AI Studio), Microsoft Copilot, GitHub Copilot, Cursor, Perplexity, Midjourney, Runway, ElevenLabs, Replicate, OpenRouter, Hugging Face, Mistral, Groq, Together, Fal, Suno, Jasper, Notion AI, and others. **VERIFY** the descriptor strings against real statements (the design partner's, redacted) before trusting precision numbers.
- **Upload flow:** the user picks a CSV export from their bank or card provider. **Parsing and matching happen in the browser.** Only rows that match an AI vendor (date, amount, currency, descriptor, matched vendor) are sent to the server. Unrelated transactions never leave the user's machine, which is a strong privacy point for UAE finance teams. A mapping step confirms which columns are date, amount, and description, and is remembered per bank format.
- New table `external_spend` (`id`, `org_id`, `occurred_on`, `amount` µUSD, `original_amount`, `original_currency`, `descriptor`, `vendor`, `category`, `source` = `statement_upload`, `upload_id`, `dedupe_hash`, `status` = `open`/`assigned`/`governed`/`dismissed`, `assigned_principal_id`, `assigned_team_id`, `note`). Converted at the `fx_rates` rate for that day.
- **Invariant INV-16: `external_spend` never touches `ledger_entries`, `holds`, or `budget_usage`.** It's evidence of ungoverned spend, not spend Aperture controlled. It shows only in inventory, coverage, posture, and attestations, always labelled "external". A test enforces this (see Tests).
- **Double counting (V12):** a company card that pays the OpenAI invoice for an account Aperture already connects is *not* shadow AI. If a connection exists for the matched provider, the row is tagged `provider_billing` with a link to that connection and is left out of the "external" share.
- **Resolve actions** for each row: assign to a person or team; "bring under governance", which opens the matching next step (connect the provider, issue an agent card, invite the person to the workspace); or dismiss with a reason. Each action writes an audit event.

### 11.5 Signed governance attestations

**What it is.** A JSON document, signed as a JWS, for an org and a period (a month, a quarter, or custom dates in the org's timezone). The PDF is a rendering of the JSON. **The JSON is the record of truth.**

Contents:
- Org name and id, period, generation time, catalogue version, and the Aperture version.
- Posture: results at period end, plus the worst result for each check during the period (from `posture_runs`).
- Activity, computed from the ledger and audit log, not from request logs that may already be deleted (V6): spend per rail, request counts by outcome (allowed and each deny reason), approvals granted and denied, mandates issued and revoked, kill-switch uses, and active waivers with their reasons.
- Coverage figure (11.3).
- Audit proof: first and last `seq`, the hash before the first event, the last hash, the Merkle root of the period's event hashes, and the anchor signatures in the period. Anyone with the period's audit export can recompute these with `pnpm audit-verify`.
- A fixed disclaimer: **"This attestation records what Aperture observed and enforced. It is not a certification, audit opinion, or statement of regulatory compliance."** Have the lawyer approve the wording during the legal review (`your-checklist.md`).

**Who signs it (decision for ADR 0020).** Recommended:
- On Aperture Cloud, a **platform attestation key** (Ed25519, envelope-encrypted, published at `/.well-known/aperture/jwks.json`, retired keys stay published). The claim then reads "observed by Aperture Cloud". Signing with the org's own key would only show that the org attests to itself.
- On self-hosted installs, an **instance key**, labelled "self-hosted, attested by the operator of `<instance>`", so nobody mistakes it for a Cloud attestation.

**API and UI:**
- `POST /orgs/{id}/attestations` starts a job that builds the JSON, signs it, renders the PDF, and stores both privately. Then `GET …/attestations` and `GET …/attestations/{aid}` (JSON and PDF downloads).
- Optional **share link**: an unguessable token with an expiry (at most 90 days) that can be revoked. The shared page shows the summary and the verify button. Opening the link is rate-limited and audited.
- **Public verify page** `/verify`: drop in the JSON. It checks the JWS against the published JWKS in the browser and shows exactly what was verified. Optionally drop in the audit export too, and the page recomputes the Merkle root and chain range.
- **CLI:** `pnpm attestation-verify att.json [--audit audit.jsonl] [--check-anchors]` in `tools/cli`, reusing `verify.ts` and `anchor-check.ts`. It works offline with a saved JWKS.
- **PDF:** render in the worker with `@react-pdf/renderer` (no headless Chromium in our images). Include a QR code that links to the verify page. **VERIFY** the library's licence and bundle size before adopting it.

### 11.6 Framework mapping (optional, only on request)

Tag checks with related controls so compliance buyers can file the attestation as evidence: ISO/IEC 42001:2023 Annex A, the NIST AI RMF 1.0 functions (Govern, Map, Measure, Manage), EU AI Act deployer duties (for example record-keeping and human oversight), and the UAE AI Charter and DIFC Regulation 10 for GCC buyers. Always say **"related to"**, never "compliant with". **VERIFY** every mapping and the current EU AI Act application dates with counsel before shipping. Dates for high-risk systems were under revision in 2025–26.

### 11.7 Permissions, dashboard, onboarding

- New RBAC permissions in `packages/core/src/rbac.ts`:

  | Permission | owner | admin | finance | team_lead | member | auditor |
  |---|---|---|---|---|---|---|
  | `posture.read` | ✓ | ✓ | ✓ | ✓ (own team's subjects) | | ✓ |
  | `posture.waive` | ✓ | ✓ | | | | |
  | `inventory.read` | ✓ | ✓ | ✓ | ✓ (own team) | | ✓ |
  | `external_spend.import` | ✓ | ✓ | ✓ | | | |
  | `attestation.create` | ✓ | ✓ | ✓ | | | |
  | `attestation.read` | ✓ | ✓ | ✓ | | | ✓ |

- Dashboard: **Posture** (score, grade, failures grouped by severity, each with a fix link and a "waive" button, plus history), **Inventory**, **Shadow AI** (unassigned keys plus statement rows), and **Attestations**.
- Onboarding checklist (from Phase 10): show the first posture score as soon as the first provider is connected.
- Billing hypothesis to test with the pilot: posture and inventory on every plan (that's how people find us), statement import on Team and above, attestations on Business. Enforce through the existing `org_billing` plan limits.

## Edge cases covered

V1–V16 (new section in [edge-cases](../../edge-cases/README.md#posture-inventory-and-attestations)), plus K2 (unseen card authorizations, surfaced as a check) and O5 (tampered audit, shown in the attestation).

## Tests

- **U:** each catalogue check against fixture snapshots that pass, fail, are unknown, and are not applicable. Score arithmetic. Merchant matcher precision and recall on a labelled descriptor fixture (target precision ≥ 0.98, recall ≥ 0.9, re-measured after VERIFY). CSV parser on exports from the 5 most common UAE banks and card providers (Emirates NBD, ADCB, FAB, Mashreq, Pemo; formats **VERIFY**).
- **P:** `evaluatePosture` is deterministic. Adding a control (a budget, a rule, 2FA) never lowers the score (monotonicity). A waiver changes only its own check and subject. Coverage shares always sum to 100%.
- **F:** fuzz the CSV parser with malformed rows, huge files, odd encodings, formula payloads (`=`, `+`, `-`, `@`), and mixed currencies.
- **I (Testcontainers Postgres):** the snapshot never returns secret columns (assert on the generated SQL column list). RLS stops cross-org reads on every new endpoint. INV-16: importing statements changes no row in `ledger_entries`, `holds`, or `budget_usage`. A daily run alerts on new failures only. Statement uploads are deduplicated. Waivers expire.
- **Attestation:** sign, then verify. Flipping any byte of the JSON fails verification. Attestations made before a key rotation still verify. The Merkle root and chain range in the attestation equal those recomputed from `audit export` by the CLI. An attestation over a period with a broken chain says "chain broken at seq N" and can't claim "intact" (V5). Statistics still match after the request-log retention job has deleted logs (V6).
- **E (Playwright):** connect the fake provider, then see a score. Fix a failure and the score rises. Waive a check. Upload a statement and only matched rows reach the server (assert on the network request). Generate an attestation, download it, verify it on `/verify`. Open a share link, revoke it, and see it refused.
- **Performance:** a snapshot for an org with 10k agents, 50k keys, and 5M audit events at p95 < 2 s. Chain verification is incremental from the last checkpoint (V15).

## Security checklist

- [ ] Snapshot and inventory code reads no secret columns (test-enforced)
- [ ] Unmatched statement rows never leave the browser; the server re-validates every uploaded row and limits size (5 MB, 20k rows)
- [ ] CSV exports escape formula prefixes
- [ ] Attestations hold no personal data beyond the org name, counts, and agent names (no emails); a test asserts the JSON's keys
- [ ] The platform attestation key is envelope-encrypted, backed up offline with the KEKs, and has a rotation runbook in `docs/runbooks/`
- [ ] Share-link tokens have ≥128 bits of randomness, are stored hashed, can expire and be revoked, are rate-limited, and are audited
- [ ] The verify page works fully client-side; uploaded attestations aren't stored
- [ ] The disclaimer is approved by counsel; no UI copy says "certified" or "compliant"
- [ ] Waivers need a reason and an expiry, and are audited

## Deployment

Migrations for `posture_runs`, `posture_waivers`, `external_spend`, `statement_uploads`, `attestations`, and `attestation_shares`. A new pg-boss job `posture.run` (daily, spread across orgs) and `attestation.build` in the worker. A platform attestation key is generated per environment, never shared between staging and production. The public `/verify` page and `/.well-known/aperture/jwks.json` are served without auth and cached by Cloudflare. No new external services.

## Try it yourself

1. On staging, create a fresh org and connect the OpenRouter connection → **Posture** shows a score with failures such as "no root budget" and "owners without 2FA".
2. Click the fix link for `spend.org_root_hard`, create a hard root budget, then **Run now** → that check passes and the score goes up.
3. Create an OpenRouter key directly on openrouter.ai (outside Aperture) and make one tiny call (within the USD 1 cap) → after the next sync, **Inventory** shows it as `unassigned` and posture flags `conn.unassigned_usage`. Click **Claim** and assign it to an agent.
4. Make a CSV with ten rows (five AI vendors, five groceries) and upload it in **Shadow AI** → only the five AI rows appear. The browser's network tab shows the groceries were never sent.
5. **Attestations → New** for the last 30 days → download the JSON and PDF. Open `/verify` in a private window, drop in the JSON → "valid". Change one number in the JSON → "invalid".
6. Run `pnpm attestation-verify att.json --audit audit.jsonl` with the period's audit export → the chain range and Merkle root match.

## Exit criteria

- [ ] Catalogue v1 live, with a daily run and regression alerts
- [ ] Inventory with the coverage figure on staging
- [ ] Unassigned-key claiming and statement import working end to end, INV-16 enforced by test
- [ ] Attestations signed, downloadable, verifiable on the web and from the CLI; ADR 0020 written
- [ ] Disclaimer and UI wording approved in the legal review
- [ ] The design partner has seen their own posture score and one attestation, and told us which checks and frameworks matter to them

## After Phase 11

- Live spend feeds instead of CSV: Lean (UAE open banking), Pemo, Ramp, and Brex APIs.
- OAuth-grant discovery: list third-party AI apps that employees connected to Google Workspace (Admin SDK Tokens API) or Microsoft 365 (Entra enterprise apps). **VERIFY** scopes.
- Browser extension for shadow-AI discovery (already on the roadmap).
- Scheduled attestations (monthly, auto-shared with a named auditor).
- Org-defined custom checks written in the policy rule language.
