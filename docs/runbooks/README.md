# Runbooks

Each page covers one alert or procedure: what it means, how to check it, and how to fix it. Every alert is emailed to owners, admins and finance, and posted to Slack if that is connected.

## Alerts

| Alert (`alert_log.kind`)                                                                        | Page                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `budget_threshold`                                                                              | [alerts.md#budgets](alerts.md#budgets)           |
| `credential_revoked`, `connection_broken`, `unpriced_model`, `media_stuck`                      | [alerts.md#connectors](alerts.md#connectors)     |
| `ledger_drift`                                                                                  | [alerts.md#ledger-drift](alerts.md#ledger-drift) |
| `approval_requested`                                                                            | [alerts.md#approvals](alerts.md#approvals)       |
| `card_unknown`, `card_unseen_authorization`, `card_unheld_capture`, `card_decisions_timing_out` | [alerts.md#cards](alerts.md#cards)               |
| `x402_unknown_transfer`, `x402_allowance_revoked`                                               | [alerts.md#x402](alerts.md#x402)                 |
| `org_deletion_scheduled`                                                                        | [org-deletion.md](org-deletion.md)               |

## Procedures

- [Deploy and roll back](deploy.md)
- [Restore from backup, and the monthly drill](restore.md)
- [Rotate a KEK](rotate-kek.md)
- [Rotate the platform attestation key](rotate-attestation-key.md)
- [Incident: revoke everything for an org](incident-revoke-org.md)
- [Delete an organization](org-deletion.md)
- [Give an org a pilot](pilot.md)

## Dashboards and alerts to set up (Grafana Cloud)

Scrape `GET /metrics` on api, gateway, worker and signer, with `Authorization: Bearer $METRICS_TOKEN`, using Grafana Alloy on the server. Alert on:

| Signal                  | Query sketch                                                                                                  | Threshold                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| API or gateway 5xx rate | `sum(rate(aperture_http_requests_total{status=~"5.."}[5m])) / sum(rate(aperture_http_requests_total[5m]))`    | > 2% for 10 min                              |
| Gateway overhead p99    | `histogram_quantile(0.99, sum by (le) (rate(aperture_http_request_duration_ms_bucket{route=~"/v1/.*"}[5m])))` | > 30 ms added (compare to the upstream time) |
| Card decision p99       | `histogram_quantile(0.99, sum by (le) (rate(aperture_card_decision_ms_bucket[5m])))`                          | > 400 ms                                     |
| Card decline codes      | `sum by (code) (rate(aperture_card_decisions_total{approved="false"}[15m]))`                                  | spike in `error`                             |
| Signer refusals         | `sum by (code) (rate(aperture_signer_refusals_total[15m]))`                                                   | any `self_check_failed` or `key_mismatch`    |
| Readiness               | Better Stack uptime on `/readyz` for api and gateway                                                          | down for 2 min → phone push                  |
