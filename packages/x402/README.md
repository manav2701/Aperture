# @aperture/x402

x402 on Solana for Aperture: validating a seller's payment requirement, building and verifying the delegate-signed payment transaction (Path 1), building budget-account setup, top-up and revoke transactions for the treasury wallet, a small RPC client with fallback, stablecoin prices for the depeg guard, and audit anchor memos. See ADR 0018.

| File              | What                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `networks.ts`     | CAIP-2 ids and hardcoded USDC/USDT mints per network                                                                                                       |
| `requirements.ts` | x402 v2 PAYMENT-REQUIRED decoding and `acceptRequirement` (network, asset, cap, timeout, fee payer), PAYMENT-SIGNATURE encoding                            |
| `transaction.ts`  | `buildPaymentTransaction` (compute limit + price, TransferChecked as delegate, memo) and `verifyPaymentTransaction` (our port of the facilitator's checks) |
| `accounts.ts`     | Seeded budget accounts; setup, top-up and revoke transactions (unsigned, for the treasury wallet)                                                          |
| `rpc.ts`          | JSON-RPC with provider fallback; `paymentsOutOf` for the settlement watcher                                                                                |
| `prices.ts`       | Pyth Hermes USDC/USDT prices and `depegReason`                                                                                                             |
| `anchor.ts`       | Audit anchor memo format and the notary's memo transaction                                                                                                 |

The signer (`apps/signer`), the authorize route (`apps/gateway/src/x402.ts`), the jobs (`x402.watch`, `x402.reconcile`, `prices.stable`, `audit.anchor`) and the local test seller (`tools/x402-test-seller`) build on this package.

## Trying it on devnet

1. Create a Phantom wallet on devnet ("Treasury (test)"), fund it with devnet SOL and Circle's devnet USDC.
2. Run the go/no-go spike: `SPIKE_TREASURY_SECRET='[…]' FACILITATOR_URL=https://facilitator.payai.network pnpm --filter @aperture/cli x402-spike`.
3. Dashboard → Crypto → connect devnet with the treasury address → create a budget account for an agent → sign in Phantom.
4. Start the test seller: `pnpm --filter x402-test-seller dev -- --pay-to <address> --fee-payer 2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`.
5. `pnpm try:x402 --url http://localhost:4021/paid` with the agent's key.
