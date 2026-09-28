# Incident: stop all spending for an org, now

Use this when an org's keys, an agent, or a connected provider account may be compromised.

1. **Dashboard → Agents → "Pause all agents".** Every gateway call from those agents is refused from the next request (cache invalidation is by NOTIFY, about a second).
2. **Revoke the Aperture keys**, from Agents & keys, or in bulk:
   ```sql
   update api_keys set revoked_at = now() where org_id = '<org>' and revoked_at is null;
   ```
3. **Cards:** freeze every card from Cards, or in Stripe (Issuing → Cards → bulk). Stripe decisions still come to Aperture, and frozen cards are declined.
4. **x402:**
   - Crypto → each budget account → **Revoke and sweep**, signed in the treasury wallet. This is the on-chain stop; until it's signed, Aperture refuses to sign anyway once the account shows revoked.
   - If the signer itself may be compromised, stop it: `docker compose stop signer`. That refuses every x402 payment.
5. **Provider credentials:** Connections → each provider → rotate the admin key at the provider, then reconnect.
6. **Mandates:** Agents → Mandates → revoke the root mandates. This cascades to all sub-agents.
7. Export the audit log for the window (Audit → Export) and verify it offline with `pnpm audit-verify`.
8. Write the incident up: timeline, blast radius (Spend → filter by agent), and the fixes made.
