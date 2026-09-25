# @aperture/gateway

The governed AI gateway: a passthrough that checks policy and budget **before** forwarding, then settles the exact cost. See [ADR 0014](../../docs/adr/0014-phases-4-5-connectors-and-gateway.md).

| Route                                                                           | Upstream                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /v1/chat/completions`, `/v1/embeddings`, `/v1/responses`                  | OpenRouter (`vendor/model` ids) or OpenAI (bare ids) |
| `POST /anthropic/v1/messages`                                                   | Anthropic                                            |
| `POST /google/v1beta/models/{model}:generateContent` / `:streamGenerateContent` | Gemini API                                           |
| `POST /hf/v1/chat/completions`                                                  | Hugging Face router                                  |

Auth: `Authorization: Bearer apk_…`, `x-api-key` (Anthropic SDK) or `x-goog-api-key` (Gemini SDK). The workspace uses short-lived `wst.` tokens.

Responses carry `x-aperture-request-id`. Non-streaming responses also carry `x-aperture-cost-usd` and `x-aperture-budget-remaining-usd`. Denials use the caller's SDK error shape with `aperture_*` types:

- 401 unauthorized
- 402 budget exceeded, or no budget
- 403 policy denied, principal inactive, or model unpriced
- 424 provider not connected
- 429 rate limited
- 503 fail closed

```bash
pnpm --filter @aperture/gateway dev    # port 4100; needs DATABASE_URL, APERTURE_KEY_PEPPER, APERTURE_KEK_V1
pnpm --filter @aperture/gateway test
```

On hosts without a separate service, the API serves it under `/gw` (`EMBED_GATEWAY=true`).
