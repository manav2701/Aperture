# 0002 — Integer micro-USD ledger with holds

- Status: Accepted (2026-09-24)

## Context

Budgets must apply across rails with different units (tokens, card cents, USDC atomic units) and different timing (streaming responses, card captures days later, blockchain settlement). Floating-point money and read-then-write checks cause drift and overspend under concurrency.

## Decision

One journal (`ledger_entries`) in integer micro-USD (`bigint`; 1 µUSD = 1 USDC/USDT atomic unit). Every rail uses authorize → capture: `reserve` a hold before the action, `settle` the actual amount after, `release` on failure. Budget counters are updated in the same Postgres transaction under row locks taken in ascending budget-id order, and every ancestor budget is checked.

## Consequences

- The invariant "hard budgets are never exceeded by approved holds" is testable, and is property-tested with real concurrency in Phase 2.
- Spend that can't be pre-authorized (card force captures, observed provider usage) is recorded as unheld and raises an alert.
- Contention on a single hot budget is bounded by row-lock throughput; revisit (for example Redis counters) only with measurements.
