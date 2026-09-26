# 0015 — Media generation (Phase 6)

**Status:** Accepted
**Date:** 2026-09-27

## Context

Marketing teams want images and video inside the same budgets as text. Video jobs run for minutes, prices differ by model, resolution and audio, and the only live provider keys are OpenRouter and Gemini (USD 1 cap each).

## Decisions

1. **OpenRouter is the default media route.** Its `/images` and `/videos` APIs cover about 50 image and 25 video models, including Veo, Runway, Kling and Seedance, with one key. They also report the exact `usage.cost` of each job, so settlement is exact.
2. **Direct routes where they add something.** OpenAI Images for `gpt-image-*` ids, and Veo on the Gemini API for `veo-*` ids. fal and Runway direct are deferred: fal needs a key, and Runway is reachable through OpenRouter.
3. **Prices come from OpenRouter's public catalogs; nothing is typed by hand.**
   - Video prices are per second. The estimate uses the SKU matching the requested resolution and audio, or the highest rate when none matches.
   - Image prices are per image or per output token. Token-priced models are bounded by the most tokens an image can take.
   - Models priced in video tokens are treated as unpriced and denied (G6) until a token formula is added.
4. **Same pipeline as text:** policy on an upper-bound estimate (with `media_limits`) → reserve → call → settle the actual cost.
   - Images finish within the request.
   - Videos are `media_jobs` finished by the `media.poll` job every 10 s. Their hold lasts one hour with `onExpiry: reconcile`; after that the hold is `expired_reconciling` and the poller keeps asking (G12). The job gives up after 24 hours and charges the reservation.
5. **Failure billing (G13):** OpenRouter and Veo don't bill failed generations (a reported `usage.cost` is used when present); unknown providers are assumed to bill.
6. **Private storage (G14).** Any S3-compatible bucket (staging: Supabase Storage). Keys are `org/<org>/media/<job>/<n>.<ext>`, and only 15-minute signed URLs leave Aperture. The web CSP allows exactly that storage origin (`MEDIA_ORIGIN`). Veo downloads follow redirects by hand, so the Gemini key is only ever sent to Google's host.
7. **Workspace media runs as the signed-in person** through the gateway (5-minute workspace tokens), with a debounced cost preview (`POST /v1/estimate`) that reserves nothing. Galleries show your own items and your team's.

## Consequences

- Live check (2026-09-26): one Seedream image ($0.035) and a 4-second Veo 3.1 Lite video ($0.12). OpenRouter's meter matched the ledger exactly.
- Deferred:
  - fal (queue and webhook);
  - Runway direct;
  - verifying `billsOnFailure` with a deliberately failing job;
  - per-org media retention and lifecycle rules;
  - video-token pricing.
