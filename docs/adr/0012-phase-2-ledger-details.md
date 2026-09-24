# 0012 — Phase 2 ledger and time decisions

- Status: Accepted (2026-09-24)

## Context

Implementing the core domain (money, periods, policy engine, ledger, audit chain) required decisions that the architecture left open, and the contention benchmark produced a number the plan had guessed wrong.

## Decisions

1. **Time zones via `temporal-polyfill`** (TC39 Temporal, spec-compliant). Node doesn't ship Temporal yet; hand-written offset math is how DST bugs happen. Swap for the built-in once Node ships it.
2. **Hour windows are UTC; day, ISO week, and month follow the org's timezone.** A local "hour" lasts two hours when clocks go back, which would silently double a velocity limit.
3. **All time decisions use the database clock** (`now()` truncated to milliseconds), never the app server's clock. Millisecond precision makes stored timestamps round-trip exactly, which the audit hash depends on.
4. **Spend stays in the period it was reserved in.** A hold records its budget ids and period keys; settlement always charges those, even after midnight (edge case L7).
5. **Refunds credit the current period** of each budget the original charge touched. Reopening a closed period would rewrite history; within the same period this is identical to crediting the original one. Counts (velocity) are not refunded. A period's `spent` may go below zero after refunds.
6. **Fail closed at the ledger too.** A principal with no applicable budget, or a paused/revoked principal, can't reserve.
7. **One ledger operation per transaction.** Every operation locks `budget_usage` rows in ascending `(budget_id, period_key)` order; composing several operations in one outer transaction could break that ordering. Hold expiry therefore processes one hold per transaction.
8. **Policies are evaluated in their stored form** (amounts as decimal strings). The engine validates and parses documents itself; passing a pre-parsed document is treated as invalid and denied. The simulator hit exactly this bug, and fail-closed turned it into denials instead of wrong approvals.
9. **Append-only is enforced by triggers**, which bind every role including the table owner, plus an `aperture_app` role with INSERT/SELECT only on `ledger_entries` and `audit_events` and no DELETE anywhere.
10. **The audit hash covers `seq`** (inside the body), and a chain that starts at genesis must start at seq 1. The property tests found that renumbering the first record was otherwise undetectable.

## Throughput finding

Measured on Docker Desktop (Windows): 200 concurrent reserves against one budget complete in ~1.35 s, **~6.7 ms per reserve serialized (~150/s on one hot budget)**; exactly 50 of 200 were approved for a limit that fits 50. Because every spend in an org also locks the org's root budget row, this is an **org-wide spend-rate ceiling**. The plan's original target (reserve p99 < 15 ms under 200-way contention) ignored queueing and has been replaced by a lock-hold-time target.

## Consequences

- Phase 5 (gateway) must reduce the time the root row is locked: collapse the post-lock work (insert hold, insert journal entry, update counters) into one SQL statement or function, then re-measure on production-like hardware. If that isn't enough, split hot org budgets into sharded sub-counters, or move hot counters to Redis with Postgres as the journal. INV-1 must be re-proven for any such change.
- The nightly workflow runs the ledger properties with 300 scenarios and 150 deadlock-hunt rounds.
