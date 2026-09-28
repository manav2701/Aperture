import { merkleRoot } from '@aperture/crypto';
import { parseAnchorMemo, type ParsedTransaction } from '@aperture/x402';

/*
 * Compares an audit export with the root Aperture's notary wrote on Solana
 * (plan/phases/phase-09 §9.7). A match proves the export's events are exactly the ones anchored
 * that day; nobody, including Aperture, could have edited them afterwards.
 */

export function memoOf(transaction: ParsedTransaction): string | undefined {
  const memo = transaction.transaction.message.instructions.find((ix) => ix.program === 'spl-memo');
  return typeof memo?.parsed === 'string' ? memo.parsed : undefined;
}

export function checkAnchor(
  hashes: readonly string[],
  memo: string | undefined,
): { ok: true; day: string } | { ok: false; reason: string } {
  if (memo === undefined) return { ok: false, reason: 'the transaction has no Aperture anchor memo' };
  const anchor = parseAnchorMemo(memo);
  if (anchor === undefined) return { ok: false, reason: 'the memo is not an Aperture audit anchor' };
  if (anchor.events !== hashes.length) {
    return {
      ok: false,
      reason: `the anchor covers ${String(anchor.events)} events; the export has ${String(hashes.length)}`,
    };
  }
  const root = merkleRoot(hashes);
  return root === anchor.root
    ? { ok: true, day: anchor.day }
    : { ok: false, reason: `root mismatch: export ${root}, chain ${anchor.root}` };
}
