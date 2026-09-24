# Testing strategy

Aperture decides whether money moves, so tests focus on **invariants** (things that must always be true) rather than on examples alone. Every phase adds tests at each layer and a live "try it yourself" script.

## Layers

| Layer | Tool | What | Runs |
|---|---|---|---|
| Unit | Vitest | Pure functions in `packages/core` (money, periods, policy, mandates, cost estimation, parsers) and small units elsewhere | Every commit |
| Property-based | fast-check (with Vitest) | Invariants over thousands of generated inputs and operation sequences | Every commit (bounded runs); nightly with 100× runs |
| Fuzz | fast-check `fc.anything()` / byte generators; optional Jazzer.js for coverage-guided fuzzing of parsers | Every external input parser never crashes, never allows by accident | Every commit (short); nightly (long) |
| Integration | Vitest + **Testcontainers** (real Postgres 17), fake upstream servers, Stripe test mode, Solana local validator | DB transactions under concurrency, webhooks, connectors with recorded fixtures | Every PR |
| Contract | Recorded provider responses (fixtures) + a weekly live check against real sandboxes | Connectors still match provider APIs | Weekly scheduled CI |
| End-to-end | Playwright against the full docker-compose stack | User journeys through the UI | Every PR (smoke), nightly (full) |
| Load | k6 | Gateway overhead, card webhook latency, reserve contention | Before each release; Phase 10 |
| Security | Semgrep, gitleaks, `pnpm audit`, OWASP ZAP baseline, RLS/authorization tests | Known-bad patterns, secrets, vulnerable deps, access control | Every PR; ZAP nightly on staging |
| Live ("try it yourself") | Scripts in `tools/try/` + manual steps in each phase README | You verify real behaviour on staging with real (small) money or test modes | End of each phase |

Coverage targets: `packages/core` ≥ 95% lines and branches; connectors and services ≥ 80%; UI no target (covered by e2e).

## Invariants and their property tests

| ID | Invariant | Generator | Phase |
|---|---|---|---|
| INV-1 | Hard budget: `held + spent_from_holds ≤ limit` for every budget/period, after any interleaving of reserve/settle(≤ hold)/release | Random budget trees (depth ≤ 5), random op sequences, executed concurrently against Testcontainers Postgres with 1–64 connections | 2 |
| INV-2 | Counters equal the fold of the journal | Same sequences; compare `budget_usage` with a recomputation | 2 |
| INV-3 | Every hold reaches exactly one terminal state (or `expired_reconciling`) | Sequences including expiry ticks | 2 |
| INV-4 | Idempotency: applying any operation twice with the same key equals applying it once | Sequences with random duplicates | 2 |
| INV-5 | Money: `parse(format(x)) = x`; no path produces a JS `number` for money | Random bigints, random strings | 2 |
| INV-6 | Periods: every instant maps to exactly one period per budget; consecutive periods don't overlap | Random instants across years and timezones (incl. DST zones) | 2 |
| INV-7 | Policy monotonicity: adding a deny rule never turns deny/approval into allow | Random policy sets + random requests | 2 |
| INV-8 | Policy intersection: a decision allowed at a child scope is allowed at every ancestor scope | Random scope chains | 2 |
| INV-9 | Mandate attenuation: for any child accepted by `isWithin(child, parent)`, every request the child allows is allowed by the parent | Random mandate pairs + requests | 7 |
| INV-10 | Engine totality: `evaluate()` on arbitrary JSON input returns a decision and never `allow` for invalid input | `fc.anything()` | 2 |
| INV-11 | Card state machine: any permutation/duplication of a valid Stripe event sequence for one authorization converges to the same ledger state | Event sequences from the Stripe docs' lifecycle table, shuffled and duplicated | 8 |
| INV-12 | x402: for any `PaymentRequired` (fuzzed), the signer produces a transaction **only if** asset, network, payTo binding, amount cap, and policy all pass — and every produced transaction passes our local port of the x402 SVM Path 1 verifier | Fuzzed 402 payloads + random policies | 9 |
| INV-13 | Gateway: for any request body, if the policy denies, no bytes are sent upstream | Fuzzed bodies against a fake upstream that records calls | 5 |
| INV-14 | Connector import idempotency: importing the same usage window N times yields the same ledger | Recorded fixtures replayed with random overlap | 4 |
| INV-15 | Audit chain: any single-byte change in any stored event is detected by verification | Random chains + random mutations | 2 |

