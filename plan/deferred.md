# Deferred work

Everything we've decided to do later, and what unblocks each item. For now, Phases 4–5 are built for all providers, but they're only exercised live with what is already in `.env`: the OpenRouter management key, the Gemini API key, Resend, Google OAuth and Neon.

## Live spend budget (testing)

Hard rule: **at most USD 1 in total per provider key**, including all testing. Prefer fake upstream servers; live checks use the cheapest models with tiny `max_tokens`. OpenRouter tests run through child keys that have their own hard limit.

| Key                         | Spent so far (USD) | Notes |
| --------------------------- | ------------------ | ----- |
| OpenRouter management key   | 0.00002            | Phase 4–5 live test, 2026-09-25 (gpt-4o-mini, 16-token replies); all test keys deleted |
| Gemini API key              | 0.00001            | Phase 5 live test, 2026-09-25 (gemini-3.5-flash-lite) |

## Accounts and keys still to add

| Item | Unblocks | Where it plugs in |
| --- | --- | --- |
| Anthropic **Admin key** (organization account) | Live contract test of the Anthropic connector (usage import, set key inactive on breach); `/anthropic/v1/messages` gateway route live | Connections → Anthropic |
| OpenAI **Admin key** (org owner) | Live OpenAI connector (service account per principal, usage import, key deletion on breach); OpenAI-direct gateway routing | Connections → OpenAI |
| Google Cloud **service-account JSON** (Billing Account Viewer, API Keys Admin) + billing budget with Pub/Sub push | Gemini connector T2 enforcement (delete keys at 100% of budget) and spend visibility | Connections → Google |
| Hugging Face org token | HF router through the gateway; HF visibility | Connections → Hugging Face |
| Slack incoming-webhook URL | Budget alerts to Slack (email alerts already work) | Settings → Alerts |
| **Domain** + Resend domain verification (decision D2) | Emails to anyone other than the Resend account owner (invitations, teammates' verification, alerts) | `EMAIL_FROM` on Render |

## Hosting

- **Always-on services.** Render's free tier has no background workers and sleeps after 15 idle minutes. For now the jobs run **inside the API process** (`RUN_WORKER=true`) and the gateway is served by the API under `/gw` (`EMBED_GATEWAY=true`), so everything sleeps together; syncs and alerts pause while it sleeps. Later: Render Starter (about $7/month per service) or one small VPS. Then run `apps/worker` and `apps/gateway` as their own services and turn both flags off on the API.
- Recreate the Render services in **Ohio (us-east-2)** next to Neon; the API currently runs in Oregon.
- Gateway on its own domain (`gw.<domain>`) once the domain exists.
- Monitoring and alerting: connector lag over 10 minutes, and gateway latency and error-rate panels.

## Engineering

- Gateway settlement reconciliation: when a stream ends without usage it settles at the reservation; reconcile against OpenRouter `/generation` and refund the difference.
- Google budget Pub/Sub push webhook (`/webhooks/google/{connectionId}`) that deletes mapped keys at 100% (needs the service account).
- OpenAI and Anthropic daily cost-report reconciliation (adjustments per principal).
- Gateway `open_capped` fail mode; `lastUsedAt` on gateway keys; prompt-body logging (`prompt_logging: full`, encrypted, with retention).
- Hugging Face pricing (the HF router has no price catalog, so HF models are denied as unpriced until prices are added).
- A thin `@aperture/sdk` (today: point the OpenAI or Anthropic SDK at the gateway base URL).

- Phase 5.2b hot-budget throughput target (≥ 500 reserves/s on one budget) on production-like hardware, plus the k6 load test (200 rps, gateway overhead p99 < 30 ms).
- Weekly live contract tests for connectors in GitHub Actions. Needs the provider keys as repository secrets, and each run spends a few cents.
- Playwright end-to-end tests and two-factor authentication (Phase 10).
- Policy rule builder UI (policies are edited as JSON today).

## Security follow-ups (from Phase 1)

- Rotate the Supabase keys; revoke the Supabase access token and remove it from `.env`.
- Revoke the old OpenRouter key from the hackathon era.
- Check the 10 exposed legacy wallets for mainnet funds.
- GitHub: branch protection on `main` and private vulnerability reporting.
