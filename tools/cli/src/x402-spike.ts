/**
 * The Phase 9 go/no-go spike (plan/phases/phase-09 §9.0): does a facilitator accept a transfer
 * signed by a token-account *delegate* rather than its owner? Devnet only; spends ~0.02 test USDC
 * and a little devnet SOL.
 *
 *   SPIKE_TREASURY_SECRET='[..64 numbers..]'  (a devnet wallet holding devnet USDC + SOL)
 *   FACILITATOR_URL=https://facilitator.payai.network   (or Dexter's; must support solana devnet)
 *   pnpm --filter @aperture/cli x402-spike [--settle] [--rpc https://api.devnet.solana.com]
 *
 * Outcome A (verify says valid, and settle lands) → the delegate design stands.
 * Outcome B (rejected) → see ADR 0018 for the fallbacks.
 */
import { argv, env, exit, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import {
  ASSETS,
  CAIP2,
  X402_VERSION,
  buildPaymentTransaction,
  buildSetupTransaction,
  generateKeyPairSigner,
  notaryFromSecret,
  solanaRpc,
  TOKEN_ACCOUNT_SPACE,
} from '@aperture/x402';
import { getBase64EncodedWireTransaction, getTransactionDecoder, signTransaction } from '@solana/kit';

const { values } = parseArgs({
  args: argv.slice(2),
  options: {
    settle: { type: 'boolean', default: false },
    rpc: { type: 'string', default: 'https://api.devnet.solana.com' },
  },
});
const secret = env.SPIKE_TREASURY_SECRET;
const facilitator = env.FACILITATOR_URL?.replace(/\/+$/, '');
if (secret === undefined || facilitator === undefined) {
  stdout.write('Set SPIKE_TREASURY_SECRET (devnet keypair JSON) and FACILITATOR_URL.\n');
  exit(1);
}
const usdc = ASSETS.devnet[0];
if (usdc === undefined) exit(1);
const rpc = solanaRpc([values.rpc]);
const treasury = await notaryFromSecret(secret);
const delegate = await generateKeyPairSigner();
const principalId = `spike-${String(Date.now())}`;
const step = (text: string) => stdout.write(`• ${text}\n`);

// 1. What fee payer does the facilitator use on devnet?
const supported = (await (await fetch(`${facilitator}/supported`)).json()) as {
  kinds?: { scheme: string; network: string; extra?: { feePayer?: string } }[];
};
const kind = supported.kinds?.find((k) => k.scheme === 'exact' && k.network === CAIP2.devnet);
const feePayer = kind?.extra?.feePayer;
if (feePayer === undefined) {
  step(`the facilitator lists no exact/${CAIP2.devnet} kind with a fee payer: ${JSON.stringify(supported)}`);
  exit(1);
}
step(`facilitator fee payer on devnet: ${feePayer}`);

// 2. A budget account owned by the treasury, with a delegate allowance of 0.02 USDC.
const setup = await buildSetupTransaction(
  {
    treasury: treasury.address,
    principalId,
    mint: usdc.mint,
    decimals: 6,
    delegate: delegate.address,
    float: 20_000n,
    allowance: 20_000n,
    rentLamports: await rpc.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE),
  },
  await rpc.getLatestBlockhash(),
);
const unsigned = getTransactionDecoder().decode(Buffer.from(setup.transaction, 'base64'));
const setupSignature = await rpc.sendTransaction(
  getBase64EncodedWireTransaction(await signTransaction([treasury.keyPair], unsigned)),
);
step(`budget account ${setup.budgetAccount} set up in ${setupSignature}`);
for (let attempt = 0; attempt < 30; attempt += 1) {
  const state = await rpc.getTokenAccount(setup.budgetAccount);
  if (state?.delegate === delegate.address) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// 3. A delegate-signed payment of 0.01 USDC to the treasury's own token account.
const requirement = {
  scheme: 'exact',
  network: CAIP2.devnet,
  amount: '10000',
  asset: usdc.mint,
  payTo: treasury.address,
  maxTimeoutSeconds: 60,
  extra: { feePayer },
};
const transaction = await buildPaymentTransaction(
  {
    source: setup.budgetAccount,
    mint: usdc.mint,
    decimals: 6,
    payTo: treasury.address,
    amount: 10_000n,
    feePayer,
    memo: `aperture-spike:${principalId}`,
  },
  delegate,
  await rpc.getLatestBlockhash(),
);
const body = JSON.stringify({
  x402Version: X402_VERSION,
  paymentPayload: { x402Version: X402_VERSION, accepted: requirement, payload: { transaction } },
  paymentRequirements: requirement,
});
const verify = await fetch(`${facilitator}/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
const verified = (await verify.json()) as { isValid?: boolean; invalidReason?: string };
step(`verify → HTTP ${String(verify.status)} ${JSON.stringify(verified)}`);
if (verify.status >= 500) {
  stdout.write('INCONCLUSIVE: the facilitator had a temporary error; run the spike again later.\n');
  exit(3);
}
if (verified.isValid !== true) {
  stdout.write('OUTCOME B: the facilitator rejects delegate-signed transfers (see ADR 0018 fallbacks).\n');
  exit(2);
}
if (values.settle) {
  const settle = await fetch(`${facilitator}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  step(`settle → HTTP ${String(settle.status)} ${await settle.text()}`);
}
stdout.write('OUTCOME A: delegate-signed transfers are accepted. The design stands.\n');
