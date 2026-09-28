# Delete an organization

1. The owner requests deletion under Settings → Privacy (typing the org's name). They can cancel for 30 days.
2. After 30 days the `privacy.deletions` job does the following:
   - revokes every key;
   - revokes the agents;
   - disables the connections;
   - marks the org `scheduled`;
   - emails the org's owners, admins and finance.
3. **An Aperture operator finishes the deletion by hand**, because it is irreversible:
   1. Export the org first and keep it for the contractual period: `GET /api/v1/orgs/{id}/export` plus the audit export.
   2. Delete generated media from the bucket: prefix `org/<orgId>/`.
   3. Delete rows in dependency order: gateway requests, media jobs, card and x402 records, approvals, mandates, credentials, connections, keys, policies, budgets, members, principals, teams, `org_settings`, `org_billing`.
   4. **Keep `ledger_entries` and `audit_events`** for the retention period in the contract. They are append-only by design (legal hold).
   5. Cancel any Stripe subscription (Customer Portal or the Stripe dashboard).
   6. Record the completion in the internal log.

Automating step 3 is deferred until the DPA and contract terms fix the retention periods.
