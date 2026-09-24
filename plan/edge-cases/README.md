# Edge cases and how the architecture handles them

This is the architecture "tested in ideation": each scenario was walked through the design in [architecture/](../architecture/README.md). Every row names the test that proves the handling (U = unit, P = property-based, F = fuzz, I = integration, E = end-to-end, L = live/manual) and the phase that implements it. Test IDs are reused in the phase READMEs.

## Ledger, money, and concurrency

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| L1 | 200 requests reserve against the same budget at the same instant | Two transactions both read "USD 1 left" and both approve | Row locks on `budget_usage` (`SELECT … FOR UPDATE`) in one transaction; the second waits and sees the updated `held` | P+I: concurrent reserve storm on Testcontainers Postgres, assert I1 (Phase 2) |
| L2 | Two requests lock the same two budgets in different order | Deadlock | Lock rows in ascending `budget_id` order always | I: randomized interleavings, zero deadlocks (Phase 2) |
| L3 | Client retries a request after a timeout | Double hold / double spend | Idempotency key on holds and ledger entries (unique constraint); retry returns the existing hold | P: replay any op sequence twice = same state (Phase 2) |
| L4 | Floating-point rounding (0.1 + 0.2) | Budgets drift by fractions of a cent | `bigint` micro-USD everywhere; string parsing; lint rule bans `number` in money modules | U+F: parse/format round-trip fuzz (Phase 2) |
| L5 | Per-token price smaller than one micro-USD | Cost rounds to zero; unlimited cheap calls | Prices stored per million units; estimates use `ceil`; minimum charge per request of 1 µUSD | U (Phase 2) |
| L6 | Actual cost exceeds the hold (model generated more than estimated, e.g. reasoning tokens) | Budget silently exceeded | Settle actual, flag `overage`, alert; estimates include reasoning in `max_tokens`; next reserve sees the real spend | U+I (Phase 5) |
| L7 | Settle arrives after midnight for a hold reserved before midnight | Spend lands in the wrong period; today's budget double-charged | Hold stores `period_keys`; settle always applies to the reserved period | U (Phase 2) |
| L8 | Counters (`budget_usage`) drift from the journal due to a bug | Wrong decisions | Nightly `ledger.verify` recomputes from `ledger_entries` and alerts; counters can be rebuilt | P: I2 invariant (Phase 2) |
| L9 | Budget limit lowered below current spend mid-period | Negative remaining; confusing UI | Allowed; remaining shows 0 and "over by X"; all new reserves denied | U (Phase 2) |
| L10 | Budget deleted while holds are open | Orphan holds | Budgets are archived, never hard-deleted, while any hold or entry references them | I (Phase 3) |
| L11 | Principal moved to another team mid-period | Past spend attributed to new team; new team instantly over budget | Entries keep the `budget_ids` they were recorded with; only new reserves use the new path | U (Phase 3) |
| L12 | Child budgets sum to more than the parent | Surprise denials at the parent | Allowed by design (overbooking); UI warns; optional allocated mode | U (Phase 3) |
| L13 | Refund for a purchase from last month | Last month reopens; this month gets a credit | Credit the original period if it's still current, otherwise the current period; entry links the original | U (Phase 8) |
| L14 | Org timezone changed | Period keys shift, counters split | Timezone changes take effect at the next period boundary; stored on the budget row as `effective_from` | U (Phase 3) |
| L15 | DST transition (non-Dubai org) | 23- or 25-hour days mis-bucketed | Period computed with an IANA-aware library from the DB timestamp | P: random instants map to exactly one period (Phase 2) |
| L16 | Very large amounts (USD 10¹²) or negative amounts from a buggy connector | Overflow, negative spend | `bigint`; Zod rejects negative/oversized amounts at boundaries | F (Phase 2) |

