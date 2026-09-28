import { generateKeyPairSigner } from '@solana/kit';
import { CAIP2, ASSETS, type SolanaNetwork } from '../src/networks';
import type { RpcFetch } from '../src/rpc';

/*
 * Test doubles for x402 (no validator or facilitator is available in CI): payment
 * requirements shaped like the spec, fresh addresses, and a scriptable Solana RPC.
 */

export async function newAddress(): Promise<string> {
  return (await generateKeyPairSigner()).address;
}

export function paymentRequired(input: {
  payTo: string;
  feePayer: string;
  amount: string;
  network?: SolanaNetwork;
  asset?: string;
  url?: string;
  timeout?: number;
}) {
  const network = input.network ?? 'devnet';
  return {
    x402Version: 2,
    error: 'payment required',
    resource: { url: input.url ?? 'http://localhost:4021/paid', description: 'test resource' },
    accepts: [
      {
        scheme: 'exact',
        network: CAIP2[network],
        amount: input.amount,
        asset: input.asset ?? ASSETS[network][0]?.mint ?? '',
        payTo: input.payTo,
        maxTimeoutSeconds: input.timeout ?? 60,
        extra: { feePayer: input.feePayer },
      },
    ],
  };
}

export const encodeHeader = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

type Handler = (params: unknown[]) => unknown;

/** A JSON-RPC server in memory: `handlers[method](params)` returns the `result`. */
export function fakeRpc(handlers: Record<string, Handler>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fetch: RpcFetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { id: number; method: string; params: unknown[] };
    calls.push({ method: body.method, params: body.params });
    const handler = handlers[body.method];
    if (handler === undefined)
      return Response.json({ jsonrpc: '2.0', id: body.id, error: { message: `no fake for ${body.method}` } });
    return Response.json({ jsonrpc: '2.0', id: body.id, result: await handler(body.params) });
  };
  return { fetch, calls };
}

/** A jsonParsed transaction paying `amount` out of `source` with `memo`, as getTransaction returns. */
export function parsedPayment(input: {
  signature: string;
  source: string;
  destination: string;
  authority: string;
  amount: bigint;
  memo?: string;
  mint: string;
}) {
  return {
    slot: 1,
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null },
    transaction: {
      signatures: [input.signature],
      message: {
        instructions: [
          { program: 'compute-budget', programId: 'ComputeBudget111111111111111111111111111111' },
          {
            program: 'spl-token',
            parsed: {
              type: 'transferChecked',
              info: {
                source: input.source,
                destination: input.destination,
                authority: input.authority,
                mint: input.mint,
                tokenAmount: { amount: input.amount.toString(), decimals: 6 },
              },
            },
          },
          ...(input.memo === undefined ? [] : [{ program: 'spl-memo', parsed: input.memo }]),
        ],
      },
    },
  };
}
