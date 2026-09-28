# Rotate a key-encryption key

Rotate yearly, or at once on any suspicion of exposure.

## Platform KEK (`APERTURE_KEK_V<n>`)

It protects connection secrets, gateway credentials and org mandate-signing keys.

1. Generate: `openssl rand -base64 32`. Add it as `APERTURE_KEK_V2` (the next number) in the production env. **Keep V1**, because old envelopes still need it.
2. Deploy. New secrets are sealed with V2, and existing ones still open with V1.
3. Re-wrap everything under V2:
   ```bash
   DATABASE_URL=<owner url> APERTURE_KEK_V1=… APERTURE_KEK_V2=… pnpm --filter @aperture/cli admin rotate-kek
   ```
4. Run `verify-db`, then smoke. Check that Connections show no "broken" status.
5. After a week without errors, remove V1 from the env and deploy. Destroy the offline copy of V1 last.

## Signer KEK (`SIGNER_KEK_V<n>`)

It protects the x402 delegate keys. It lives in the signer container's environment only.

Same steps, with `SIGNER_KEK_V2` and `pnpm --filter @aperture/cli admin rotate-signer-kek`. The command needs both signer keys in its environment. Run it on the server, never on a laptop.

## Pepper (`APERTURE_KEY_PEPPER`)

Rotating it invalidates every Aperture key. Only do it after a compromise, together with a key re-issue. See [incident-revoke-org.md](incident-revoke-org.md).