## Policy and mandates

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| P1 | Team policy allows a model that org policy denies | Team overrides org | Intersection: every level must allow; any deny wins | P: monotonicity (Phase 2) |
| P2 | Sub-agent mandate tries to grant a model its parent doesn't have | Privilege escalation through delegation | Attenuation check on creation; policy evaluation also includes every ancestor mandate | P: child decisions ⊆ parent decisions (Phase 7) |
| P3 | Model pattern subset is undecidable for arbitrary globs | Can't prove child ⊆ parent | Patterns limited to exact or trailing `*`; validated by Zod | U+F (Phase 2) |
| P4 | Parent mandate revoked while a child is mid-request | Child keeps spending | Revocation cascades in one transaction; reserve re-checks mandate status inside the transaction | I (Phase 7) |
| P5 | Mandate expires between approval and use | Stale authority | `exp` checked inside reserve using DB `now()` | U (Phase 7) |
| P6 | Mandate `maxUses` race (two uses at once with 1 left) | Used twice | `uses` incremented in the reserve transaction with the mandate row locked | I (Phase 7) |
| P7 | Policy changed while cached in the gateway | Old policy applied | `LISTEN/NOTIFY` invalidation + max cache TTL 30 s; decision records policy versions used | I (Phase 5) |
| P8 | Malformed policy document saved via API | Engine crashes → fail open? | Zod validation on write; engine returns `deny` with reason `policy_invalid` on any internal error | F: arbitrary JSON into the engine never throws and never allows (Phase 2) |
| P9 | Time-window rule at 23:59:59.999 boundaries | Off-by-one allow/deny | Minutes-of-day in org tz, inclusive start, exclusive end; property tests around boundaries | P (Phase 2) |
| P10 | Prompt injection tells the agent to "raise your own budget" | Agent changes policy | Agent keys can't call control-plane mutations (scope check in the API router, tested per route) | I (Phase 3) + E (Phase 7) |

## Gateway (text and media)

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| G1 | Request without `max_tokens` | Unbounded cost; estimate impossible | Gateway injects the policy default; caps any larger value | U (Phase 5) |
| G2 | Huge prompt (10 MB) or many images | Estimate explodes; memory pressure | Body size limit (configurable, default 10 MB); per-image input maximums in estimate | I (Phase 5) |
| G3 | Client disconnects mid-stream | Tokens generated but usage unknown | Abort upstream, settle at hold amount, reconcile via OpenRouter `/generation` when available | I with a fake upstream (Phase 5) |
| G4 | Upstream returns 5xx after partial output | Charged but no result | Settle whatever usage is reported, else hold amount; log `partial` | I (Phase 5) |
| G5 | Upstream returns 429 | Agent retry storm | Pass 429 through with `Retry-After`; holds released | I (Phase 5) |
| G6 | Unknown model (not in price catalog) | Can't estimate | Deny with `model_not_priced` unless org sets a fallback price; OpenRouter models API refreshes daily | U (Phase 5) |
| G7 | Provider changes prices | Estimates wrong | Daily catalog sync; OpenRouter settlement uses its returned `cost`; catalog versioned by `effective_from` | U (Phase 5) |
| G8 | Cached tokens / cache writes / batch discounts | Over- or under-charging | Catalog has separate prices; settlement reads the provider's usage breakdown | U (Phase 5) |
| G9 | Tool-calling loop — agent makes 5,000 cheap calls | Death by a thousand requests | Count budgets (velocity) per principal; anomaly alert on request rate | I (Phase 5) |
| G10 | Aperture key leaked | Stranger spends budget | Budget still bounds damage; revoke in UI (instant via NOTIFY); key prefix scanning guidance (GitHub secret scanning partner pattern later) | E (Phase 5) |
| G11 | Gateway upstream key is also used directly by someone | Spend appears twice or not at all | Gateway upstream keys are `managed_by_gateway`, excluded from usage import, and shouldn't be distributed; connector alerts if usage on such a key exceeds gateway-recorded usage | I (Phase 6 + 4) |
| G12 | Video job exceeds hold TTL | Hold expires, spend unaccounted | Hold moves to `expired_reconciling`; worker queries the provider for the final state | I with a fake provider (Phase 6) |
| G13 | Provider bills failed media jobs (policy differs by provider) | Release when we were charged | Per-connector `billsOnFailure` flag; **VERIFY** per provider | U (Phase 6) |
| G14 | Generated media contains user data; public URLs | Data leak | Store in private bucket, short-lived signed URLs; fal's public output URLs are copied then not shared | I (Phase 6) |
| G15 | Streaming response while DB is slow | Head-of-line latency | Reserve happens before first byte; settle is async after stream end (outbox pattern) | L: load test (Phase 10) |

