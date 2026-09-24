# Phase 9 — Crypto rail: x402 on Solana with USDC/USDT

**Goal:** agents pay x402 APIs on Solana from **customer-owned** budget accounts, with an on-chain hard cap (SPL delegate allowance) and Aperture's policies, approvals, and ledger checked before every signature. Settlement is verified on-chain by Aperture, and the audit chain can be anchored on Solana.
**Duration:** ~3 weeks.
**Depends on:** Phases 2, 5, 7; Phase 0 Solana accounts, facilitator answers, and legal opinion C1 (for mainnet).

## Starting point

Gateway pipeline and ledger; mandates/approvals; empty `apps/signer`; legacy Anchor programs archived (not used).

## Scope

**In:** feasibility spike; treasury connection (wallet adapter); per-agent budget token accounts + delegate allowances; `apps/signer`; `POST /v1/x402/authorize`; SDK `fetch` wrapper; payee bindings; settlement watcher; reconciliation; depeg guard; local x402 test seller; audit anchoring; MCP `pay_x402`. Devnet end to end; mainnet with small amounts only after C1.
**Out:** our own on-chain program; Swig/Squads integration (spike only, build when a customer asks); EVM chains; MPP/Tempo (future connector).

## Tasks

### 9.0 Spike (first 2–3 days — go/no-go for the design)
1. On devnet, create a token account owned by wallet T (treasury), mint devnet USDC into it, `approveChecked` delegate D.
2. Run the x402 reference **local facilitator** and a local seller requiring USDC on devnet; build a Path 1 transaction: CU limit, CU price, `TransferChecked(source = T's budget account, authority = D)`, Memo(nonce); partially sign with D; send `PAYMENT-SIGNATURE`; confirm settlement.
3. Repeat against **PayAI** and **Dexter** devnet endpoints (if available — Phase 0 question).
4. **Outcome A** (delegate accepted): proceed with this design. **Outcome B** (rejected): fall back to agent-owned budget accounts whose owner key is held by the signer (custodial float — requires C1 answer), or to Swig (Path 2 allowlisted) if facilitators enable smart-wallet verification. Record the result in an ADR.

### 9.1 Treasury connection and budget accounts
- Connections → Solana: choose network (devnet/mainnet), asset (USDC/USDT mints for that network — hardcoded constants, X9), RPC providers (primary + fallback, X12).
- Connect the treasury wallet (Phantom/Solflare/Squads via `@solana/wallet-adapter` or Wallet Standard); Aperture stores the public key only.
- For an agent: Aperture generates the delegate key in `apps/signer` (Ed25519, envelope-encrypted with `SIGNER_KEK`), then builds a setup transaction for the treasury to sign: create budget token account (owner = treasury), transfer float, `approveChecked(delegate, allowance)`. The web app asks the wallet to sign and submit.
- Top-up (transfer + new approve), reduce/revoke (`revoke`), sweep back — all treasury-signed from the UI.
- Show on-chain truth next to ledger numbers: balance, `delegatedAmount`, delegate pubkey.

### 9.2 Signer (`apps/signer`)
- Internal-only HTTP (Docker network, no public route), mTLS or a shared secret between gateway and signer.
- `POST /sign { holdId }`: loads the hold and its `x402_payments` intent from the DB, re-validates (hold open, amount/mint/source/payTo/network match, allowance and balance sufficient via RPC — X7, X8), builds the Path 1 transaction (seller `feePayer`, `extra.recentBlockhash` if valid else fetch, Memo = `extra.memo` or 16-byte random hex nonce, Path 1-compliant CU values — X14), signs with the delegate key, returns base64.
- Per-agent rate limit; refuses anything not tied to an open hold (X11).

### 9.3 Authorize endpoint (`apps/gateway`)
- `POST /v1/x402/authorize { url, paymentRequired (decoded or base64), selectedIndex? }`:
  - Validate: `x402Version = 2`, `scheme = exact`, CAIP-2 `network` = connection's network (X3), `asset` ∈ configured mints (X2), `amount` ≤ per-call cap, `maxTimeoutSeconds` sane, `payTo` bound to the URL's origin (payee allowlist or trust-on-first-use binding requiring Finance approval to change — X1).
  - Policy (`x402_payees`, `max_amount_per_action`, time window, approvals) → reserve (µUSD = atomic amount for 6-decimal stablecoins) → signer → respond with the `PaymentPayload` ready for the `PAYMENT-SIGNATURE` header.
- Depeg guard (X13): if the configured price feed shows USDC/USDT outside ±2%, deny with `asset_depegged`. (**VERIFY** feed choice: e.g. Pyth or a CEX index.)

