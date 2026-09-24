# 0008 — x402 via SPL delegate allowances and an isolated signer

- Status: Accepted; production use gated on a legal opinion (VARA)

## Context

x402 on Solana (about 70% of x402 volume) pays in USDC/USDT, which use the classic SPL Token program, so a Token-2022 transfer hook can't govern them. Facilitators accept either a fixed transaction layout (Path 1) or allowlisted smart wallets (Path 2: Squads, Swig, SPL Governance and a few others). A custom policy program would be rejected.

## Decision

For each agent, the customer's treasury owns a budget token account and approves an SPL delegate allowance to a key held by Aperture's isolated `signer` service. Aperture checks policy and reserves against the ledger before signing a Path 1 `TransferChecked` as the delegate. Settlement is verified on-chain by matching the memo nonce. Swig or Squads are the path to on-chain period limits later.

## Consequences

- The on-chain allowance caps the loss if Aperture is compromised, and the treasury can revoke it at any time.
- A devnet spike in Phase 9 must confirm that facilitators accept delegate-signed transfers.
- Holding a delegate key may count as control under VARA; mainnet waits for a legal opinion, with a customer-hosted signer as the fallback.