## Provider connectors

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| C1 | Anthropic usage arrives 5–10 min late | Budget overshoot before revoke | Shown as tier T2 in UI; soft thresholds alert at 80%; revoke at breach; customer sets Console workspace limit as backstop | I with recorded fixtures (Phase 4) |
| C2 | Provider API rate-limits our sync | Missing data | Backoff with jitter; cursor-based resume; lag alert | U (Phase 4) |
| C3 | Same usage bucket imported twice (retry) | Double counting | Idempotency key `provider:bucket:key:model` | P (Phase 4) |
| C4 | Provider revises a past bucket (late-arriving usage) | Under-counting | Re-import the last 2 hours each sync; store deltas as `adjustment` entries | U (Phase 4) |
| C5 | Admin key revoked by the customer | Silent loss of control | Connection health check each sync; status `broken` + alert; UI banner | I (Phase 4) |
| C6 | OpenRouter key limit set lower than current usage | Key blocked unexpectedly | Limit = key `usage` + remaining (absolute), recomputed on each mirror | U (Phase 4) |
| C7 | Key created outside Aperture (unknown) | Unattributed spend | "Unassigned" principal; alert; one-click assign | E (Phase 4) |
| C8 | OpenAI project budget not set by customer | T2 lag is the only protection | Setup checklist shows a warning until the customer confirms | L (Phase 4) |
| C9 | Two connections to the same provider account | Double import | Connection fingerprint (org id at provider) must be unique per Aperture org | I (Phase 4) |

## Cards

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| K1 | Webhook takes > 2 s | Stripe falls back to timeout setting | Timeout setting = **decline** (Phase 0 checklist); p99 < 400 ms; no external calls on hot path | L: k6 on staging (Phase 8) |
| K2 | Stripe Autopilot / `webhook_error` approves while we were down | Unheld spend | `issuing_authorization.created` with `request_history.reason` = `webhook_timeout`/`webhook_error` and approved → create hold + alert | I with Stripe test helpers (Phase 8) |
| K3 | Duplicate / out-of-order webhooks (`updated` before `created`) | Double holds, negative held | `webhook_receipts` idempotency; per-authorization state machine; if out of order, fetch the authorization from the Stripe API | P: random event orderings converge (Phase 8) |
| K4 | Incremental authorization (hotel adds USD 20) | Extra not checked | Another `issuing_authorization.request` → reserve the increment as an extra hold on the same authorization | I (Phase 8) |
| K5 | Partial capture / partial reversal | Held amount wrong | Release the difference; hold amount = remaining authorized | I (Phase 8) |
| K6 | Over-capture (tip, ride-hailing) | Spend > authorization | Settle actual, `overage` flag; can't block (network rule) | I (Phase 8) |
| K7 | Force capture (no authorization) | Unplanned spend | `unheld_capture`, alert, optional auto-freeze, dispute helper | I (`create_force_capture` helper) (Phase 8) |
| K8 | Force post after single-use card canceled | Second charge on single-use card | Same as K7 + suggest dispute | I (Phase 8) |
| K9 | Unlinked refund / refund reversal (negative refund) | Mis-credited budget | `refund` to current period when unlinked; negative refund → `adjustment` | I (Phase 8) |
| K10 | Foreign-currency purchase | FX changes between auth and capture | Reserve on card-currency amount converted at that day's rate; settle on transaction amount | U (Phase 8) |
| K11 | Authorization expires, then a late capture arrives | Hold released, then spend without hold | Late capture → settle as `unheld_capture` linked to the expired authorization (no alert if within tolerance) | I (Phase 8) |
| K12 | Recurring charge on an expired card | Surprise renewals | Stripe allows recurring auths on expired cards → cancel card on agent/task end, not just let it expire | U (Phase 8) |
| K13 | Agent needs the card number | PAN passes through our servers → PCI scope | Aperture never expands `number`; agent runtime fetches from Stripe with the customer's key, or uses SPT checkout | Review (Phase 8) |
| K14 | NymCard: two authorizations race before limit mirror updates | Overspend | Bounded by per-transaction cap and count limit; documented; T0 if real-time decisioning becomes available | I with simulated webhooks (Phase 8) |
| K15 | Merchant name spoofing ("OPENAI*" on an unrelated merchant) | Allowlist bypass | Prefer MCC + network merchant ID over names; names only as a secondary signal | U (Phase 8) |
| K16 | Approval needed for a card purchase (2 s window) | Can't wait for a human | Decline now, create approval; on approval, issue a single-use card with exact amount and MCC | E (Phase 8) |