### 9.4 Settlement watcher (`apps/worker`, `x402.watch`)
- For budget accounts with open x402 holds: `getSignaturesForAddress` since the last cursor; fetch parsed transactions; match `TransferChecked` from the account with the memo nonce → settle hold with `tx_signature`; unknown outgoing transfers → `unheld_capture` + alert (X6).
- After `lastValidBlockHeight` + margin with no match → release (X4).
- Nightly reconciliation: on-chain balance and `delegatedAmount` vs ledger; drift → alert.
- Delivery tracking: SDK reports the resource response status; settled-but-undelivered → per-seller stats, alert, optional auto-block (X5).

### 9.5 SDK and MCP
- `aperture.x402.fetch(url, init)`: performs the request; on 402 → decode `PAYMENT-REQUIRED` → `authorize` → retry with `PAYMENT-SIGNATURE` → return the response; typed errors for deny/approval.
- MCP tool `pay_x402 { url, method, body }` using the same flow.

### 9.6 Test seller (`tools/x402-test-seller`)
- Hono app using the official x402 server library: priced endpoints, configurable misbehaviours (change `payTo`, inflate amount, return 500 after settlement, never settle) for tests.

### 9.7 Audit anchoring
- Daily per org (opt-in): Merkle root of the day's audit hashes → Memo transaction from the Aperture **notary** wallet; store signature in `audit_anchors`; Audit page shows explorer links; `audit-verify` can check the anchor.

### 9.8 Later (spike only in this phase)
- Swig: evaluate a Swig wallet with an agent role that has a token spend limit, and whether PayAI/Dexter enable Path 2 for it. Write findings; build only on customer demand.

## Edge cases covered

X1–X14, INV-12.

## Tests

- **Unit:** PaymentRequired decoding/validation; payee binding rules; transaction builder output decoded and compared to intent; depeg guard.
- **Property:** INV-12 — fuzzed PaymentRequired + random policies: a signature is produced **iff** all checks pass, and every produced transaction passes our local port of the x402 SVM Path 1 verifier rules (instruction count/order, TransferChecked to ATA of payTo, memo present, fee payer isolation, CU caps).
- **Fuzz:** base64/JSON decoder with arbitrary input; signer `/sign` with random hold ids and tampered intents → always refuses.
- **Integration (local validator + local facilitator + test seller):** happy path; blockhash expiry → release; seller changes `payTo` → refused; seller inflates amount → refused over cap; seller 500 after settlement → settled + undelivered; treasury revokes mid-flight → tx fails → release; duplicate payload replay → second transfer detected; RPC primary down → fallback.
- **Live (devnet):** the spike scripts become a scheduled weekly check against PayAI/Dexter devnet.

## Security checklist

- [ ] Signer unreachable from the internet (port scan from outside)
- [ ] Signer signs only for open holds with matching intent (tests)
- [ ] Delegate keys encrypted with a KEK only the signer has
- [ ] Only configured USDC/USDT mints accepted; network pinned per connection
- [ ] Allowance per agent sized as the maximum acceptable loss; UI states this
- [ ] **Legal opinion C1 received before mainnet**; if negative, ship the customer-hosted signer option instead

## Deployment

`apps/signer` on the internal network; devnet RPC keys in staging secrets; notary wallet funded with a little devnet SOL. Mainnet only in production (Phase 10) after C1, with per-agent allowances ≤ USD 50 for the first customers.

## Try it yourself (devnet)

1. Connections → Solana (devnet) → connect your "Treasury (test)" Phantom wallet.
2. Agents → research-bot → **Wallet** → Create budget account: float 5 USDC, allowance 5 USDC → sign in Phantom → see balance and delegated amount.
3. Start the test seller: `pnpm --filter x402-test-seller dev` (price 0.01 USDC per call).
4. `pnpm try:x402 --key apk_test_… --url http://localhost:4021/paid` → response 200; Spend shows a settled x402 entry with the transaction signature (open it in Solana Explorer on devnet).
5. Restart the seller with `--evil-payto` → the next payment is refused with `payee_mismatch`.
6. Lower the agent's Aperture daily budget below 0.01 → `budget_exceeded`.
7. In Phantom, **revoke** the delegate → next payment fails; Aperture shows allowance 0 and denies further payments before signing.
8. Audit → anchor today's root → open the Memo transaction on the explorer; `pnpm audit-verify export.jsonl --check-anchor` → valid.

## Exit criteria

- [ ] Spike outcome recorded in an ADR
- [ ] Devnet end-to-end flows pass, including all misbehaving-seller tests
- [ ] INV-12 passes nightly at 10,000+ cases
- [ ] Mainnet decision made with the legal opinion in hand

## Risks / open questions

- Facilitators may reject delegate-signed transfers (spike decides the path).
- Regulatory classification of delegate control (C1).
- x402 is evolving quickly; pin the spec version supported and track changes monthly.
