import { generateKeyPairSync, timingSafeEqual } from 'node:crypto';
import { decryptSecret, encryptSecret, type KeyRing } from '@aperture/crypto';
import { and, eq, schema, withOrg, type Database } from '@aperture/db';
import {
  atomicToMicros,
  buildPaymentTransaction,
  verifyPaymentTransaction,
  type SolanaNetwork,
  type SolanaRpc,
} from '@aperture/x402';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';

/*
 * The signer (plan/phases/phase-09 §9.2, X7, X8, X11): the only process that can decrypt agent
 * delegate keys (its own KEK, not the platform's). It signs a payment only for an open hold whose
 * recorded intent matches, after re-checking the on-chain allowance and balance, and verifies
 * its own output with the Path 1 rules before returning it.
 */

export interface SignerDeps {
  db: Database;
  /** SIGNER_KEK_V<n>: never shared with the API or gateway. */
  ring: KeyRing;
  rpcFor: (network: SolanaNetwork) => SolanaRpc;
  /** Signatures per agent per minute. */
  perMinute?: number;
}

export class SignerRefusal extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SignerRefusal';
    this.code = code;
  }
}

const keyContext = (orgId: string, accountId: string) => `${orgId}|x402-delegate|${accountId}`;

/** Ed25519 seed bytes (32) from a freshly generated key. */
function newSeed(): Uint8Array {
  const der = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' });
  return new Uint8Array(der.subarray(der.length - 32));
}

/** Creates the agent's delegate key once; returns its public address. */
export async function createDelegateKey(
  deps: SignerDeps,
  input: { orgId: string; accountId: string },
): Promise<string> {
  return withOrg(deps.db, input.orgId, async (tx) => {
    const [account] = await tx
      .select()
      .from(schema.x402Accounts)
      .where(and(eq(schema.x402Accounts.id, input.accountId), eq(schema.x402Accounts.orgId, input.orgId)))
      .for('update');
    if (account === undefined) throw new SignerRefusal('not_found', 'no such budget account');
    if (account.delegate !== null) return account.delegate;
    const seed = newSeed();
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    await tx
      .update(schema.x402Accounts)
      .set({
        delegate: signer.address,
        delegateSecret: encryptSecret(
          Buffer.from(seed).toString('base64'),
          keyContext(input.orgId, input.accountId),
          deps.ring,
        ),
      })
      .where(eq(schema.x402Accounts.id, account.id));
    return signer.address;
  });
}

const recent = new Map<string, number[]>();

function rateLimit(principalId: string, perMinute: number) {
  const now = Date.now();
  const hits = (recent.get(principalId) ?? []).filter((at) => now - at < 60_000);
  if (hits.length >= perMinute) throw new SignerRefusal('rate_limited', 'too many signatures for this agent');
  hits.push(now);
  recent.set(principalId, hits);
}

/** Signs the payment `paymentId` if, and only if, everything still matches. */
export async function signPayment(
  deps: SignerDeps,
  input: { orgId: string; paymentId: string },
): Promise<{ transaction: string; lastValidBlockHeight: bigint }> {
  const loaded = await withOrg(deps.db, input.orgId, async (tx) => {
    const [row] = await tx
      .select({ payment: schema.x402Payments, account: schema.x402Accounts, hold: schema.holds })
      .from(schema.x402Payments)
      .innerJoin(schema.x402Accounts, eq(schema.x402Accounts.id, schema.x402Payments.accountId))
      .leftJoin(schema.holds, eq(schema.holds.id, schema.x402Payments.holdId))
      .where(and(eq(schema.x402Payments.id, input.paymentId), eq(schema.x402Payments.orgId, input.orgId)));
    return row;
  });
  if (loaded === undefined) throw new SignerRefusal('not_found', 'no such payment');
  const { payment, account, hold } = loaded;
  // X11: nothing is signed without an open hold for exactly this payment.
  if (payment.status !== 'authorized') throw new SignerRefusal('not_authorized', `the payment is ${payment.status}`);
  if (hold?.status !== 'open' || hold.externalRef !== payment.id) {
    throw new SignerRefusal('no_open_hold', 'the payment has no open hold');
  }
  if (hold.amount !== atomicToMicros(payment.amount, account.decimals) || hold.principalId !== payment.principalId) {
    throw new SignerRefusal('intent_mismatch', 'the hold does not match the payment');
  }
  if (account.status !== 'active' || account.delegate === null || account.delegateSecret === null) {
    throw new SignerRefusal('account_inactive', 'the budget account is not active');
  }
  if (payment.amount > account.maxPerPayment) throw new SignerRefusal('over_cap', 'over the per-payment cap');
  rateLimit(payment.principalId, deps.perMinute ?? 30);

  // X7, X8: the chain must still allow it (the treasury may have revoked or drained it).
  const rpc = deps.rpcFor(account.network as SolanaNetwork);
  const onChain = await rpc.getTokenAccount(account.budgetAccount);
  if (onChain === null) throw new SignerRefusal('account_missing', 'the budget account does not exist on chain');
  if (onChain.mint !== account.mint) throw new SignerRefusal('wrong_mint', 'the budget account holds another token');
  if (onChain.delegate !== account.delegate)
    throw new SignerRefusal('delegate_revoked', 'the treasury revoked this agent');
  if (onChain.delegatedAmount < payment.amount)
    throw new SignerRefusal('allowance_exhausted', 'the on-chain allowance is too low');
  if (onChain.amount < payment.amount)
    throw new SignerRefusal('insufficient_balance', 'the budget account balance is too low');

  // Facilitators (e.g. PayAI) may hand out the blockhash they will accept, with its expiry.
  const extra = (payment.requirement.extra ?? {}) as { recentBlockhash?: unknown; lastValidBlockHeight?: unknown };
  const lifetime =
    typeof extra.recentBlockhash === 'string'
      ? {
          blockhash: extra.recentBlockhash,
          lastValidBlockHeight:
            typeof extra.lastValidBlockHeight === 'string' || typeof extra.lastValidBlockHeight === 'number'
              ? BigInt(extra.lastValidBlockHeight)
              : (await rpc.getBlockHeight()) + 150n,
        }
      : await rpc.getLatestBlockhash();

  const seed = Buffer.from(
    decryptSecret(account.delegateSecret, keyContext(input.orgId, account.id), deps.ring),
    'base64',
  );
  const delegate = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed));
  if (delegate.address !== account.delegate) throw new SignerRefusal('key_mismatch', 'the stored key does not match');
  const intent = {
    source: account.budgetAccount,
    mint: account.mint,
    decimals: account.decimals,
    payTo: payment.payTo,
    amount: payment.amount,
    feePayer: payment.feePayer,
    memo: payment.memo,
  };
  const transaction = await buildPaymentTransaction(intent, delegate, lifetime);
  const verified = await verifyPaymentTransaction(transaction, { ...intent, authority: delegate.address });
  if (!verified.ok) throw new SignerRefusal('self_check_failed', verified.reason);

  await withOrg(deps.db, input.orgId, (tx) =>
    tx
      .update(schema.x402Payments)
      .set({ status: 'signed', lastValidBlockHeight: lifetime.lastValidBlockHeight })
      .where(and(eq(schema.x402Payments.id, payment.id), eq(schema.x402Payments.status, 'authorized'))),
  );
  return { transaction, lastValidBlockHeight: lifetime.lastValidBlockHeight };
}

/** Constant-time check of the shared secret between the gateway/API and the signer. */
export function sharedSecretMatches(expected: string, header: string | undefined): boolean {
  const given = header?.startsWith('Bearer ') === true ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
