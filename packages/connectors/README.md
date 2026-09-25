# @aperture/connectors

Talks to AI providers on behalf of an organization: tests a connection, lists keys, creates budget-capped keys, mirrors limits, revokes, and reads usage. Also builds the model price catalog. See [ADR 0014](../../docs/adr/0014-phases-4-5-connectors-and-gateway.md).

| Provider     | Secret                                     | Tier    | Usage                               | Notes                                                                      |
| ------------ | ------------------------------------------ | ------- | ----------------------------------- | -------------------------------------------------------------------------- |
| OpenRouter   | Management (provisioning) key              | T1      | `key_totals`                        | Key limit = lifetime usage + remaining budget, `limit_reset: null`         |
| OpenAI       | Admin key + project id                     | T2      | `buckets` (1 min, by key and model) | Service account per principal; key deleted on breach                       |
| Anthropic    | Admin key                                  | T2      | `buckets`                           | Keys can't be created via API: import and assign; set `inactive` on breach |
| Google       | Gemini API key **or** service-account JSON | T3 / T2 | none                                | API key: gateway only. Service account: API Keys API delete                |
| Hugging Face | Access token                               | T3      | none                                | Govern through the gateway                                                 |

- `src/http.ts`: the only way out. Fixed base URLs, 20 s timeout, and retries on 429/5xx with jitter that honour `Retry-After`. Errors are a typed `ConnectorError`.
- `src/prices.ts`: `fetchPriceCatalog()` reads OpenRouter's public `/models` and derives OpenAI, Anthropic and Google entries. `normalizeModel()` gives each model one spelling.
- `test/fake-fetch.ts` (exported as `@aperture/connectors/testing`): a scripted fake provider for tests in any package.

```bash
pnpm --filter @aperture/connectors test
```
