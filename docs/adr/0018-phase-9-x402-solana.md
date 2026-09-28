# 0018 — x402 on Solana with delegate allowances (Phase 9)

**Status:** Accepted for devnet. Mainnet waits on the delegate spike and the legal opinion (C1).
**Date:** 2026-09-28

## Context

Agents increasingly pay per request with x402. ADR 0008 chose customer-owned funds with an SPL delegate allowance, so no custody by Aperture and an on-chain hard cap per agent. There are no devnet wallets or RPC keys in `.env` yet, so everything is built against fakes: a scripted RPC, a local test seller, and our own port of the facilitator's checks.

## Findings (2026-09-28, read-only)

- **PayAI and Dexter both publish x402 v2 `exact` on Solana devnet** (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) and mainnet. Fee payers:
  - PayAI devnet: `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`
  - Dexter: `DeXterR2kQm8AvRHnNPatWkE46TfAcMeBDjb6FySoAb8`
- PayAI hands out `recentBlockhash` and `lastValidBlockHeight`, and the signer uses them when present.
- Dexter advertises `smartWalletSupported`, the Path 2 fallback.
- **Not yet known:** whether either one accepts a `TransferChecked` signed by a token-account _delegate_. `pnpm --filter @aperture/cli x402-spike` answers it on devnet in one run, for about 0.02 test USDC.

## Decisions

1. **Budget accounts are seeded token accounts owned by the treasury.**
   - Each is created with `createAccountWithSeed`, so the treasury is the only signer.
   - One account per agent and mint, with `approveChecked(delegate, allowance)`.
   - Aperture builds setup, top-up and revoke transactions; the treasury wallet signs them in the browser through the Wallet Standard. The treasury key never reaches Aperture.
2. **`apps/signer` holds delegate keys** under its own KEK (`SIGNER_KEK_V1`) and on the private network, with a shared secret. It signs only when all of these hold:
   - the payment's hold is open;
   - the hold matches the recorded intent: amount, principal, and the hold's `externalRef` is the payment;
   - the chain still shows our delegate with enough allowance and balance (X7, X8).

   It rate-limits per agent, and verifies its own output with our Path 1 verifier before returning it. A staging-only embedded mode (`EMBED_SIGNER`) exists for single-host deployments.

3. **`POST /v1/x402/authorize` runs these checks before anything is signed:**
   - x402 v2 decoding;
   - scheme `exact` and the connection's network (X3);
   - a configured stablecoin mint (X2);
   - a per-payment cap;
   - a sane timeout;
   - a distinct fee payer;
   - the depeg guard on mainnet (Pyth, ±2 %, 1 h staleness; X13);
   - the payee binding (X1): trust on first use, and a changed `payTo` waits for Finance;
   - policy (`x402_payees` and the other rules), approvals and mandates;
   - the reservation.

   A signer refusal releases the hold at once.

4. **Settlement is on-chain truth.**
   - The watcher matches transfers out of each budget account by memo nonce, and settles the hold with the transaction signature.
   - Any other outgoing transfer is unheld spend with an alert (X6).
   - A payment whose blockhash expired (`lastValidBlockHeight + 150`) is released (X4).
   - Nightly, the balance and allowance are read back, and a revoked delegate deactivates the account.
5. **The SDK's `x402Fetch` pays a 402 and reports delivery** (X5). MCP `pay_x402` exposes the same.
6. **Audit anchoring:** the day's Merkle root of an org's audit hashes goes into a memo from the notary wallet (`NOTARY_SECRET_KEY`), for orgs that opt in. `audit-verify --check-anchor` compares an export with it.
7. **Mainnet is behind `MAINNET_X402_ENABLED`**, off until the legal opinion arrives.

## If the spike says no (Outcome B)

In order of preference:

1. Dexter's smart-wallet path (Swig role with a spend limit), with no custody.
2. A customer-hosted signer (same code, their infrastructure).
3. Agent-owned budget accounts whose owner key sits in the signer. That is custody, so it needs C1.

The rest of this phase (authorize, watcher, payee binding, SDK and MCP) is unchanged in every case.

## Consequences

- Stablecoins are treated as par; the depeg guard is the only protection, and it applies on mainnet only.
- The Path 1 verifier caps (200k compute units, 5 lamports per unit) and the memo as a 4th instruction are our reading of the spec. **Verify them against scheme_exact_svm on each x402 release.**
