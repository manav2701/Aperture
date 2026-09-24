# Phase 8 — Fiat cards rail (Stripe Issuing, NymCard)

**Goal:** agents and people pay with cards from the customer's own card program, and every authorization is decided in real time against Aperture's ledger and policies — the fiat equivalent of the old transfer hook.
**Duration:** ~3 weeks.
**Depends on:** Phases 2, 3, 7 (approvals); Phase 0 decision D5 (Stripe Issuing access) and NymCard answers.

## Starting point

Ledger with holds, policy rules for merchants/countries, approvals and one-shot mandates, audit, worker.

## Scope

**In:** Stripe Issuing connection (bring-your-own issuer), real-time authorization webhook, event state machine, card creation (agent cards, single-use task cards), `spending_controls` backstop mirroring, reconciliation, dispute helper, approval → single-use card flow, SDK/MCP `create_task_card`; NymCard connector behind a feature flag (limit-mirroring mode; real-time mode only if NymCard confirms support).
**Out:** Aperture as a card program manager; physical cards; handling full card numbers.

## Tasks

### 8.1 Stripe connection
- Wizard: customer creates a **restricted key** (Issuing cards/cardholders/authorizations/transactions read+write, Disputes write) → paste → `test()`.
- Aperture shows two URLs to configure in the customer's Stripe dashboard: the **real-time authorization endpoint** `/webhooks/stripe/{connectionId}/authorization` and the **events endpoint** `/webhooks/stripe/{connectionId}/events`, plus the reminder to set the **authorization timeout behaviour to decline** (K1). Webhook signing secrets are pasted back and stored encrypted.
- Health: nightly check that recent authorizations have `request_history.reason` = `webhook_approved/declined` (not timeouts).

