import { getAddMemoInstruction } from '@solana-program/memo';
import { SPL_MEMO_PROGRAM } from './transaction';
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Blockhash,
  type KeyPairSigner,
} from '@solana/kit';

/*
 * Audit anchoring (plan/phases/phase-09 §9.7): a day's Merkle root of an org's audit hashes,
 * written in a memo by Aperture's notary wallet. Anyone can later compare an exported audit
 * log with the root on chain; nobody (including Aperture) can quietly rewrite that day.
 */

const PREFIX = 'aperture-audit:v1';

export function anchorMemo(input: { orgId: string; day: string; root: string; events: number }): string {
  return `${PREFIX}:${input.orgId}:${input.day}:${input.root}:${String(input.events)}`;
}

export function parseAnchorMemo(
  memo: string,
): { orgId: string; day: string; root: string; events: number } | undefined {
  const match = /^aperture-audit:v1:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):([0-9a-f]{64}):(\d+)$/.exec(memo);
  if (match === null) return undefined;
  return { orgId: match[1] ?? '', day: match[2] ?? '', root: match[3] ?? '', events: Number(match[4]) };
}

/** NOTARY_SECRET_KEY: the 64-byte keypair as a JSON array (solana-keygen) or base58 (wallet export). */
export async function notaryFromSecret(secret: string): Promise<KeyPairSigner> {
  const text = secret.trim();
  const bytes = text.startsWith('[')
    ? new Uint8Array(JSON.parse(text) as number[])
    : new Uint8Array(getBase58Encoder().encode(text));
  if (bytes.length !== 64) throw new Error('the notary key must be a 64-byte Solana keypair');
  return createKeyPairSignerFromBytes(bytes);
}

/** A memo transaction paid and signed by the notary; base64 wire bytes ready to send. */
export async function buildMemoTransaction(
  notary: KeyPairSigner,
  memo: string,
  lifetime: { blockhash: string; lastValidBlockHeight: bigint },
): Promise<string> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(notary, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: lifetime.blockhash as Blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions([getAddMemoInstruction({ memo }, { programAddress: SPL_MEMO_PROGRAM })], m),
  );
  const signed = await signTransaction([notary.keyPair], compileTransaction(message));
  return getBase64EncodedWireTransaction(signed);
}
