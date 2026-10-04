import { generateKeyPairSigner } from '@solana/kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ASSETS,
  CAIP2,
  X402Error,
  acceptRequirement,
  budgetAccountAddress,
  buildPaymentTransaction,
  buildSetupTransaction,
  decodePaymentRequired,
  decodePaymentSignature,
  depegReason,
  encodePaymentSignature,
  fetchStablecoinPrices,
  paymentsOutOf,
  solanaRpc,
  verifyPaymentTransaction,
} from '../src/index';
import { encodeHeader, fakeRpc, newAddress, parsedPayment, paymentRequired } from './fakes';

const USDC = ASSETS.devnet[0];
if (USDC === undefined) throw new Error('devnet USDC missing');
const context = { network: 'devnet' as const, assets: [USDC], maxAtomic: 1_000_000n };
const lifetime = { blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k', lastValidBlockHeight: 1_000n };

describe('payment requirements (X1–X3)', () => {
  it('decodes the header and accepts only Solana exact in a configured stablecoin under the cap', async () => {
    const payTo = await newAddress();
    const feePayer = await newAddress();
    const header = encodeHeader(paymentRequired({ payTo, feePayer, amount: '10000' }));
    const accepted = acceptRequirement(decodePaymentRequired(header), context);
    expect(accepted).toMatchObject({ amount: 10_000n, payTo, feePayer, asset: { asset: 'USDC' } });

    const reject = (overrides: Parameters<typeof paymentRequired>[0], code: string, ctx = context) => {
      expect(() => acceptRequirement(decodePaymentRequired(paymentRequired(overrides)), ctx)).toThrow(
        expect.objectContaining({ code }) as Error,
      );
    };
    reject({ payTo, feePayer, amount: '10000', network: 'mainnet' }, 'wrong_network');
    reject({ payTo, feePayer, amount: '10000', asset: await newAddress() }, 'asset_not_allowed');
    reject({ payTo, feePayer, amount: '2000000' }, 'amount_over_cap');
    reject({ payTo, feePayer: payTo, amount: '1' }, 'invalid_fee_payer');
    reject({ payTo, feePayer, amount: '1', timeout: 3600 }, 'timeout_too_long');
    expect(() => decodePaymentRequired({ x402Version: 1, accepts: [] })).toThrow(X402Error);
    expect(() => decodePaymentRequired('%%%')).toThrow(X402Error);
  });
});

describe('payment transaction (Path 1, X14)', () => {
  it('builds a delegate-signed transfer that our verifier accepts, and rejects tampering', async () => {
    const delegate = await generateKeyPairSigner();
    const payTo = await newAddress();
    const feePayer = await newAddress();
    const source = await newAddress();
    const intent = {
      source,
      mint: USDC.mint,
      decimals: 6,
      payTo,
      amount: 12_345n,
      feePayer,
      memo: 'ap-0123456789abcdef',
    };
    const transaction = await buildPaymentTransaction(intent, delegate, lifetime);
    const verified = await verifyPaymentTransaction(transaction, { ...intent, authority: delegate.address });
    expect(verified).toMatchObject({
      ok: true,
      amount: 12_345n,
      source,
      authority: delegate.address,
      memo: intent.memo,
    });

    expect(await verifyPaymentTransaction(transaction, { ...intent, amount: 12_346n })).toMatchObject({
      ok: false,
      reason: 'wrong amount',
    });
    expect(await verifyPaymentTransaction(transaction, { ...intent, payTo: await newAddress() })).toMatchObject({
      ok: false,
    });
    expect(await verifyPaymentTransaction(transaction, { ...intent, feePayer: await newAddress() })).toMatchObject({
      ok: false,
    });
    expect(await verifyPaymentTransaction(transaction, { ...intent, memo: 'other' })).toMatchObject({ ok: false });

    // Flip one byte of the signed message: the delegate signature no longer verifies.
    const bytes = Buffer.from(transaction, 'base64');
    bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 0xff;
    expect((await verifyPaymentTransaction(bytes.toString('base64'), intent)).ok).toBe(false);

    // The payload round-trips through the PAYMENT-SIGNATURE header.
    const accepted = paymentRequired({ payTo, feePayer, amount: '12345' }).accepts[0];
    if (accepted === undefined) throw new Error('fixture');
    const header = encodePaymentSignature({ resourceUrl: 'http://x/paid', accepted, transaction });
    expect(decodePaymentSignature(header).transaction).toBe(transaction);
  });

  it('INV-12: a signature exists iff every check passes, and every one produced passes the verifier', async () => {
    const delegate = await generateKeyPairSigner();
    const addresses = await Promise.all(Array.from({ length: 4 }, () => newAddress()));
    const [payTo = '', feePayer = '', source = '', other = ''] = addresses;
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          network: fc.constantFrom('devnet', 'mainnet'),
          asset: fc.constantFrom(USDC.mint, other),
          amount: fc.oneof(fc.bigInt({ min: 0n, max: 3_000_000n }).map(String), fc.constantFrom('-1', 'abc', '')),
          feePayer: fc.constantFrom(feePayer, payTo, 'not-an-address'),
          scheme: fc.constantFrom('exact', 'upto'),
          timeout: fc.integer({ min: 1, max: 1000 }),
        }),
        async (input) => {
          const required = {
            x402Version: 2,
            accepts: [
              {
                scheme: input.scheme,
                network: CAIP2[input.network],
                amount: input.amount,
                asset: input.asset,
                payTo,
                maxTimeoutSeconds: input.timeout,
                extra: { feePayer: input.feePayer },
              },
            ],
          };
          const allChecksPass =
            input.scheme === 'exact' &&
            input.network === 'devnet' &&
            input.asset === USDC.mint &&
            /^\d+$/.test(input.amount) &&
            BigInt(input.amount) > 0n &&
            BigInt(input.amount) <= context.maxAtomic &&
            input.feePayer === feePayer &&
            input.timeout <= 300;
          let signed: string | undefined;
          try {
            const accepted = acceptRequirement(decodePaymentRequired(required), context);
            signed = await buildPaymentTransaction(
              {
                source,
                mint: accepted.asset.mint,
                decimals: 6,
                payTo,
                amount: accepted.amount,
                feePayer: accepted.feePayer,
                memo: 'n',
              },
              delegate,
              lifetime,
            );
          } catch (error) {
            if (!(error instanceof X402Error)) throw error;
          }
          expect(signed !== undefined).toBe(allChecksPass);
          if (signed !== undefined) {
            const verified = await verifyPaymentTransaction(signed, {
              payTo,
              mint: USDC.mint,
              amount: BigInt(input.amount),
              feePayer,
            });
            expect(verified.ok).toBe(true);
          }
        },
      ),
      { numRuns: Number(process.env.PROPERTY_RUNS ?? 200) },
    );
  });

  it('never accepts garbage as a transaction', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 400 }), async (bytes) => {
        const result = await verifyPaymentTransaction(Buffer.from(bytes).toString('base64'), {
          payTo: USDC.mint,
          mint: USDC.mint,
          amount: 1n,
          feePayer: USDC.mint,
        });
        expect(result.ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe('budget accounts and RPC', () => {
  it('derives a stable budget account and builds a treasury-signed setup transaction', async () => {
    const treasury = await newAddress();
    const delegate = await newAddress();
    const first = await budgetAccountAddress(treasury, 'agent-1', USDC.mint);
    expect(await budgetAccountAddress(treasury, 'agent-1', USDC.mint)).toBe(first);
    expect(await budgetAccountAddress(treasury, 'agent-2', USDC.mint)).not.toBe(first);
    const setup = await buildSetupTransaction(
      {
        treasury,
        principalId: 'agent-1',
        mint: USDC.mint,
        decimals: 6,
        delegate,
        float: 5_000_000n,
        allowance: 5_000_000n,
        rentLamports: 2_039_280n,
      },
      lifetime,
    );
    expect(setup.budgetAccount).toBe(first);
    expect(Buffer.from(setup.transaction, 'base64').length).toBeGreaterThan(200);
  });

  it('falls back to the next RPC provider and parses payments out of an account', async () => {
    const down: typeof fetch = () => Promise.resolve(new Response('bad gateway', { status: 502 }));
    const up = fakeRpc({ getBlockHeight: () => 42 });
    let calls = 0;
    const rpc = solanaRpc(['https://primary', 'https://backup'], (url, init) => {
      calls += 1;
      return url === 'https://primary' ? down(url, init) : up.fetch(url, init);
    });
    expect(await rpc.getBlockHeight()).toBe(42n);
    expect(calls).toBe(2);

    const tx = parsedPayment({
      signature: 's1',
      source: 'SRC',
      destination: 'DST',
      authority: 'DEL',
      amount: 5n,
      memo: 'ap-1',
      mint: USDC.mint,
    });
    expect(paymentsOutOf(tx, 'SRC')).toEqual([{ destination: 'DST', authority: 'DEL', amount: 5n, memo: 'ap-1' }]);
    expect(paymentsOutOf(tx, 'OTHER')).toEqual([]);
  });

  it('reads stablecoin prices and refuses depegged or stale stablecoins (X13)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const prices = await fetchStablecoinPrices(() =>
      Promise.resolve(
        Response.json({
          'usd-coin': { usd: 0.9999, last_updated_at: now },
          tether: { usd: 0.95, last_updated_at: now },
        }),
      ),
    );
    const usdc = prices.find((p) => p.asset === 'USDC');
    const usdt = prices.find((p) => p.asset === 'USDT');
    expect(usdc?.micros).toBe(999_900n);
    expect(depegReason(usdc)).toBeUndefined();
    expect(depegReason(usdt)).toMatch(/off its peg/);
    expect(depegReason(undefined)).toMatch(/no recent price/);
    expect(depegReason({ micros: 1_000_000n, publishedAt: new Date(Date.now() - 2 * 3_600_000) })).toMatch(/stale/);
  });
});
