# Phase 4 — Provider connectors: visibility and control without a gateway

**Goal:** an organization connects its existing AI provider accounts and immediately sees who spends what — and Aperture enforces budgets through each provider's own controls (limit mirroring or detect-and-revoke), even for teams that never touch the gateway.
**Duration:** ~2.5 weeks.
**Depends on:** Phase 3; Phase 0 provider accounts and admin keys.

## Starting point

Orgs, members, budgets, policies, audit, encrypted `connections` table, staging.

## Scope

**In:** connector framework; OpenRouter, OpenAI, Anthropic, Google (Gemini) connectors; Hugging Face (visibility, best effort); price catalog sync; worker jobs (`connector.sync`, `limits.mirror`, `ledger.verify`, `prices.sync`, `alerts.dispatch`); unassigned-key flow; alerts by email and Slack incoming webhook; Connections page; Spend explorer; real Overview.
**Out:** gateway (Phase 5); Slack interactive approvals (Phase 7).

## Tasks

### 4.1 Connector framework (`packages/connectors/src/framework`)
- `Connector` interface from [architecture §13 Rail 2](../../architecture/README.md#rail-2--provider-connectors-usage-outside-the-gateway) with declared `capabilities`.
- Shared HTTP client: timeouts, retries with jitter for 429/5xx honoring `Retry-After`, per-connection rate limiter, redacted request logging.
- `UsageRecord { externalKeyId, bucketStart, bucketEnd, model, inputTokens, outputTokens, cachedTokens, costMicros?, raw }` → converted to `ledger_entries(kind='observed')` with idempotency key `provider:bucketStart:keyId:model` (C3). Re-import the trailing 2 hours each run and store deltas as `adjustment` (C4).
- Connection fingerprint (provider org id) unique per Aperture org (C9); health check each run (C5).

### 4.2 OpenRouter connector
- Connect with a management key; `test()` lists keys.
- `createCredential(principal)` → `POST /api/v1/keys` with `name = aperture:<principal>`, `limit` = current usage + remaining (initially remaining), `limit_reset: null`, optional `expires_at`; store `hash` + prefix; show the key once.
- `setLimit` (mirroring): `limit = key.usage + remaining(budget path)` (C6); debounced 5 s after ledger changes.
- `revoke` → disable/delete key.
- `syncUsage` → per-key usage deltas (`usage_daily`) → observed entries. (Gateway traffic is added in Phase 5 through the gateway itself; keys used by the gateway are `managed_by_gateway` and skipped — G11.)

### 4.3 OpenAI connector
- Connect with an Admin key; `test()` lists projects.
- Setup assistant: create a project per team (optional) and a **service account per principal** (the API returns the key; show once).
- `syncUsage` → usage API 1-minute buckets grouped by `api_key_id` and `model` × catalog prices; daily costs API reconciliation creates `adjustment` entries for the difference.
- `revoke` → delete the service account's key (or the service account).
- Optional throttle: set per-model rate limits on the team's project.
- Setup checklist item "project budget set in OpenAI dashboard" with a confirm button (C8).

### 4.4 Anthropic connector
- Connect with an Admin key; `test()` lists workspaces.
- **Keys can't be created via API**: import existing keys (list API keys), UI to map each key → principal; instructions + deep link to create new keys in the Console.
- `syncUsage` → `/v1/organizations/usage_report/messages` with `bucket_width=1m`, `group_by[]=api_key_id`, `group_by[]=model` × catalog prices; daily `/cost_report` reconciliation.
- `revoke` → set key status `inactive`.
- Setup checklist item "workspace spend limit set in Console".

### 4.5 Google (Gemini) connector
- Connect with a service-account JSON (Billing Account Viewer, API Keys Admin) + project id.
- Aperture creates (or the customer creates) a **budget with Pub/Sub notifications**; a push subscription to `/webhooks/google/{connectionId}` (verify the push token / OIDC JWT).
- On notifications ≥ 100% for a budget mapped to a principal/team → delete or restrict the mapped API keys via the API Keys API (T2); otherwise visibility (T3).
- Show the tier clearly and recommend routing Gemini via the gateway.

### 4.6 Hugging Face (best effort)
- Connect with an org token; **VERIFY** whether a usage/billing API exists for Inference Providers. If yes → observed entries; if not → CSV import of the billing export + recommendation to route through the gateway (HF router is OpenAI-compatible).

### 4.7 Price catalog
- `prices.sync` daily: OpenRouter `GET /api/v1/models` (pricing per model) + a curated JSON for direct providers (OpenAI, Anthropic, Google) kept in `packages/connectors/prices/*.json` with `effectiveFrom` and source URLs; PR-reviewed when prices change.

### 4.8 Budgets on observed spend
- After each import, re-evaluate hard budgets for affected principals; if over → connector `revoke` for that principal's credentials on that provider + alert + audit (C1).
- Soft thresholds (50/80/100%) → alerts.

### 4.9 Alerts
- Email to budget owners/finance; Slack **incoming webhook** per org (simple; interactive app is Phase 7).
- De-duplicate alerts per budget/threshold/period.

### 4.10 UI
- **Connections**: provider cards with capability badges and tier, connect wizards with exact steps and links, test button, last sync + lag, broken banner.
- **Spend explorer** and real **Overview** (from ledger entries).
- **Unassigned** keys list with one-click assignment (C7).

## Edge cases covered

C1–C9, G11 (partial), L8 via nightly `ledger.verify`.

## Tests

- **Unit:** each connector's response parsers against recorded fixtures (redacted real responses captured during development); OpenRouter limit calculation (C6); idempotency keys.
- **Property:** INV-14 — replay fixture windows with random overlaps and duplicates → identical ledger.
- **Fuzz:** parsers with mutated fixtures (missing fields, wrong types, huge numbers) → typed errors, no crashes, no negative spend (L16).
- **Integration:** a fake provider server per connector (Hono) simulating rate limits, late buckets, revoked admin keys; revoke flow end to end in the worker.
- **Contract (weekly, live):** run `test()` + one `syncUsage` against the real sandbox accounts from Phase 0; alert if schemas changed.
- **E2E:** connect a fake provider → spend appears → assign unassigned key → exceed hard budget → credential revoked → alert email captured in Mailpit.

## Security checklist

- [ ] Admin keys encrypted at rest, never returned by the API, never logged (redaction test)
- [ ] Webhook for Google verified (push auth) and idempotent
- [ ] Revoke actions audited with actor = `system:connector-sync`
- [ ] Connector HTTP client only calls the provider's documented base URLs (no user-supplied URLs)

## Deployment

Worker service added to staging compose. Configure alerts for connector lag > 10 minutes.

## Try it yourself

1. Staging → Connections → **OpenRouter** → paste your management key → Test → Create a key for yourself with a USD 1 budget (daily, hard).
2. Use that key directly with OpenRouter (not through Aperture):
   ```bash
   curl https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer <key>" \
     -H "Content-Type: application/json" \
     -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
   ```
   Within ~1 minute the spend appears in Aperture's Spend explorer under your name.
3. Loop requests until OpenRouter itself rejects the key — the limit was mirrored from your Aperture budget (T1).
4. Connect **Anthropic** with your Admin key → map your existing key to yourself → make a few calls with that key directly → spend appears within ~5–10 minutes; set your Aperture budget below current spend → the key is set **inactive** at Anthropic on the next sync (check the Console).
5. Connect **OpenAI** → let Aperture create a service account for you → use its key → watch spend → exceed → key deleted.
6. Create a key in a provider console without mapping it → it appears under **Unassigned** → assign it.

## Exit criteria

- [ ] All four main connectors pass their live contract test against your accounts
- [ ] Hard-budget breach revokes credentials on OpenAI and Anthropic and blocks on OpenRouter
- [ ] Overview and Spend explorer show only real data
- [ ] Connector lag alert fires when the worker is stopped for 10 minutes

## Risks / open questions

- Provider API changes: the weekly contract test is the early warning.
- Usage → cost for direct providers relies on our catalog; daily cost-report reconciliation corrects drift.
