# Your checklist: everything only you can do

Phases 0–10 are built and tested on fakes. This is what's left, in order. Each item says what it unblocks. Nothing here needs code from me first.

Generate every secret with `openssl rand -base64 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Never reuse one across staging and production.

---

## A. Right now (keeps staging working after you push Phases 9–10)

1. **Push the new commits:**
   ```powershell
   git push origin main phase-9/x402-solana phase-10/production
   ```
   Render redeploys and applies migrations 0012–0015 at startup.
2. **Render (API service) → Environment.** Add:
   | Variable | Value |
   | --- | --- |
   | `ENFORCE_TWO_FACTOR` | `true`. You'll need to turn on 2FA (Account → Security) before you can change anything. Use `false` to postpone. |
   | `METRICS_TOKEN` | a fresh secret (only needed once you set up Grafana) |
3. **You (owner):** sign in → click **Security** in the sidebar → set up two-factor with an authenticator app. **Store the backup codes.**

## B. Crypto on devnet (Phase 9), all free

4. **Phantom wallet** (phantom.com), switched to **devnet** (Settings → Developer settings → Testnet mode):
   - account "Treasury (test)": get devnet SOL from faucet.solana.com, and devnet USDC from **faucet.circle.com** (choose Solana devnet);
   - account "Notary (test)": a little devnet SOL. Export its private key as the 64-number array.
5. **Helius** (helius.dev), free plan: create a devnet API key. Optionally a second provider (QuickNode or Triton) as a backup.
6. **Run the go/no-go spike** (spends about 0.02 test USDC):
   ```powershell
   $env:SPIKE_TREASURY_SECRET='[…64 numbers from Phantom export…]'
   $env:FACILITATOR_URL='https://facilitator.payai.network'
   pnpm --filter @aperture/cli x402-spike -- --rpc https://devnet.helius-rpc.com/?api-key=<key>
   ```
   Tell me the result: OUTCOME A or B.
7. **Render (API) → Environment:**
   | Variable | Value |
   | --- | --- |
   | `EMBED_SIGNER` | `true` (staging only) |
   | `SIGNER_KEK_V1` | a fresh 32-byte secret |
   | `SIGNER_RPC_DEVNET` | `https://devnet.helius-rpc.com/?api-key=<key>` |
   | `NOTARY_SECRET_KEY` | the Notary wallet's 64-number array (only if you want audit anchoring) |
8. **Dashboard → Crypto:** connect **devnet**, paste the Treasury address, and add the Helius URL → create a budget account for an agent → sign it in Phantom.
9. (Optional) Email PayAI and Dexter: "Do you accept an SPL `TransferChecked` signed by the token account's delegate rather than its owner, for x402 exact on Solana?" The spike answers this too.

## C. Things from earlier phases still open

10. **Render:** `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` (copy from `.env`), and `API_PUBLIC_URL=https://aperture-fz76.onrender.com`.
11. **Vercel:** `MEDIA_ORIGIN=https://fkvoweryeifabfebzsos.storage.supabase.co`, then redeploy.
12. **Slack app** (api.slack.com/apps, optional):
    - Create an app. Redirect URL: `https://<web>/api/slack/oauth/callback`. Interactivity URL: `https://<web>/api/slack/interactions`. Bot scopes: `chat:write users:read users:read.email incoming-webhook`.
    - Put `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` on Render.
    - Then Settings → Alerts → Install.
13. **Security clean-up:**
    - rotate the Supabase keys and revoke the Supabase access token;
    - revoke the old OpenRouter key;
    - check the old exposed wallets for funds;
    - GitHub → Settings → Branches → protect `main` (require a PR and green CI);
    - consider rotating the Gemini key.
14. **More providers** (only what you'll use): an Anthropic Admin key (organization account), an OpenAI Admin key (org owner), a Google Cloud service account (Billing Account Viewer + API Keys Admin) with a billing budget and Pub/Sub, a Hugging Face org token.

## D. Cards (Phase 8): decision D5

15. Try **Stripe → Issuing** in test mode (dashboard.stripe.com/issuing). If your UAE account can't enable it:
    - (a) use a design partner's US or EU Stripe account;
    - (b) set up a US entity with Stripe Atlas;
    - (c) or ask NymCard.

    Then:
    - create a restricted key (Issuing: cards, cardholders, authorizations and transactions write; Disputes write);
    - Dashboard → Cards → connect, and put the two URLs into Stripe, with the **timeout set to decline**;
    - run `pnpm try:card …`, which drives Stripe's test helpers.

## E. Going to production (Phase 10)

16. **Decisions** (from `plan/phases/phase-00-requirements`):
    - **D1:** the legal entity (a UAE free-zone company).
    - **D2:** the domain name. Then move DNS to **Cloudflare** (free).
    - **D3:** the server. Hetzner CX32 (4 vCPU, 8 GB) is about €8 a month; for residency, AWS `me-central-1`.
17. **Accounts** (all have free tiers):
    - **Resend:** verify the domain (unblocks email to anyone but you).
    - **Backblaze B2** (or Cloudflare R2): a bucket and key for backups.
    - **Grafana Cloud:** a stack. Install Grafana Alloy on the server and scrape `/metrics` with `METRICS_TOKEN`.
    - **Better Stack:** uptime checks on `/readyz` for the API and gateway, a status page at `status.<domain>`, and a phone push.
    - **GitHub:** create the `production` environment with yourself as required reviewer. Secrets: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`. Variables: `PROD_API_URL`, `PROD_GATEWAY_URL`, `PROD_WEB_URL`.
18. **Server setup:**
    - a `deploy` user with an SSH key; no root login; key-only SSH;
    - fail2ban and unattended upgrades;
    - firewall allowing 80/443 from Cloudflare IPs only, and 22 from you;
    - Docker;
    - `git clone` to `/srv/aperture/repo`;
    - fill `/srv/aperture/.env` from `infra/prod.env.example` (encrypt the real one with sops);
    - store **`APERTURE_KEK_V1`, `SIGNER_KEK_V1` and `WALG_LIBSODIUM_KEY` offline** in your password manager (losing them loses data).
19. **First release:** `git tag v1.0.0 && git push origin v1.0.0` → approve in GitHub Actions → watch the smoke checks.
20. **Restore drill** on the server: `infra/scripts/restore-drill.sh /srv/aperture/.env`. It must print "ledger verified, audit chain verified".
21. **Billing** (Stripe for Aperture itself, which works for UAE businesses):
    - create products "Team" and "Business" with monthly prices;
    - a webhook to `https://api.<domain>/webhooks/stripe-billing` for `customer.subscription.*`;
    - set `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_TEAM` and `STRIPE_PRICE_BUSINESS`;
    - enable the Customer Portal in Stripe.
22. **Legal:** have a UAE lawyer review `docs/legal/*` (terms, privacy, DPA, sub-processors), fill in the brackets, and publish them.
23. **Legal opinion C1** (custody and delegate control) before `MAINNET_X402_ENABLED=true`.
24. **Pilot:** for the design partner's org, run `pnpm --filter @aperture/cli admin pilot <orgId> 90`. Onboard them, agree success criteria, and hold weekly check-ins.

## F. Later, when revenue allows

- An external penetration test; start SOC 2 evidence collection.
- A docs site at `docs.<domain>` (the content is in `docs/guides`).
- A Microsoft Teams adapter if the partner uses Teams; SSO and SAML; an Arabic UI.
