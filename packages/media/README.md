# @aperture/media

Image and video generation for the gateway and the `media.poll` job ([ADR 0015](../../docs/adr/0015-phase-6-media.md)).

- `prices.ts`: `fetchMediaCatalog()` builds per-image, per-token and per-second prices from OpenRouter's public catalogs. `estimateImages()` and `estimateVideo()` return upper bounds; `videoRate()` picks the SKU for a resolution and audio choice.
- `providers.ts`: OpenRouter (`/images`, `/videos`), OpenAI Images, and Veo on the Gemini API (long-running operations; downloads send the key only to Google's host). `BILLS_ON_FAILURE` records whether each provider charges for failed generations.
- `storage.ts`: private S3-compatible storage (`MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`), with 15-minute signed URLs.
- `test/fakes.ts` (`@aperture/media/testing`): in-memory storage for tests.