## x402 on Solana

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| X1 | Seller's 402 asks for a different `payTo` than before (compromised seller or injected response) | Paying an attacker | `payTo` bound to origin (allowlist or first-seen binding); change needs Finance approval | U+F (Phase 9) |
| X2 | `amount` is huge or `asset` is a look-alike mint | Overpayment / wrong token | Asset must be the configured USDC/USDT mint for that network; amount ≤ per-call cap | F: fuzzed PaymentRequired never produces a signature outside policy (Phase 9) |
| X3 | Network mismatch (devnet requirement on mainnet account) | Lost funds / failed tx | CAIP-2 network must equal the budget account's network | U (Phase 9) |
| X4 | Blockhash expires before the seller settles | Hold stuck | Release after `lastValidBlockHeight` + margin if no matching transfer | I on local validator (Phase 9) |
| X5 | Seller settles but returns 5xx / no resource | Paid, nothing delivered | Settle (money moved); record `undelivered`; per-seller delivery stats; alert; can auto-block the seller | I with the test seller (Phase 9) |
| X6 | Agent reuses a PaymentPayload twice | Double charge | Each payload has a unique memo nonce and one hold; the on-chain allowance also caps; the second transfer is caught by reconciliation | I (Phase 9) |
| X7 | Treasury revokes the delegate or empties the account mid-payment | Transfer fails | Transaction fails on-chain → release on expiry; UI shows allowance 0 → reserve denied at source (allowance checked before signing) | I (Phase 9) |
| X8 | Token account closed by the owner | Signing for a missing account | Pre-sign account check; connection marked `broken` | I (Phase 9) |
| X9 | Mint uses Token-2022 extensions (transfer fee, hooks) | Received amount < paid; unexpected CPI | Only allow the configured USDC/USDT mints (classic SPL Token) in v1 | U (Phase 9) |
| X10 | Facilitator rejects delegate-signed transfers | Rail doesn't work | **VERIFY** on devnet with PayAI/Dexter first thing in Phase 9; fallback: agent-owned token account with an Aperture-held key (custodial float, needs the legal answer) | L (Phase 9) |
| X11 | Signer compromised | Funds stolen | Blast radius = remaining allowance per agent account; signer isolated, separate KEK, signs only matching holds; owner can revoke on-chain | Review + I (Phase 9) |
| X12 | RPC provider down or returning stale data | Settlement not detected | Two RPC providers with failover; watcher tolerant to gaps (uses signatures cursor) | I (Phase 9) |
| X13 | Stablecoin depeg | USD budget ≠ real value | Pause crypto rail beyond threshold | U (Phase 9) |
| X14 | Priority fee / compute limits exceed facilitator caps | Facilitator rejects | Use Path 1 compliant values; configurable | U against a local port of the Path 1 verifier (Phase 9) |

## Approvals and roles

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| A1 | Requester approves their own request | Separation of duties broken | Approver ≠ requester and ≠ the agent's owner; checked server-side | I (Phase 7) |
| A2 | Approved, but the budget was spent by others before retry | Approval can't be honoured | Approval grants authority, not money: retry still reserves; UI explains | E (Phase 7) |
| A3 | Approval used for a different, bigger request | Scope abuse | One-shot mandate bound to the request fingerprint and amount cap | U (Phase 7) |
| A4 | Slack button clicked by someone not in Aperture | Unauthorized approval | Slack user mapped to an Aperture member with the right role; unsigned requests rejected | I (Phase 7) |
| A5 | Last owner leaves / is removed | Org locked | Can't remove the last owner; ownership transfer flow | I (Phase 3) |
| A6 | Member offboarded who owns agents | Orphaned agents keep spending | Offboarding pauses their agents and reassigns ownership prompts | E (Phase 3) |

## Platform and operations

| ID | Scenario | What could go wrong | Handling | Test |
|---|---|---|---|---|
| O1 | Database unavailable | Fail open | Fail closed (gateway 503, card timeout = decline, signer refuses); `open_capped` opt-in | I: kill Postgres container mid-test (Phase 10) |
| O2 | Deploy mid-request | Lost settlements | Graceful shutdown drains in-flight requests; settlement via outbox table processed by the worker | I (Phase 10) |
| O3 | Migration fails halfway | Broken schema | Migrations are transactional; run before the new version starts; rollback = previous image | L: staging drill (Phase 10) |
| O4 | Backup exists but can't be restored | Data loss | Monthly restore drill into a scratch database | L (Phase 10) |
| O5 | Audit row edited directly in SQL by an operator | Tampered history | DB role can't update; chain verification detects it; daily anchor | I (Phase 2) |
| O6 | KEK lost | All connection secrets unreadable | KEK backed up offline (two copies); rotation procedure documented | L (Phase 10) |
| O7 | Noisy tenant saturates the gateway | Other tenants slow | Per-org concurrency limits; per-key rate limits | L: k6 (Phase 10) |
| O8 | Dependency supply-chain attack (LiteLLM/axios-style) | Credential theft | pnpm `minimumReleaseAge`, no install scripts, pinned GitHub Actions by SHA, lockfile review, least-privilege CI tokens | CI (Phase 1) |
