# Phase 6 — Media gateway (image and video) and the marketing workspace

**Goal:** marketing and content teams generate images and videos inside their budgets, with a cost preview before anything runs and holds that cover long-running jobs.
**Duration:** ~2 weeks.
**Depends on:** Phase 5.

## Starting point

Text gateway with reserve/settle, workspace chat, price catalog, worker.

## Scope

**In:** image generation (OpenAI images, OpenRouter image-output models, fal), video generation (Google Veo via the Gemini API, Runway, fal) as async jobs; `media_jobs`; object storage with signed URLs; estimate endpoint; `media_limits` policy rule; workspace Images and Videos pages; per-provider failure-billing flags.
**Out:** OpenAI Sora (API retired 24 Sep 2026); audio/music generation (later, same pattern).

## Tasks

### 6.1 Price catalog for media
- Extend the catalog with `perImage` (by size/quality) and `perSecond` (by model/resolution/tier) entries and source links (Veo 3.1 Lite/Fast/Standard, Runway Gen-4 Turbo/Gen-4.5, fal model prices).
- `billsOnFailure` per provider: fal = false (documented: 5xx not billed); Runway, Veo = **VERIFY** during this phase with a deliberately failing job; default to `true` (conservative) until verified.

### 6.2 Estimate endpoint
- `POST /v1/estimate` (gateway) → returns cost for a prospective text/image/video request under the caller's policy, plus whether it would be allowed and the remaining budget after. Used by the workspace for previews and by agents.

### 6.3 Images (synchronous)
- `POST /v1/images/generations` (OpenAI-compatible shape) routed to OpenAI images, OpenRouter image models, or fal (`fal-ai/<model>` names) by model id.
- Pipeline identical to text: policy (`media_limits`: max count, allowed sizes) → estimate (count × per-image) → reserve → call → settle → copy outputs to object storage (G14) → return signed URLs (15-minute expiry).

### 6.4 Videos (asynchronous)
- `POST /v1/videos` → policy (max seconds, resolutions, models) → estimate (seconds × price × count) → reserve with TTL = provider max + 30 min → submit:
  - Veo: Gemini API long-running operation; poll the operation.
  - Runway: create task; poll task status.
  - fal: queue submit with a webhook URL (`/webhooks/fal`, verified) + polling fallback.
- `media_jobs` row; `GET /v1/videos/{id}` returns status, held amount, and output URL when done.
- Worker `media.poll` every 10 s: success → settle actual (from provider-reported duration) → store output → notify; failure → release or settle per `billsOnFailure` (G13); TTL passed → `expired_reconciling` and keep asking the provider (G12).

### 6.5 Workspace pages
- **Images**: prompt, model, size, count → live cost preview → Generate → gallery (per-image cost, download, prompt, who/when).
- **Videos**: prompt, model, duration, resolution → cost preview → Submit → job list with status, "held USD X" badge, elapsed time → player when done.
- Denied/approval-required states inline (approval button live after Phase 7).
- Team gallery visible to the team (permissions by team membership).

### 6.6 Storage
- S3-compatible bucket (MinIO on staging or R2), private; keys `org/<org>/media/<job>/<n>.<ext>`; lifecycle rule per org retention setting.

## Edge cases covered

G12, G13, G14, L6 (media overage when provider duration > requested).

## Tests

- **Unit:** media estimates for each model/tier/resolution; `media_limits` rule cases.
- **Integration (fake media providers):** image success/failure; video job success after N polls; failure with and without billing; job exceeding TTL → `expired_reconciling` → later success settles correctly; fal webhook arriving before/after polling result (idempotent).
- **Live contract (weekly):** one cheapest-possible image on fal and one 2–4-second video on the cheapest Veo/Runway tier (cost cents; budget for it).
- **E2E:** marketing member generates 2 images and 1 short video inside a USD 2 budget; the third video preview shows "exceeds budget" and the submit is blocked.

## Security checklist

- [ ] Outputs stored privately; only signed URLs leave the system; provider public URLs never shown
- [ ] fal webhook verified and idempotent
- [ ] Prompt/media retention follows org settings

## Deployment

Object storage configured for staging; worker poll job enabled; alert on `expired_reconciling` jobs older than 2 hours.

## Try it yourself

1. Give the Marketing member USD 2/day. Log in as that member → Workspace → **Images** → "product shot of a coffee cup on a desk", 2 images → note the preview cost → Generate → gallery shows the actual cost.
2. **Videos** → 4 seconds, cheapest Veo tier → Submit → see "held USD 0.20" (example) while running → video plays when done → Spend shows the settled amount.
3. Try a 60-second video → preview says it exceeds the policy max seconds or the budget → Submit disabled with the reason.
4. Agent path: `curl -X POST https://staging-gw.<domain>/v1/estimate …` for a 10-second video → JSON with cost and `allowed: false|true`.

## Exit criteria

- [ ] Image and video flows work end to end on staging with real providers
- [ ] `billsOnFailure` verified for each provider and documented
- [ ] Design-partner pilot can start (Phases 4–6 cover visibility, gateway, workspace)

## Risks / open questions

- Video model menus and prices change often; keep them catalog data, not code.
