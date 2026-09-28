import { randomBytes } from 'node:crypto';
import type { ApertureError } from '@aperture/sdk';
import { Aperture, BudgetExceededError, PolicyDeniedError } from '@aperture/sdk';
import { keyRingFromEnv } from '@aperture/crypto';
import { eq, schema } from '@aperture/db';
import { buildSignerApp, createDelegateKey } from '@aperture/signer';
import { ASSETS, budgetAccountAddress, solanaRpc, verifyPaymentTransaction } from '@aperture/x402';
import { fakeRpc, newAddress } from '@aperture/x402/testing';
import { createLogger } from '@aperture/runtime';
import { buildSeller, type SellerOptions } from 'x402-test-seller';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpSigner } from '../src/x402';
import { createGatewayHarness, gateway, seedGatewayOrg, type GatewayHarness } from './harness';

let h: GatewayHarness;
beforeAll(async () => {
  h = await createGatewayHarness();
});
afterAll(async () => {
  await h.close();
});

const USDC = ASSETS.devnet[0] ?? { asset: 'USDC' as const, mint: '', decimals: 6 };
const SHARED = 'test-shared-secret-at-least-32-characters';
const signerRing = keyRingFromEnv({ APERTURE_KEK_V1: randomBytes(32).toString('base64') });
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';

/** An org with a devnet Solana connection and an active budget account for the agent. */
async function setup(options: { agentBudget?: string; maxPerPayment?: bigint } = {}) {
  const org = await seedGatewayOrg(h, { agent: options.agentBudget ?? '1' });
  const treasury = await newAddress();
  const connectionId = crypto.randomUUID();
  await h.system.db.insert(schema.connections).values({
    id: connectionId,
    orgId: org.org.id,
    provider: 'solana',
    name: 'Solana (devnet)',
    secret: {},
    config: { network: 'devnet', treasury, assets: ['USDC'] },
  });
  const accountId = crypto.randomUUID();
  const budgetAccount = await budgetAccountAddress(treasury, org.agent.id, USDC.mint);
  await h.system.db.insert(schema.x402Accounts).values({
    id: accountId,
    orgId: org.org.id,
    principalId: org.agent.id,
    connectionId,
    network: 'devnet',
    asset: 'USDC',
    mint: USDC.mint,
    decimals: 6,
    treasury,
    budgetAccount,
    maxPerPayment: options.maxPerPayment ?? 500_000n,
    status: 'active',
  });

  // The chain as the signer sees it; tests change it (e.g. the treasury revokes).
  const chain = { delegate: '' as string | null, delegatedAmount: 5_000_000n, amount: 5_000_000n };
  const rpc = fakeRpc({
    getAccountInfo: () => ({
      value: {
        data: {
          parsed: {
            info: {
              mint: USDC.mint,
              owner: treasury,
              tokenAmount: { amount: chain.amount.toString() },
              delegate: chain.delegate,
              delegatedAmount: { amount: chain.delegatedAmount.toString() },
              state: 'initialized',
            },
          },
        },
      },
    }),
    getLatestBlockhash: () => ({ value: { blockhash: BLOCKHASH, lastValidBlockHeight: 5000 } }),
  });
  const signerDeps = { db: h.app.db, ring: signerRing, rpcFor: () => solanaRpc(['https://rpc.test'], rpc.fetch) };
  chain.delegate = await createDelegateKey(signerDeps, { orgId: org.org.id, accountId });
  const signerApp = buildSignerApp(createLogger({ service: 'signer-test', level: 'silent' }), {
    ...signerDeps,
    sharedSecret: SHARED,
  });
  const signer = httpSigner('http://signer.internal', SHARED, (input, init) =>
    Promise.resolve(signerApp.request(input instanceof Request ? input.url : input.toString(), init)),
  );
  const { app } = gateway(h, {}, { signer });

  const payTo = await newAddress();
  const feePayer = await newAddress();
  const paid: string[] = [];
  const seller = (extra: Partial<SellerOptions> = {}) =>
    buildSeller({ payTo, feePayer, price: 10_000n, onPaid: (tx) => void paid.push(tx), ...extra });
  let current = seller();
  const client = new Aperture({
    apiKey: org.key,
    baseUrl: 'http://gateway.test',
    fetch: (input, init) => {
      const url = String(input);
      return Promise.resolve(
        url.startsWith('http://seller.test')
          ? current.request(url.slice('http://seller.test'.length), init)
          : app.request(url.slice('http://gateway.test'.length), init),
      );
    },
  });
  return {
    ...org,
    accountId,
    budgetAccount,
    chain,
    client,
    paid,
    payTo,
    feePayer,
    useSeller: (extra: Partial<SellerOptions>) => {
      current = seller(extra);
    },
  };
}

