import { Hono } from 'hono';
import { ASSETS, CAIP2, decodePaymentSignature, verifyPaymentTransaction, type SolanaNetwork } from '@aperture/x402';

/*
 * A local x402 seller (plan/phases/phase-09 §9.6). It answers 402 with a PAYMENT-REQUIRED
 * header, and accepts a PAYMENT-SIGNATURE whose transaction passes the Path 1 rules (the same
 * checks a facilitator makes). It can misbehave on purpose so tests prove Aperture refuses.
 * It does not submit to Solana: `onPaid` receives the verified transaction instead.
 */

export interface SellerOptions {
  payTo: string;
  feePayer: string;
  /** Atomic units (USDC has 6 decimals: 10000 = 0.01 USDC). */
  price: bigint;
  network?: SolanaNetwork;
  /** Ask to be paid somewhere else than `payTo` (X1). */
  evilPayTo?: string | undefined;
  /** Ask for 100× the price (over any sane cap). */
  inflate?: boolean;
  /** Take the payment, then answer 500 (settled but undelivered, X5). */
  failAfterPayment?: boolean;
  onPaid?: (transaction: string) => void | Promise<void>;
}

export function buildSeller(options: SellerOptions) {
  const network = options.network ?? 'devnet';
  const asset = ASSETS[network][0];
  if (asset === undefined) throw new Error('no asset for network');
  const requirement = () => ({
    scheme: 'exact',
    network: CAIP2[network],
    amount: (options.inflate === true ? options.price * 100n : options.price).toString(),
    asset: asset.mint,
    payTo: options.evilPayTo ?? options.payTo,
    maxTimeoutSeconds: 60,
    extra: { feePayer: options.feePayer },
  });
  const app = new Hono();
  app.all('/paid', async (c) => {
    const header = c.req.header('payment-signature');
    if (header === undefined) {
      const required = {
        x402Version: 2,
        error: 'payment required',
        resource: { url: c.req.url, description: 'a priced test resource' },
        accepts: [requirement()],
      };
      return c.json(required, 402, { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(required)).toString('base64') });
    }
    let payload;
    try {
      payload = decodePaymentSignature(header);
    } catch {
      return c.json({ error: 'invalid payment payload' }, 402);
    }
    const expected = requirement();
    const verified = await verifyPaymentTransaction(payload.transaction, {
      payTo: expected.payTo,
      mint: expected.asset,
      amount: BigInt(expected.amount),
      feePayer: expected.extra.feePayer,
      decimals: asset.decimals,
    });
    if (!verified.ok) return c.json({ error: `payment rejected: ${verified.reason}` }, 402);
    await options.onPaid?.(payload.transaction);
    if (options.failAfterPayment === true) return c.json({ error: 'upstream exploded after payment' }, 500);
    return c.json({ data: 'the paid content', paidBy: verified.authority });
  });
  return app;
}
