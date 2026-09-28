import { eq, schema } from '@aperture/db';
import { newAddress } from '@aperture/x402/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, joinAs, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

let counter = 0;
const email = (label: string) => `${label}-x402-${String((counter += 1))}@example.com`;
const post = (path: string, cookie: string, payload: unknown = {}) =>
  h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });

/** Solana RPC as the fake provider: one JSON-RPC endpoint answering by method. */
function fakeSolana(chain: { delegate: string | null; delegated: string; amount: string; mint: string }) {
  return h.provider({
    'POST /': (call) => {
      const { id, method } = call.body as { id: number; method: string };
      const result =
        method === 'getLatestBlockhash'
          ? { value: { blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k', lastValidBlockHeight: 100 } }
          : method === 'getMinimumBalanceForRentExemption'
            ? 2_039_280
            : method === 'getAccountInfo'
              ? {
                  value: {
                    data: {
                      parsed: {
                        info: {
                          mint: chain.mint,
                          owner: 'treasury',
                          tokenAmount: { amount: chain.amount },
                          delegate: chain.delegate,
                          delegatedAmount: { amount: chain.delegated },
                        },
                      },
                    },
                  },
                }
              : null;
      return Response.json({ jsonrpc: '2.0', id, result });
    },
  });
}

describe('crypto rail in the dashboard (Phase 9)', () => {
  it('connects Solana, sets up an agent budget account for the treasury to sign, and activates it from chain', async () => {
    const owner = await signUp(h, email('owner'));
    const orgId = await createOrg(h, owner);
    const base = `/api/v1/orgs/${orgId}`;
    const treasury = await newAddress();

    const mainnet = await h.request(`${base}/x402/connection`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ network: 'mainnet', treasury }),
    });
    expect(mainnet.status).toBe(400);
    const connected = await h.request(`${base}/x402/connection`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ network: 'devnet', treasury, rpcUrls: ['https://rpc.test/'], anchorAudit: true }),
    });
    expect(connected.status).toBe(204);
    expect(await body(await h.request(`${base}/x402/connection`, { cookie: owner }))).toMatchObject({
      connected: true,
      network: 'devnet',
      treasury,
      assets: ['USDC'],
      customRpc: true,
      anchorAudit: true,
      signerAvailable: true,
    });

    const agent = await body<{ id: string }>(await post(`${base}/agents`, owner, { name: 'buyer' }));
    const chain = {
      delegate: null as string | null,
      delegated: '0',
      amount: '0',
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    };
    fakeSolana(chain);
    const created = await post(`${base}/agents/${agent.id}/x402/account`, owner, {
      float: '5',
      allowance: '5',
      maxPerPayment: '0.5',
    });
    expect(created.status).toBe(201);
    const { account, transaction } = await body<{
      account: { id: string; delegate: string; status: string };
      transaction: string;
    }>(created);
    expect(account.status).toBe('pending_setup');
    expect(account.delegate).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(Buffer.from(transaction, 'base64').length).toBeGreaterThan(200);
    // The delegate's secret never leaves the signer.
    expect(JSON.stringify(await body(await h.request(`${base}/x402/accounts`, { cookie: owner })))).not.toContain(
      'delegateSecret',
    );

    // Before the treasury signs, syncing leaves it pending; after, it is active with the allowance.
    expect(await body(await post(`${base}/x402/accounts/${account.id}/sync`, owner))).toMatchObject({
      status: 'pending_setup',
    });
    Object.assign(chain, { delegate: account.delegate, delegated: '5000000', amount: '5000000' });
    expect(await body(await post(`${base}/x402/accounts/${account.id}/sync`, owner))).toMatchObject({
      status: 'active',
      allowance: '5.00',
      balance: '5.00',
      maxPerPayment: '0.50',
    });

    const topUp = await post(`${base}/x402/accounts/${account.id}/top-up`, owner, { add: '2', allowance: '7' });
    expect(topUp.status).toBe(200);

    // A payee change waits for Finance (X1).
    await h.system.db.insert(schema.x402Payees).values([
      {
        id: crypto.randomUUID(),
        orgId,
        origin: 'https://api.seller',
        payTo: await newAddress(),
        network: 'devnet',
        status: 'active',
      },
      {
        id: crypto.randomUUID(),
        orgId,
        origin: 'https://api.seller',
        payTo: await newAddress(),
        network: 'devnet',
        status: 'pending',
      },
    ]);
    const payees = await body<{ payees: { id: string; status: string }[] }>(
      await h.request(`${base}/x402/payees`, { cookie: owner }),
    );
    const pending = payees.payees.find((p) => p.status === 'pending');
    const finance = await joinAs(h, { ownerCookie: owner, orgId, email: email('finance'), role: 'finance' });
    expect((await post(`${base}/x402/payees/${pending?.id ?? ''}/approve`, finance)).status).toBe(204);
    const after = await h.system.db.select().from(schema.x402Payees).where(eq(schema.x402Payees.orgId, orgId));
    expect(after.find((p) => p.id === pending?.id)?.status).toBe('active');
    expect(after.filter((p) => p.status === 'active')).toHaveLength(1);

    const revoked = await post(`${base}/x402/accounts/${account.id}/revoke`, owner, { sweep: true });
    expect(revoked.status).toBe(200);
    const [row] = await h.system.db.select().from(schema.x402Accounts).where(eq(schema.x402Accounts.id, account.id));
    expect(row?.status).toBe('revoked');
    expect(await body(await h.request(`${base}/audit/anchors`, { cookie: owner }))).toEqual({ anchors: [] });
  });
});
