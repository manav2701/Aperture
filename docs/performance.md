# Performance

Budgets (plan/architecture §20):

- gateway overhead p99 < 30 ms;
- card decision p99 < 400 ms (K1);
- 500 rps through the gateway;
- 200 concurrent reserves on one budget without deadlock.

## Baseline (2026-09-29, development laptop)

Setup: Windows 11, Postgres 18 in Docker Desktop (Testcontainers), Node 25. One database round trip took **1.0–1.2 ms** on this machine. The benchmark is `apps/gateway/test/load.perf.test.ts`, whose upstream is an instant fake, so everything measured is Aperture's own work:

```bash
PERF=1 PERF_CONCURRENCY=1 PERF_SECONDS=8 pnpm --filter @aperture/gateway exec vitest run test/load.perf.test.ts
```

| Concurrency                | Requests/s | p50    | p95     | p99     | Round trips per request (p50 ÷ RTT) |
| -------------------------- | ---------- | ------ | ------- | ------- | ----------------------------------- |
| 1                          | 12         | 80 ms  | 94 ms   | 257 ms  | ~76                                 |
| 4 (one agent, one budget)  | 37         | 104 ms | 138 ms  | 319 ms  | —                                   |
| 32 (one agent, one budget) | 38         | 817 ms | 1440 ms | 1555 ms | — (queueing on the budget rows)     |

A stage trace (removed after use) showed where the time goes:

| Stage                                                                                                           | p50    |
| --------------------------------------------------------------------------------------------------------------- | ------ |
| Admit (key check, limiter, parse)                                                                               | 5 ms   |
| Connected providers, key, price, policy context, mandate, decision (all cached)                                 | < 1 ms |
| Reserve (one transaction, about 20 statements: idempotency lock, reads, lock and update per budget on the path) | 27 ms  |
| Settle, request log and headroom                                                                                | 26 ms  |

What this means:

- **The cost is round trips, not CPU.** On a production server with Postgres on the same host (about 0.1 ms per round trip), the same 70–80 statements come to roughly 7–10 ms per request. That is inside the 30 ms budget, but it must be measured there.
- **One agent on one budget serializes** at about 40 requests/s locally, because every request locks the same budget-usage rows. That is correct (no overspend), and it's the known "hot budget" limit. Many agents on different budgets scale independently.
- Phase 10 added caches for the standing mandate and model prices (invalidated by the existing NOTIFY triggers). They cut about 20 ms per request locally.

## To measure on production hardware (deferred until the server exists)

1. The same benchmark on the production box, against its own Postgres.
2. `tools/load/gateway-estimate.js`: k6 at 200–500 rps against `/v1/estimate` (decision path, no upstream spend).
3. `tools/load/card-auth.js`: k6 at 50 rps of signed authorization webhooks, target p99 < 400 ms (K1).
4. The ledger deadlock hunt, already nightly: `DEADLOCK_ROUNDS=150 pnpm --filter @aperture/db test`.

## Next optimizations (if production misses the budget)

- Fold `lockUsage` and `applyUsage` into one statement per reserve and settle, using CTEs over the whole budget path. That removes about 10 round trips each.
- Write the request log asynchronously, batched outside the request.
- Sharded counters for hot budgets (the Phase 5.2b plan).
