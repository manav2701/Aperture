# @aperture/jobs

Background jobs, run by `apps/worker`, or by the API itself with `RUN_WORKER=true`. Each job holds a Postgres advisory lock while it runs, so any number of processes can schedule them without running one twice.

| Job               | Every | Does                                                                                                                                                    |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connector.sync`  | 1 min | Keys → `credentials`; usage → `observed` ledger entries (late revisions become adjustments); OpenRouter limit mirroring; T2 revoke with audit and alert |
| `alerts.scan`     | 1 min | Queues threshold alerts (default 80% and 100%), once per budget, threshold and period                                                                   |
| `alerts.dispatch` | 30 s  | Emails owners, admins and finance; posts to Slack when a webhook is connected                                                                           |
| `holds.expire`    | 30 s  | Settles, releases or reconciles expired holds (covers a crashed gateway)                                                                                |
| `prices.sync`     | daily | Refreshes the price catalog from OpenRouter                                                                                                             |
| `ledger.verify`   | daily | Budget counters must equal the journal; drift is an alert                                                                                               |

Tests run on real Postgres with scripted providers: `pnpm --filter @aperture/jobs test`.