## Fuzz targets (parsers that face the outside world)

| Target | Input | Must hold |
|---|---|---|
| `parseMoney` | arbitrary strings | returns a value or a typed error; never throws unexpectedly; never loses precision |
| Policy document schema | arbitrary JSON | rejects invalid documents with a message; never crashes |
| Gateway request parsing (OpenAI / Anthropic / Gemini shapes) | arbitrary JSON and bytes | invalid → 400; valid → estimate is finite and ≥ 1 µUSD |
| Stripe webhook handler (after signature check) | arbitrary JSON event bodies | never approves on malformed input; never throws past the handler |
| NymCard webhook handler | arbitrary JSON | same |
| x402 `PAYMENT-REQUIRED` decoder | arbitrary base64 / JSON | invalid → typed error; valid → INV-12 |
| Solana transaction builder | fuzzed intents | output always decodes and matches the intent |
| Audit export verifier | arbitrary JSONL | detects every mutation, never reports "valid" for a tampered file |

Coverage-guided fuzzing: if property tests stop finding new bugs in parsers, add Jazzer.js targets for `decodePaymentRequired`, `parseGatewayRequest`, and the webhook handlers; run them nightly for 30 minutes each. (Jazzer.js maintenance status: **VERIFY** before adopting; fall back to long fast-check runs.)

## Integration environments

| Dependency | How tests use it |
|---|---|
| Postgres | Testcontainers, a fresh database per test file, migrations applied |
| AI providers | Local fake upstream (Hono) that streams SSE with configurable usage, delays, errors, disconnects; plus recorded fixtures of real responses |
| OpenRouter / OpenAI / Anthropic admin APIs | Recorded fixtures (redacted) for CI; weekly live contract test with low-limit sandbox keys |
| Stripe Issuing | Sandbox + `stripe listen --forward-to` + test helpers (create/increment/reverse/capture/expire authorizations, force capture, refunds) |
| Solana | `solana-test-validator` (or LiteSVM for fast unit-level transaction tests) with a local USDC-like mint; devnet for live tests |
| x402 facilitator | Local facilitator from the x402 reference implementation for CI; PayAI/Dexter devnet (**VERIFY** devnet support) for live tests |
| Slack | Mock server for CI; a test workspace for live tests |

## End-to-end journeys (Playwright)

1. Sign up → create org → invite member → member accepts.
2. Connect a fake provider (test mode) → spend appears in Overview.
3. Create budget tree → create agent → create key → gateway call via script → spend visible → exceed → denied with reason.
4. Workspace chat within budget; image; video with cost preview.
5. Request over threshold → approval requested → approve as Finance → retry succeeds.
6. Kill switch on an agent → next request denied within 2 s.
7. Card purchase via Stripe test helper → allowed; over limit → declined.
8. x402 payment on local validator → settled; tampered `payTo` → refused.
9. Audit export → `tools/audit-verify` passes; edited file fails.

## Load and chaos

- k6 scenarios: (a) 500 rps gateway with fake upstream, measure added latency; (b) 50 rps card authorization webhooks, p99 < 400 ms; (c) 200 concurrent reserves on one budget.
- Chaos drills (staging): stop Postgres during load (expect fail-closed), stop the worker for 30 minutes (expect correct catch-up), restart the gateway during streaming (expect graceful drain).

## CI gates (GitHub Actions)

Required to merge: typecheck, lint, unit + property (bounded), integration, e2e smoke, Semgrep, gitleaks, `pnpm audit --prod` (no high/critical), build of all apps. Nightly: long property runs, fuzz runs, full e2e, ZAP baseline on staging, weekly live contract tests.

## Live testing ("try it yourself")

Each phase README ends with numbered steps you can run against **staging** (deployed from Phase 3 on). Scripts live in `tools/try/` and print what they did and what you should see, for example:

```bash
pnpm try:gateway --key apk_test_… --model openai/gpt-4o-mini --prompt "hello"
pnpm try:exceed-budget --key apk_test_…          # loops until denied, prints the denial reason
pnpm try:card-auth --amount 12.50 --mcc 5734     # creates a Stripe test authorization
pnpm try:x402 --url http://localhost:4021/paid   # pays the local x402 test seller
```
