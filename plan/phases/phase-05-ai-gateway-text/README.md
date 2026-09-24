# Phase 5 — AI gateway (text) and workspace chat

**Goal:** a governed, OpenAI- and Anthropic-compatible gateway that enforces policy and budgets **before** each request (T0), settles exact cost after, and powers a chat workspace for non-developers. After this phase the product is pilot-ready.
**Duration:** ~3 weeks.
**Depends on:** Phases 2–4.

## Starting point

Ledger, policy, orgs/budgets UI, connectors with encrypted provider credentials, price catalog, staging.

## Scope

**In:** agents as principals; Aperture keys; gateway routes for chat/responses/embeddings (OpenAI-compatible, routed to OpenRouter or direct OpenAI), Anthropic Messages, Gemini generateContent, Hugging Face router; streaming passthrough; estimate → reserve → forward → settle; obligations (`max_tokens`, prompt logging); kill switch; cache invalidation; outbox for settlement; workspace chat; minimal SDK; `try` scripts; first load test.
**Out:** images/video (Phase 6), approvals UX (Phase 7 — the gateway already returns `aperture_approval_required`).

## Tasks

### 5.1 Agents and keys (`apps/api`)
- Agents CRUD (name, owner, team, budget, policy template); `principals.kind = 'agent'`; pause/resume/revoke.
- Aperture keys: `apk_live_…`/`apk_test_…` from `crypto.randomBytes(32)` base62; store HMAC-SHA-256(pepper) + 12-char prefix; show once; optional expiry and IP allowlist; revoke.
- Personal keys for members (bound to the member's principal).

### 5.2 Gateway core (`apps/gateway`)
- Middlewares: request id, body size limit (10 MB default), key auth (hash lookup), org/principal/mandate/policy load from an in-process cache invalidated via Postgres `LISTEN aperture_invalidate` (P7; max TTL 30 s), per-key concurrency and rate limits.
- Route handlers (passthrough, no translation):
  - `POST /v1/chat/completions`, `/v1/responses`, `/v1/embeddings` → OpenRouter (default) or OpenAI direct, chosen by model prefix and the org's connections.
  - `POST /anthropic/v1/messages` → Anthropic.
  - `POST /google/v1beta/models/{model}:generateContent` (+ `:streamGenerateContent`) → Gemini API.
  - `POST /hf/v1/chat/completions` → Hugging Face router.
- Decision pipeline: parse (Zod, per provider shape) → `evaluate()` → apply obligations (inject/cap `max_tokens` — G1) → estimate → `reserve` (idempotency = `Idempotency-Key` header if provided, else request id) → forward with the org's BYOK credential (`managed_by_gateway = true`) → stream through → parse final usage → settle.
- Streaming: tee the upstream SSE; forward bytes immediately; parse usage from the final event (OpenAI `usage` chunk, Anthropic `message_delta.usage`, Gemini `usageMetadata`, OpenRouter `usage.cost`).
- Settlement through an **outbox** table written in the reserve transaction's follow-up; the worker processes outbox rows if the gateway dies mid-stream (O2, G15).
- Failure handling: G3 (disconnect → abort upstream, settle hold, enqueue reconcile via OpenRouter `/generation`), G4, G5 (pass 429 through), G6 (unpriced model → deny).
- Response headers and error shapes per [architecture §13](../../architecture/README.md#rail-1--ai-gateway-text).
- Fail mode: `closed` → 503 when the DB is unavailable; `open_capped` → local per-key cap (default USD 5 per 10 min) with later reconciliation.
- Request log (metadata only by default): principal, model, tokens, cost, decision, latency; prompt/response bodies only if the org's `prompt_logging` = `full`, stored encrypted with retention.

### 5.2b Hot-budget throughput (from ADR 0012)
- Every spend in an org locks the org's root budget row, so the time that row stays locked caps the org-wide spend rate (≈150 reserves/s measured in Phase 2).
- Collapse the work done after locking (insert hold, insert journal entry, update counters) into one SQL statement or a Postgres function; keep the policy evaluation and path resolution before the lock.
- Re-run the Phase 2 contention benchmark and the INV-1…4 property suite; target ≥ 500 reserves/s on one budget on production-like hardware. If still short, shard hot budgets into sub-counters (and re-prove INV-1).

### 5.3 Kill switch
- `POST /principals/{id}/pause` and org-wide "pause all agents" → NOTIFY → gateway denies within ~2 s; also triggers connector revokes (Phase 4) for T1/T2 credentials.

### 5.4 Workspace chat (`apps/web/workspace`)
- Chat UI with streaming, model picker filtered by `/policies/simulate`-style allowed list, per-message cost, budget meter.
- Browser never sees a provider or Aperture key: the web server calls the gateway with a **short-lived internal token** (signed, 5-minute, bound to the member's principal) issued by `apps/api`.
- Denials render the reason and a "Request approval" button (wired in Phase 7).

### 5.5 SDK (minimal) and scripts
- `@aperture/sdk`: `createApertureClient({ apiKey, baseURL })` returning pre-configured OpenAI and Anthropic SDK clients pointed at the gateway; `getBudget()`.
- `tools/try/gateway.ts`, `exceed-budget.ts`, `kill-switch.ts`.

### 5.6 UI additions
- Agents list/detail (Keys tab, Activity tab, kill switch).
- Spend explorer rows for gateway requests show decision reasons and the enforcement tier (T0).

## Edge cases covered

G1–G11, G15, P7, L6, O2 (partial).

## Tests

- **Unit:** request parsers per provider; estimate per request shape; usage extraction from each provider's final stream event (fixtures); error shape mapping.
- **Property:** INV-13 — fuzzed bodies against a recording fake upstream: if the decision is deny, the fake upstream receives zero bytes; estimate ≥ actual for fixtures where the model respected `max_tokens`.
- **Fuzz:** parsers with `fc.anything()` and random bytes → 400, never 5xx, never forwards.
- **Integration (fake upstream with scripted behaviours):** normal stream; disconnect at random byte offsets (G3); 5xx after partial output (G4); 429 (G5); slow first byte; huge output exceeding estimate (L6 overage flagged); DB killed mid-stream (fail-closed / outbox recovery).
- **E2E:** create agent + key in UI → run `try:gateway` → spend visible → run `try:exceed-budget` → denial reason names the right budget → pause agent → next call denied within 2 s → resume.
- **Load (k6, staging):** 200 rps with the fake upstream → gateway overhead p99 < 30 ms; 100 concurrent requests on one small budget → no overspend beyond flagged overages.

## Security checklist

- [ ] Keys: random 32 bytes, HMAC stored, shown once, revocation instant (test)
- [ ] Upstream URLs fixed per provider; no user-controlled URL anywhere (Semgrep rule)
- [ ] Agent keys rejected by all control-plane routes (P10 test)
- [ ] Prompt logging default off; bodies encrypted when on; retention job deletes on schedule
- [ ] Per-key and per-org rate/concurrency limits active
- [ ] Internal workspace tokens expire in 5 minutes and are bound to one principal

## Deployment

Gateway service on `staging-gw.<domain>` (Caddy: `flush_interval -1` so SSE isn't buffered). Add gateway latency and error-rate panels + alerts.

## Try it yourself

1. Staging → Agents → **New agent** "research-bot", team Marketing, budget USD 0.50/day (hard). Create a key → copy it.
2. Point any OpenAI SDK at the gateway:
   ```bash
   curl https://staging-gw.<domain>/v1/chat/completions \
     -H "Authorization: Bearer apk_test_…" -H "Content-Type: application/json" \
     -d '{"model":"openai/gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"Write a haiku about budgets"}]}' -i
   ```
   Check the `x-aperture-cost-usd` and `x-aperture-budget-remaining-usd` headers; the request appears in Spend with reason "allowed".
3. `pnpm try:exceed-budget --key apk_test_…` → it stops with `402 aperture_budget_exceeded` naming research-bot's daily budget.
4. Ask for a model the policy denies (e.g. `openai/o3`) → `403 aperture_policy_denied` with the rule.
5. Start a long streaming request and press **Pause** on the agent in the UI → the next request fails within ~2 s.
6. Log in as the Marketing member → Workspace → chat; watch the budget meter move.

## Exit criteria

- [ ] All "try it yourself" steps pass on staging with real OpenRouter/Anthropic traffic
- [ ] INV-13 and gateway integration suite green
- [ ] Load test targets met and recorded
- [ ] **Pilot readiness review**: onboarding doc for the design partner written (connect providers, create teams/budgets, give marketing the workspace)

## Risks / open questions

- Provider stream formats evolve; fixtures + weekly contract tests catch changes.
- If a customer needs model translation (e.g. Anthropic models via the OpenAI format), route through OpenRouter rather than adding translation code.
