# Legacy (archived hackathon build)

This folder holds the original Aperture hackathon build: three Anchor programs (`policy-manager`, `session-tracker`, `org-registry`), the program SDK, the Express gateway, the Next.js demo dashboard, framework adapters (MCP, n8n, OpenClaw, Hermes), and the Stacks-era docs. The exact pre-archive state is tagged `legacy-v0`.

**It is not built, tested, or deployed by CI, and nothing outside `legacy/` may import from it.** It is kept for reference while the new product is built (see [plan/](../plan/README.md)).

## Why it was archived

- The Token-2022 transfer hook only governs mints created with it; real USDC/USDT use the classic SPL Token program, so the on-chain design can't govern real money. The new design is in [plan/architecture](../plan/architecture/README.md).
- The demo dashboard and gateway had critical security problems (listed below) and presentation mocks.

## Security warnings — do not deploy this code

| ID | Problem |
|---|---|
| S1 | The dashboard reads and writes Supabase tables directly from the browser with the public key; the tables had no row-level security. Fixed operationally by `infra/supabase/lockdown.sql`, after which this app no longer works. |
| S2, S3 | `webapp/app/api/proxy` was an open SSRF relay trusting an unauthenticated `x-agent-address` header. Deleted before archiving. |
| S4 | Docs and schema stored agent wallet mnemonics in plaintext (`policies.agent_mnemonic`). Any wallet whose phrase was stored must be treated as compromised. The column is dropped by the lockdown script. |
| S5 | `gateway/` forwards any Bearer token to OpenRouter on the operator's key. |
| S6 | API keys generated with `Math.random()` and stored in plaintext. |

Full audit: [plan/current-state](../plan/current-state/README.md).

## Running it anyway (local reference only)

The original toolchain was Anchor 0.30.1 with a patched `anchor-syn` and Solana SBF tooling under WSL (`scripts/build.sh`, `scripts/test.sh`). The dashboard runs with `npm install && npm run dev` inside `webapp/` but needs the Supabase tables, which are locked down.
