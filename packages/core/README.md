# @aperture/core

Pure domain logic: no I/O, no database, no clock of its own. Everything here is deterministic, so it is covered by unit, property-based, and fuzz tests (82 tests).

| Module    | What it does                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `money`   | `Micros` (branded `bigint`, 1 µUSD = 1 USDC atomic unit); strict `parseUsd` / exact `formatUsd`; cents and stablecoin conversions that never under-count. Range limited to Postgres `bigint`.                          |
| `period`  | `periodKey(instant, period, timezone)` and `periodBounds(key, …)`. Day, ISO week, and month in the org's IANA timezone; hour windows in UTC (ADR 0012).                                                                |
| `pricing` | Text, image, and video cost estimates and actuals in µUSD; prices per million tokens; always rounds up; minimum charge 1 µUSD.                                                                                         |
| `policy`  | Zod-validated policy documents (15 rule types) and `evaluatePolicy()`: every layer must allow, deny beats approval, obligations merge to the strictest value. Pure and total — invalid input or policy means **deny**. |
| `mandate` | Mandate scopes, `isWithin(child, parent)` (delegation can only narrow authority), and `mandateToPolicyDocument()`.                                                                                                     |

## Invariants proven by property tests

- INV-5 money round-trips; INV-6 periods partition time (DST, 30/45-minute offsets, Samoa's skipped day)
- INV-7 adding a rule never makes a decision more permissive; INV-8 every prefix of the layer chain is at least as permissive
- INV-9 a child mandate accepted by `isWithin` never allows what its parent denies
- INV-10 arbitrary input never throws and never allows

```bash
pnpm --filter @aperture/core test
```
