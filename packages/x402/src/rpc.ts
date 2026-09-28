/*
 * A small Solana JSON-RPC client with provider fallback (X12). Only the calls Aperture needs,
 * over plain fetch so tests can script it. Any RPC failure moves to the next URL; if every
 * provider fails, the caller fails closed.
 */

export type RpcFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class RpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

export interface TokenAccountState {
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  state: string;
}

interface ParsedInstruction {
  program?: string;
  programId?: string;
  parsed?: unknown;
}

export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown } | null;
  transaction: { message: { instructions: ParsedInstruction[] }; signatures: string[] };
}

export interface SolanaRpc {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  getBlockHeight(): Promise<bigint>;
  getMinimumBalanceForRentExemption(space: number): Promise<bigint>;
  getTokenAccount(account: string): Promise<TokenAccountState | null>;
  getSignaturesForAddress(
    account: string,
    options?: { until?: string; limit?: number },
  ): Promise<{ signature: string; err: unknown }[]>;
  getTransaction(signature: string): Promise<ParsedTransaction | null>;
  sendTransaction(base64: string): Promise<string>;
}

export function solanaRpc(
  urls: readonly string[],
  fetchImpl: RpcFetch = (input, init) => fetch(input, init),
): SolanaRpc {
  if (urls.length === 0) throw new RpcError('no_rpc', 'no RPC URL configured');
  let id = 0;
  const call = async <T>(method: string, params: unknown[]): Promise<T> => {
    let last: unknown;
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new RpcError('http', `RPC answered ${String(response.status)}`);
        const body = (await response.json()) as { result?: T; error?: { message?: string } };
        if (body.error !== undefined) throw new RpcError('rpc', body.error.message ?? 'RPC error');
        return body.result as T;
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof RpcError ? last : new RpcError('unreachable', 'every RPC provider failed');
  };

  return {
    async getLatestBlockhash() {
      const result = await call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [
        { commitment: 'confirmed' },
      ]);
      return { blockhash: result.value.blockhash, lastValidBlockHeight: BigInt(result.value.lastValidBlockHeight) };
    },
    async getBlockHeight() {
      return BigInt(await call<number>('getBlockHeight', [{ commitment: 'confirmed' }]));
    },
    async getMinimumBalanceForRentExemption(space) {
      return BigInt(await call<number>('getMinimumBalanceForRentExemption', [space]));
    },
    async getTokenAccount(account) {
      const result = await call<{
        value: { data: { parsed?: { info?: Record<string, unknown> } } } | null;
      }>('getAccountInfo', [account, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      const info = result.value?.data.parsed?.info;
      if (info === undefined) return null;
      const amountOf = (value: unknown) => BigInt((value as { amount?: string } | undefined)?.amount ?? '0');
      return {
        mint: String(info.mint),
        owner: String(info.owner),
        amount: amountOf(info.tokenAmount),
        delegate: typeof info.delegate === 'string' ? info.delegate : null,
        delegatedAmount: amountOf(info.delegatedAmount),
        state: typeof info.state === 'string' ? info.state : 'initialized',
      };
    },
    async getSignaturesForAddress(account, options = {}) {
      return call<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [
        account,
        {
          limit: options.limit ?? 100,
          ...(options.until === undefined ? {} : { until: options.until }),
          commitment: 'confirmed',
        },
      ]);
    },
    async getTransaction(signature) {
      return call<ParsedTransaction | null>('getTransaction', [
        signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ]);
    },
    async sendTransaction(base64) {
      return call<string>('sendTransaction', [base64, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    },
  };
}

/** The TransferChecked and memo in a parsed transaction, if it pays out of `source`. */
export function paymentsOutOf(transaction: ParsedTransaction, source: string) {
  const instructions = transaction.transaction.message.instructions;
  const memos = instructions
    .filter((ix) => ix.program === 'spl-memo' && typeof ix.parsed === 'string')
    .map((ix) => ix.parsed as string);
  return instructions
    .filter((ix) => ix.program === 'spl-token')
    .map((ix) => ix.parsed as { type?: string; info?: Record<string, unknown> } | undefined)
    .filter(
      (parsed) => (parsed?.type === 'transferChecked' || parsed?.type === 'transfer') && parsed.info?.source === source,
    )
    .map((parsed) => {
      const info = parsed?.info ?? {};
      const tokenAmount = info.tokenAmount as { amount?: string } | undefined;
      return {
        destination: String(info.destination),
        authority:
          typeof info.authority === 'string'
            ? info.authority
            : typeof info.multisigAuthority === 'string'
              ? info.multisigAuthority
              : '',
        amount: BigInt(tokenAmount?.amount ?? (typeof info.amount === 'string' ? info.amount : '0')),
        memo: memos[0] ?? null,
      };
    });
}
