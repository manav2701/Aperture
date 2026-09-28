# Alerts: what each one means and what to do

## budgets

`budget_threshold`: a budget crossed one of its thresholds (default 80% and 100%). At 100% of a hard budget, new spending under it is refused.

- **Check:** Spend, filtered by the budget, shows who is spending.
- **Fix:** raise the limit (Budgets), or pause the agent.

## connectors

- `connection_broken`: Aperture can't reach a provider with the stored admin key (revoked, expired, or the permissions changed). Spend there isn't imported or enforced until it's fixed. Reconnect it from Connections.
- `credential_revoked`: Aperture revoked a provider key because its budget was used up (T2 providers). This is expected. Raise the budget and issue a new key if the work should continue.
- `unpriced_model`: usage of a model with no price. It isn't counted against budgets. Add a price (`prices` table), or wait for `prices.sync`.

### media_stuck

A video job has been running for an unusually long time. Its hold stays until the provider finishes, or until Aperture gives up after 24 h and charges the reservation (G12). Check the provider's status page.

## ledger-drift

`ledger_drift`: `verifyCounters` found a budget whose running counters don't match the ledger entries. This should never happen, so treat it as an incident.

1. Run `pnpm --filter @aperture/cli verify-db` to find the org and budget.
2. Don't edit the counters by hand. Find the entries around the drift (`ledger_entries`, ordered by `occurred_at`) and open an issue with them.

## approvals

`approval_requested`: an agent's request is waiting for a person. Decide it on the Approvals page, or in Slack if the app is installed. Undecided requests are denied after 24 h.

## cards

- `card_unknown`: Stripe asked about a card Aperture didn't issue. It was declined. Check for cards created outside Aperture in Stripe.
- `card_unseen_authorization`: Stripe approved without asking Aperture (`webhook_timeout` or `webhook_error`). The captures still count as spend. If it repeats, check that the authorization endpoint is up and that the timeout behaviour is set to **decline**.
- `card_decisions_timing_out`: the nightly reconciliation counted Stripe-decided authorizations. Check the p99 decision latency. If it's above 400 ms, move the webhook routes closer to Stripe (US region).
- `card_unheld_capture`: a force capture, meaning money moved without any authorization. Single-use cards are frozen automatically. Consider a dispute in Stripe.

## x402

- `x402_unknown_transfer`: money left an agent's budget account without a matching Aperture payment. Either the delegate key is being used elsewhere, or a payment's memo was lost. **Revoke the allowance in the treasury wallet now** (Crypto → Revoke and sweep), then investigate the transaction on the explorer.
- `x402_allowance_revoked`: the treasury revoked the delegate or closed the account. Aperture stopped signing for it. Expected if it was deliberate.

## org-deletion

`org_deletion_scheduled`: see [org-deletion.md](org-deletion.md).
