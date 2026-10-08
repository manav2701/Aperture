# Rotate the platform attestation key

The platform attestation key signs governance attestations and agent cards (ADR 0020). Rotate it yearly, or at once if the KEK or the database may have been exposed.

Retired keys stay published in `/.well-known/aperture/jwks.json`, so attestations signed before the rotation keep verifying, online and with `pnpm attestation-verify`.

1. **Rotate:**
   ```bash
   DATABASE_URL=<owner url> APERTURE_KEK_V<n>=… pnpm --filter @aperture/cli admin rotate-attestation-key
   ```
   The command retires the active key and creates a new one, sealed under the newest KEK. It prints the new key id.
2. **Check the JWKS** lists both keys:
   ```bash
   curl -s https://api.<domain>/.well-known/aperture/jwks.json | jq '.keys[].kid'
   ```
   Cloudflare caches it for 5 minutes.
3. **Issue a test attestation** in a test org (Attestations → New), download it, and verify it on `/verify` and with:
   ```bash
   pnpm attestation-verify att.json --jwks https://api.<domain>/.well-known/aperture/jwks.json
   ```
   Verify one attestation from **before** the rotation the same way.
4. **After a suspected compromise**, also:
   - rotate the KEK ([rotate-kek.md](rotate-kek.md));
   - tell customers which key id was exposed and when, so their auditors can treat attestations signed with it after that time as untrusted.

   Never delete a retired key's row. That would break every attestation it signed.

## Notes

- Staging and production have separate keys. Never copy the `platform_signing_keys` table between environments.
- `admin rotate-kek` re-wraps these keys along with the other secrets, so the old KEK can be removed afterwards.
- A self-hosted install has its own instance key in the same table. Its attestations say "self-hosted" and name the instance.