### 8.2 Real-time authorization handler (hot path, p99 < 400 ms)
1. Verify `Stripe-Signature` on the raw body; parse with Zod.
2. `card.metadata.aperture_principal_id` → principal (cache); unknown card → decline + alert.
3. Build the decision input: amount (`pending_request.amount`, card currency → µUSD via the day's FX rate, K10), merchant `{name, category (MCC), country, network_id}`, time.
4. `evaluate()` → deny → `{"approved": false}` + audit; `require_approval` → decline + create approval (K16).
5. `reserve()` with idempotency key `iauth_… + request_history length` (incremental authorizations get their own hold, K4).
6. Respond `{"approved": true}` with `metadata.aperture_hold_id`.
7. No outbound network calls on this path. Everything else is async.

### 8.3 Event state machine (`issuing_authorization.created/updated`, `issuing_transaction.created`)
- Idempotent via `webhook_receipts`; per-authorization state machine (K3). On doubt, fetch the authorization from the Stripe API and reconcile to its current state.
- Approved without our decision (`webhook_timeout`/`webhook_error`/Autopilot) → create hold + alert (K2).
- Partial reversal → partial release; full reversal/expiry → release (K5); late capture after expiry → `unheld_capture` linked (K11).
- Capture → settle (partial/over/multi-capture; overage flagged) (K5, K6).
- Transaction without authorization (force capture) → `unheld_capture` + alert + optional auto-freeze (K7, K8).
- Refund → `refund` entry (L13); negative refund → `adjustment` (K9).

### 8.4 Cards
- Cardholder strategy: one **company** cardholder per org (or per legal entity) created at connection time; cards carry agent metadata.
- `POST /agents/{id}/cards` → virtual card with metadata and backstop `spending_controls` (per-authorization ≤ policy max; monthly ≤ budget + 10%; `allowed_categories` from policy; `allowed_merchant_countries`).
- **Single-use task cards**: `lifecycle_controls.cancel_after.payment_count = 1`, tight `spending_controls` (exact amount cap, specific categories), expiry in 24 h enforced by our worker canceling unused cards (K12).
- Backstop mirroring via `limits.mirror` when budgets change.
- **Never** request card numbers (`expand[]=number` banned by Semgrep rule, K13). The agent runtime retrieves details from Stripe using the customer's own key, or uses Stripe's programmatic checkout (SPT) flow.

### 8.5 Approval → single-use card
- After a declined `require_approval`, approving creates a single-use card scoped to the merchant category and amount and notifies the requester/agent (SDK `approvals.wait()` returns `{ cardId }`).

### 8.6 Reconciliation and disputes
- Nightly: list authorizations and transactions from Stripe for the last 7 days and compare with the ledger; fix drift with `adjustment` entries and alert.
- Dispute helper: when settled amount − authorized amount > threshold, or for force captures on single-use cards, prefill `POST /v1/issuing/disputes` for a human to confirm.

### 8.7 NymCard connector (feature-flagged)
- Depending on Phase 0 answers:
  - **Real-time decisioning available** → same handler shape as 8.2 behind NymCard's contract.
  - **Not available** → limit mirroring: create cards with MCC/merchant/country controls from policy and per-card velocity amount/count limits = remaining budget; transaction webhooks → ledger; re-mirror after each event. Document the bounded overspend (K14).

### 8.8 UI, SDK, MCP
- Agent detail → **Cards** tab (list, freeze/unfreeze, cancel, controls, recent authorizations with decisions).
- Connections → Stripe and NymCard wizards.
- SDK `cards.createTaskCard({ amount, categories, purpose })`; MCP tool `create_task_card` (returns card id and instructions, never the number).

## Edge cases covered

K1–K16, L13, INV-11.

## Tests

- **Unit:** FX conversion; merchant matching preferring MCC/network id over name (K15); state machine transitions table-driven from Stripe's lifecycle table.
- **Property:** INV-11 — for event sequences generated from the documented lifecycle (auth → increments → partial reversal → captures → refunds), any shuffle/duplication converges to the same ledger.
- **Fuzz:** authorization handler with arbitrary JSON after signature verification → never approves invalid input; always responds within the time budget.
- **Integration (Stripe sandbox):** use test helpers: create authorization (approve/deny paths), increment, partial reverse, capture with `capture_amount` above/below, multi-capture (`close_authorization=false`), expire, `create_force_capture`, `create_unlinked_refund`, refund; verify ledger after each.
- **Load:** k6 hitting the authorization endpoint with signed synthetic events at 50 rps → p99 < 400 ms (K1).
- **E2E:** agent card → USD 12 allowed purchase → USD 600 over threshold → declined + approval → approve → single-use card → purchase allowed → card auto-canceled.

## Security checklist

- [ ] Stripe signatures verified on raw bodies; secrets per connection, encrypted
- [ ] No card numbers requested or stored anywhere (Semgrep rule + code search in CI)
- [ ] Unknown cards declined; decisions audited with reasons
- [ ] Authorization endpoint has no outbound calls (review + test with network disabled)
- [ ] Customer set timeout = decline (connection health shows it)

## Deployment

Measure network latency from the staging server to Stripe's webhook origin; if p99 decision time exceeds 400 ms, deploy the `api` webhook routes to a US-region instance (same image, same DB via private link, or a small replica setup) — decide with data.

## Try it yourself

(Stripe sandbox with Issuing enabled, per decision D5.)
1. Connections → Stripe → follow the wizard; set the URLs and secrets in the Stripe dashboard.
2. Agents → research-bot → Cards → **Create card** (monthly USD 50, categories: computer software stores).
3. Simulate a purchase:
   ```bash
   pnpm try:card-auth --card ic_… --amount 12.50 --mcc 5734 --merchant "Acme Software"
   ```
   → approved; Spend shows a hold; then `pnpm try:card-capture --auth iauth_… --amount 12.50` → settled.
4. `--amount 600` → declined, approval created → approve in Slack → a single-use card appears → simulate USD 600 on it → approved → card status `canceled`.
5. `pnpm try:card-force-capture --card ic_… --amount 5` → alert "unheld capture" + card frozen (if enabled).
6. Stop the api container and simulate an authorization → Stripe declines on timeout (check `request_history.reason = webhook_timeout`).

## Exit criteria

- [ ] All sandbox scenarios reconcile exactly with Stripe (nightly job reports zero drift)
- [ ] Latency target met from the chosen region
- [ ] NymCard path decided and either implemented behind the flag or explicitly deferred with the reason

## Risks / open questions

- **Access to Stripe Issuing** is the main blocker for a UAE-based company (D5).
- Cardholder requirements (KYC data for a company cardholder) vary by country; the wizard must collect what Stripe asks for.
