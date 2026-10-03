import { findAssociatedTokenPda, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { getAddMemoInstruction } from '@solana-program/memo';
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
  type Address,
  type Blockhash,
  type KeyPairSigner,
} from '@solana/kit';

/*
 * The x402 "exact" SVM payment transaction (plan/phases/phase-09 §9.2, X14): the facilitator
 * is fee payer and co-signs; we sign only as the budget account's delegate. Our verifier is a
 * local port of the Path 1 rules, run on every transaction we produce before it leaves the
 * signer, and by the test seller.
 */

/**
 * SPL Memo v2, the memo program facilitators recognise. @solana-program/memo defaults to a newer
 * program id, which PayAI and Coinbase CDP reject as an unknown instruction.
 */
export const SPL_MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** What we request; well under facilitator caps (VERIFY caps against the spec). */
const COMPUTE_UNIT_LIMIT = 40_000;
const COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000n;
/** Verifier caps (Path 1): at most 5 lamports per compute unit, 200k units. */
const MAX_COMPUTE_UNIT_LIMIT = 200_000;
const MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 5_000_000n;

export interface PaymentIntent {
  /** The budget token account (owned by the treasury) the delegate may spend from. */
  source: string;
  mint: string;
  decimals: number;
  payTo: string;
  amount: bigint;
  feePayer: string;
  /** Unique per payment; how the settlement watcher recognises the transfer on chain. */
  memo: string;
}

export async function destinationFor(payTo: string, mint: string): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(payTo),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata;
}

/** Builds and partially signs (as delegate) the payment transaction; returns base64 wire bytes. */
export async function buildPaymentTransaction(
  intent: PaymentIntent,
  delegate: KeyPairSigner,
  lifetime: { blockhash: string; lastValidBlockHeight: bigint },
): Promise<string> {
  const destination = await destinationFor(intent.payTo, intent.mint);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(intent.feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: lifetime.blockhash as Blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT }),
          getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICROLAMPORTS }),
          getTransferCheckedInstruction({
            source: address(intent.source),
            mint: address(intent.mint),
            destination,
            authority: delegate,
            amount: intent.amount,
            decimals: intent.decimals,
          }),
          getAddMemoInstruction({ memo: intent.memo }, { programAddress: SPL_MEMO_PROGRAM }),
        ],
        m,
      ),
  );
  const signed = await partiallySignTransaction([delegate.keyPair], compileTransaction(message));
  return getBase64EncodedWireTransaction(signed);
}

export interface VerifiedPayment {
  ok: true;
  source: string;
  authority: string;
  destination: string;
  amount: bigint;
  memo: string | null;
}

interface Bytes {
  readonly buffer: ArrayBufferLike;
  readonly byteOffset: number;
}
const readU32 = (data: Bytes, offset: number) =>
  new DataView(data.buffer as ArrayBuffer, data.byteOffset).getUint32(offset, true);
const readU64 = (data: Bytes, offset: number) =>
  new DataView(data.buffer as ArrayBuffer, data.byteOffset).getBigUint64(offset, true);

/**
 * Checks a payment transaction the way a Path 1 facilitator would, against what we meant to
 * pay: instruction set and order, compute caps, TransferChecked into payTo's associated token
 * account for exactly `amount` of `mint`, the fee payer kept out of the transfer, a valid
 * signature by the transfer authority, and (when given) the memo and source.
 */
export async function verifyPaymentTransaction(
  base64: string,
  expected: {
    payTo: string;
    mint: string;
    amount: bigint;
    feePayer: string;
    decimals?: number;
    memo?: string;
    source?: string;
    authority?: string;
  },
): Promise<VerifiedPayment | { ok: false; reason: string }> {
  const fail = (reason: string) => ({ ok: false as const, reason });
  let transaction;
  let message;
  try {
    transaction = getTransactionDecoder().decode(Buffer.from(base64, 'base64'));
    message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  } catch {
    return fail('the transaction does not decode');
  }
  if (message.version !== 0 && message.version !== 'legacy') return fail('unsupported transaction version');
  if ('addressTableLookups' in message && message.addressTableLookups.length > 0)
    return fail('lookup tables are not allowed');
  const accounts = message.staticAccounts;
  if (accounts[0] !== expected.feePayer) return fail('the fee payer is not the facilitator');

  const instructions = message.instructions;
  if (instructions.length !== 3 && instructions.length !== 4) return fail('expected 3 or 4 instructions');
  const program = (index: number) => accounts[instructions[index]?.programAddressIndex ?? -1];
  const data = (index: number) => instructions[index]?.data ?? new Uint8Array();
  const accountsOf = (index: number) => (instructions[index]?.accountIndices ?? []).map((i) => accounts[i]);

  if (program(0) !== COMPUTE_BUDGET_PROGRAM_ADDRESS || data(0)[0] !== 2 || data(0).length !== 5) {
    return fail('instruction 1 must set the compute unit limit');
  }
  if (readU32(data(0), 1) > MAX_COMPUTE_UNIT_LIMIT) return fail('compute unit limit too high');
  if (program(1) !== COMPUTE_BUDGET_PROGRAM_ADDRESS || data(1)[0] !== 3 || data(1).length !== 9) {
    return fail('instruction 2 must set the compute unit price');
  }
  if (readU64(data(1), 1) > MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS) return fail('compute unit price too high');

  const transfer = data(2);
  if (program(2) !== TOKEN_PROGRAM_ADDRESS || transfer[0] !== 12 || transfer.length !== 10) {
    return fail('instruction 3 must be a TransferChecked');
  }
  const [source, mint, destination, authority] = accountsOf(2);
  if (source === undefined || mint === undefined || destination === undefined || authority === undefined) {
    return fail('TransferChecked is missing accounts');
  }
  const amount = readU64(transfer, 1);
  if (mint !== expected.mint) return fail('wrong token');
  if (expected.decimals !== undefined && transfer[9] !== expected.decimals) return fail('wrong decimals');
  if (amount !== expected.amount) return fail('wrong amount');
  if (destination !== (await destinationFor(expected.payTo, expected.mint))) {
    return fail('the transfer does not go to the payee’s token account');
  }
  if (authority === expected.feePayer || source === expected.feePayer)
    return fail('the fee payer may not move the funds');
  if (expected.source !== undefined && source !== expected.source) return fail('wrong source account');
  if (expected.authority !== undefined && authority !== expected.authority) return fail('wrong transfer authority');

  let memo: string | null = null;
  if (instructions.length === 4) {
    if (program(3) !== SPL_MEMO_PROGRAM) return fail('instruction 4 may only be a memo');
    memo = new TextDecoder().decode(Uint8Array.from(data(3)));
  }
  if (expected.memo !== undefined && memo !== expected.memo) return fail('the memo does not match');

  const signature = transaction.signatures[authority];
  if (signature == null) return fail('the transfer authority has not signed');
  const key = await getPublicKeyFromAddress(authority);
  if (!(await verifySignature(key, signature, transaction.messageBytes))) {
    return fail('the transfer authority’s signature is invalid');
  }
  return { ok: true, source, authority, destination, amount, memo };
}
