# 0014 — Provider connectors and the gateway (Phases 4–5)

**Status:** Accepted
**Date:** 2026-09-25

## Context

Phase 4 governs spend that happens directly at AI providers; Phase 5 adds a gateway that decides before each request. Staging runs on Render's free tier (no background workers, services sleep when idle), and only an OpenRouter management key and a Gemini API key are available for live testing, with a hard USD 1 cap per key.

## Decisions

1. **Budgets are inherited.** A principal with no budget of its own is charged to its team's budgets, and without those to the org's. The path then walks up the parents as before. Only an org with no budgets at all fails closed with `no_budget`.
2. **Connectors declare their enforcement tier.** OpenRouter is T1: Aperture keeps each key's provider-side limit at _lifetime usage + remaining budget_. OpenAI, Anthropic and Google with a service account are T2: keys are revoked when a hard budget is used up. Gemini with only an API key, and Hugging Face, are T3: gateway only.
3. **Two usage models, both idempotent.** `key_totals` (OpenRouter) imports the growth of each key's lifetime spend. Each delta is keyed by its starting total, so a crash-replay turns into an adjustment rather than a second charge. `buckets` (OpenAI, Anthropic) prices per-minute usage from the catalog, re-imports the trailing two hours, and books provider revisions as adjustments.
4. **Nothing before the connection is charged.** A key's spend at first sight becomes its baseline.
5. **Unmapped keys are charged to an org-level "Unassigned provider keys" principal** (`principals.system_role = 'unassigned'`), which inherits the org budget until someone assigns the key.
6. **Prices are never typed by hand.** The daily `prices.sync` reads OpenRouter's public catalog and derives direct-provider entries from it (OpenRouter passes list prices through). A model with no price is denied by the gateway (G6) and skipped with an alert by the importer.
7. **The gateway is a passthrough with one adapter per wire format** (OpenAI, Anthropic, Gemini):
   - Upstream URLs are constants.
   - The only changes to a request are an output-token cap (default 4,096, or the policy obligation) and `stream_options.include_usage`.
   - Policy runs on the estimate; then the request reserves, forwards, and settles from reported usage. OpenRouter's `usage.cost` is used exactly when present.
   - A stream that ends without usage (client disconnect, upstream failure) settles at the reservation.
   - Holds expire after 15 minutes with `onExpiry: settle`, which covers a crashed process (O2).
8. **Keys.** `apk_live_…`/`apk_test_…` keys are 32 random bytes, and only an HMAC under `APERTURE_KEY_PEPPER` is stored. Lookups are not cached, so revocation applies to the very next request. Workspace chat uses 5-minute tokens signed with the same pepper, domain-separated, so the browser never holds a key.
9. **Kill switch and caching.** Principal status and budgets are read inside `reserve`'s transaction, so pausing is immediate. Policy layers, upstream keys and connected providers are cached for at most 30 s and dropped at once through `LISTEN aperture_invalidate`, fired by triggers.
10. **Deployment flexibility.** The API can run the jobs (`RUN_WORKER=true`) and serve the gateway under `/gw` (`EMBED_GATEWAY=true`). Jobs take a Postgres advisory lock each, so moving to separate `apps/worker` and `apps/gateway` services later needs no code change.

## Consequences

- Staging governs real traffic on the free tier. While the service sleeps, jobs don't run: usage imported late is still booked in the right period, but T1/T2 enforcement waits for the next wake-up.
- Streaming responses can't carry a cost header. Their cost appears in Spend once the final usage event is read.
- Deferred (see `plan/deferred.md`):
  - reconciling gateway settlements against OpenRouter `/generation`;
  - the Google budget Pub/Sub webhook;
  - OpenAI and Anthropic daily cost-report reconciliation;
  - the `open_capped` fail mode;
  - storing prompt bodies (`prompt_logging: full`; bodies are never stored today);
  - a thin SDK;
  - the load test.