async function paymentsOf(orgId: string) {
  return h.system.db.select().from(schema.x402Payments).where(eq(schema.x402Payments.orgId, orgId));
}

describe('x402 through the gateway (Phase 9)', () => {
  it('pays a 402 with a delegate-signed transfer the seller accepts, and records delivery', async () => {
    const org = await setup();
    const response = await org.client.x402Fetch('http://seller.test/paid');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: 'the paid content', paidBy: org.chain.delegate });

    const [payment] = await paymentsOf(org.org.id);
    expect(payment).toMatchObject({ status: 'signed', amount: 10_000n, payTo: org.payTo, deliveredStatus: 200 });
    const [hold] = await h.system.db
      .select()
      .from(schema.holds)
      .where(eq(schema.holds.id, payment?.holdId ?? ''));
    expect(hold).toMatchObject({ status: 'open', amount: 10_000n, rail: 'x402' });

    // The signed bytes pay exactly the seller, from the budget account, with our memo.
    const verified = await verifyPaymentTransaction(org.paid[0] ?? '', {
      payTo: org.payTo,
      mint: USDC.mint,
      amount: 10_000n,
      feePayer: org.feePayer,
      source: org.budgetAccount,
      memo: payment?.memo ?? '',
    });
    expect(verified.ok).toBe(true);
    const payees = await h.system.db.select().from(schema.x402Payees).where(eq(schema.x402Payees.orgId, org.org.id));
    expect(payees).toMatchObject([{ status: 'active', payTo: org.payTo }]);
  });

  it('refuses a seller that switches its payTo (X1) and one that inflates the price', async () => {
    const org = await setup();
    expect((await org.client.x402Fetch('http://seller.test/paid')).status).toBe(200);
    org.useSeller({ evilPayTo: await newAddress() });
    const switched = await org.client.x402Fetch('http://seller.test/paid').catch((error: unknown) => error);
    expect(switched).toBeInstanceOf(PolicyDeniedError);
    expect((switched as PolicyDeniedError).details).toMatchObject({ reason: 'payee_mismatch' });
    const pending = await h.system.db.select().from(schema.x402Payees).where(eq(schema.x402Payees.orgId, org.org.id));
    expect(pending.map((p) => p.status).sort()).toEqual(['active', 'pending']);

    org.useSeller({ inflate: true });
    const inflated = await org.client.x402Fetch('http://seller.test/paid').catch((error: unknown) => error);
    expect((inflated as ApertureError).details).toMatchObject({ reason: 'amount_over_cap' });
    expect(org.paid).toHaveLength(1);
  });

  it('respects the Aperture budget, and the on-chain allowance the treasury controls', async () => {
    const poor = await setup({ agentBudget: '0.005' });
    expect(await poor.client.x402Fetch('http://seller.test/paid').catch((e: unknown) => e)).toBeInstanceOf(
      BudgetExceededError,
    );

    const org = await setup();
    org.chain.delegate = null; // the treasury revoked the agent in its wallet
    const revoked = await org.client.x402Fetch('http://seller.test/paid').catch((e: unknown) => e);
    expect((revoked as ApertureError).details).toMatchObject({ reason: 'delegate_revoked' });
    const [payment] = await paymentsOf(org.org.id);
    expect(payment?.status).toBe('failed');
    const [hold] = await h.system.db
      .select()
      .from(schema.holds)
      .where(eq(schema.holds.id, payment?.holdId ?? ''));
    expect(hold?.status).toBe('released');
    expect(org.paid).toHaveLength(0);
  });

  it('records paid-but-undelivered responses (X5)', async () => {
    const org = await setup();
    org.useSeller({ failAfterPayment: true });
    expect((await org.client.x402Fetch('http://seller.test/paid')).status).toBe(500);
    const [payment] = await paymentsOf(org.org.id);
    expect(payment).toMatchObject({ status: 'signed', deliveredStatus: 500 });
  });

  it('refuses agents without a budget account', async () => {
    const org = await seedGatewayOrg(h);
    const { app } = gateway(h, {}, { signer: httpSigner('http://nowhere', SHARED) });
    const response = await app.request('/v1/x402/authorize', {
      method: 'POST',
      headers: { authorization: `Bearer ${org.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://seller.test/paid', paymentRequired: {} }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'aperture_policy_denied', reason: 'no_budget_account' },
    });
  });
});
