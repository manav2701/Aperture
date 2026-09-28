import { randomBytes } from 'node:crypto';
import { keyRingFromEnv } from '@aperture/crypto';
import { connect, eq, reserve, schema, type DatabaseHandle } from '@aperture/db';
import { appRoleUrl, createTestDatabase, seedTree } from '@aperture/db/testing';
import { createLogger } from '@aperture/runtime';
import { ASSETS, solanaRpc } from '@aperture/x402';
import { fakeRpc, newAddress } from '@aperture/x402/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createDelegateKey } from './signer';

let system: DatabaseHandle & { url: string };
let app: DatabaseHandle;
beforeAll(async () => {
  system = await createTestDatabase();
  app = connect(appRoleUrl(system.url));
});
afterAll(async () => {
  await app.close();
  await system.close();
});

const SECRET = 'signer-shared-secret-at-least-32-chars';
const mint = ASSETS.devnet[0]?.mint ?? '';

async function setup() {
  const tree = await seedTree(system.db, { agent: '10' });
  const connectionId = crypto.randomUUID();
  await system.db.insert(schema.connections).values({
    id: connectionId,
    orgId: tree.org.id,
    provider: 'solana',
    name: 'Solana',
    secret: {},
    config: { network: 'devnet' },
  });
  const accountId = crypto.randomUUID();
  await system.db.insert(schema.x402Accounts).values({
    id: accountId,
    orgId: tree.org.id,
    principalId: tree.agent.id,
    connectionId,
    network: 'devnet',
    asset: 'USDC',
    mint,
    decimals: 6,
    treasury: await newAddress(),
    budgetAccount: await newAddress(),
    maxPerPayment: 1_000_000n,
    status: 'active',
  });
  const state = { delegate: '' };
  const rpc = fakeRpc({
    getAccountInfo: () => ({
      value: {
        data: {
          parsed: {
            info: {
              mint,
              owner: 'x',
              tokenAmount: { amount: '5000000' },
              delegate: state.delegate,
              delegatedAmount: { amount: '5000000' },
            },
          },
        },
      },
    }),
    getLatestBlockhash: () => ({
      value: { blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k', lastValidBlockHeight: 99 },
    }),
  });
  const deps = {
    db: app.db,
    ring: keyRingFromEnv({ APERTURE_KEK_V1: randomBytes(32).toString('base64') }),
    rpcFor: () => solanaRpc(['https://rpc.test'], rpc.fetch),
  };
  state.delegate = await createDelegateKey(deps, { orgId: tree.org.id, accountId });
  const signer = buildApp(createLogger({ service: 'signer-test', level: 'silent' }), { ...deps, sharedSecret: SECRET });
  const payment = async (holdAmount: bigint | null) => {
    const id = crypto.randomUUID();
    let holdId: string | null = null;
    if (holdAmount !== null) {
      const reserved = await reserve(system.db, {
        orgId: tree.org.id,
        principalId: tree.agent.id,
        rail: 'x402',
        amount: holdAmount,
        idempotencyKey: `x402:${id}`,
        ttlSeconds: 600,
        onExpiry: 'reconcile',
        externalRef: id,
      });
      if (!reserved.ok) throw new Error('reserve failed');
      holdId = reserved.hold.id;
    }
    await system.db.insert(schema.x402Payments).values({
      id,
      orgId: tree.org.id,
      principalId: tree.agent.id,
      accountId,
      holdId,
      url: 'http://seller/paid',
      origin: 'http://seller',
      payTo: await newAddress(),
      feePayer: await newAddress(),
      amount: 10_000n,
      memo: `aperture:${id}`,
      requirement: {},
    });
    return id;
  };
  const sign = (paymentId: string, secret = SECRET) =>
    signer.request('/v1/sign', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: tree.org.id, paymentId }),
    });
  return { tree, payment, sign, state };
}

describe('signer (X7, X8, X11)', () => {
  it('signs only with the shared secret, for an open hold matching the payment', async () => {
    const org = await setup();
    const good = await org.payment(10_000n);
    expect((await org.sign(good, 'wrong-secret-wrong-secret-wrong-secret')).status).toBe(401);
    const signed = await org.sign(good);
    expect(signed.status).toBe(200);
    expect(await signed.json()).toMatchObject({ lastValidBlockHeight: '99' });
    // Signed once: a second request for the same payment is refused.
    expect(await (await org.sign(good)).json()).toMatchObject({ error: 'not_authorized' });

    expect(await (await org.sign(await org.payment(null))).json()).toMatchObject({ error: 'no_open_hold' });
    expect(await (await org.sign(await org.payment(20_000n))).json()).toMatchObject({ error: 'intent_mismatch' });
    const [row] = await system.db.select().from(schema.x402Payments).where(eq(schema.x402Payments.id, good));
    expect(row?.status).toBe('signed');
  });
});
