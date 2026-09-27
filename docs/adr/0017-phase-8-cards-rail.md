# 0017 — The fiat cards rail on Stripe Issuing (Phase 8)

**Status:** Accepted (built against Stripe's documentation and fakes; sandbox verification waits on D5)
**Date:** 2026-09-28

## Context

ADR 0007 chose bring-your-own issuer: Aperture decides authorizations on the customer's own card program and never becomes a program manager. We have no Stripe Issuing access yet (decision D5). So this phase is built against Stripe's documented objects and webhooks, with fakes. The live checks listed in `plan/deferred.md` must run before any customer uses it.

## Decisions

1. **One connection per org** (`connections.provider = stripe_issuing`).
   - It holds the restricted key and the two webhook signing secrets, encrypted together.
   - It creates one company cardholder.
   - Aperture shows the two endpoint URLs to set in Stripe, and reminds people to set the timeout behaviour to decline (K1).
2. **The authorization endpoint is the hot path.**
   - The raw body is signature-checked with a 5-minute tolerance.
   - Everything else runs in one database transaction with no outbound calls: card → FX → mandate chain → policy (rail `card`, merchant category, country and name) → reserve → count the mandate use → record the decision and audit it.
   - Any error declines.
   - The answer carries `aperture_reason`, and `aperture_hold_id` or `aperture_approval_id`.
   - Connection secrets are cached for 60 s, so the path decrypts once a minute.
3. **Merchant matching uses Stripe's `merchant_data.category`,** which Stripe derives from the MCC, never the merchant's name (K15). The same names feed the card's `allowed_categories` backstop.
4. **Holds.**
   - Each decision, including every incremental authorization (K4), is its own hold. The hold is keyed by `iauth + request_history length`, lasts 31 days, and is released on expiry.
   - Captures are recorded as they arrive and settle the holds when the authorization closes, is reversed, or expires (K5, K6; overage is flagged by `settle`).
   - A capture after settlement is an `unheld_capture` (K11).
   - Stripe approvals made without us create no hold. They raise an alert, and their captures count as unheld spend (K2).
   - Force captures are unheld spend with an alert, and single-use cards are frozen (K7, K8).
   - Refunds reverse a capture of the same authorization, or become a negative adjustment (K9, L13).
   - Because of this, total spend depends only on the _set_ of events. INV-11 is property-tested with shuffled and duplicated deliveries, and events are deduplicated in `webhook_receipts` (K3).
5. **Nightly reconciliation replays Stripe's view through the same state machine.**
   - It covers the last 7 days of authorizations and transactions, using synthetic event ids.
   - It also counts `webhook_timeout` and `webhook_error` decisions, and alerts on them.
6. **FX (K10):**
   - Rates come daily from Frankfurter (ECB reference rates, free, no key), plus fixed GCC pegs (AED, SAR, QAR, OMR, BHD, JOD).
   - Conversion uses minor-unit exponents (JPY 0, KWD 3), and holds round up.
   - A currency with no rate is declined (fail closed).
7. **Task cards (§8.5).**
   - An over-threshold card purchase is declined and opens a card-rail approval. So does an agent's `POST /v1/cards/task` (SDK `createTaskCard`, MCP `create_task_card`).
   - Approving it, from the dashboard or Slack, issues a single-use virtual card: `cancel_after.payment_count = 1`, per-authorization limit equal to the approved amount, the approved category only, bound to the approval's one-shot mandate.
   - Unused task cards are canceled after 24 h (K12).
   - Task cards always go through a person; agents cannot mint cards on their own.
8. **No card numbers, anywhere (K13).** The Stripe client refuses any request that expands number or CVC, and a Semgrep rule blocks writing one in both the object and form-encoded spellings. Card details are fetched by the customer's runtime with its own key.

## Consequences

- Stripe API version pinned at `2024-06-20`. Response header and payload shapes follow Stripe's docs as of that version; confirm them in the sandbox.
- A partial reversal frees budget when the authorization closes, not at the moment of the reversal.
- NymCard (§8.7) is deferred. Nothing public confirms real-time decisioning, and no API access was available. The limit-mirroring design in the plan stands.
- Deferred until Stripe access:
  - the sandbox scenario suite;
  - the p99 < 400 ms latency measurement and region choice;
  - the k6 load test;
  - the dispute helper;
  - the timeout-behaviour health check against `request_history`, which today runs in the nightly reconciliation.
