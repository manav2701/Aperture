/**
 * Verifies an exported audit log (JSON lines) without trusting Aperture or its database.
 *
 *   pnpm audit-verify audit.jsonl [--start-prev-hash <hex> --start-seq <n>]
 *   pnpm audit-verify day.jsonl --check-anchor <tx signature> [--rpc https://api.devnet.solana.com]
 *
 * Exit code 0: the chain is intact. 1: it was altered (the first broken seq is printed).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { merkleRoot } from '@aperture/crypto';
import { solanaRpc } from '@aperture/x402';
import { checkAnchor, memoOf } from './anchor-check';
import { verifyAuditExport } from './verify';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'start-prev-hash': { type: 'string' },
    'start-seq': { type: 'string' },
    'check-anchor': { type: 'string' },
    rpc: { type: 'string', default: 'https://api.devnet.solana.com' },
  },
});
const file = positionals[0];
if (file === undefined) {
  process.stderr.write('usage: audit-verify <audit.jsonl> [--start-prev-hash <hex> --start-seq <n>]\n');
  process.exit(2);
}

const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const options = {
  ...(values['start-prev-hash'] === undefined ? {} : { startPrevHash: values['start-prev-hash'] }),
  ...(values['start-seq'] === undefined ? {} : { startSeq: Number(values['start-seq']) }),
};
const result = verifyAuditExport(readFileSync(path, 'utf8'), options);

if (result.ok) {
  process.stdout.write(`valid: ${String(result.count)} events, last hash ${result.lastHash}\n`);
  process.stdout.write(`merkle root: ${merkleRoot(result.hashes)}\n`);
  const signature = values['check-anchor'];
  if (signature !== undefined) {
    const transaction = await solanaRpc([values.rpc]).getTransaction(signature);
    const anchored =
      transaction === null
        ? { ok: false as const, reason: 'transaction not found' }
        : checkAnchor(result.hashes, memoOf(transaction));
    if (!anchored.ok) {
      process.stdout.write(`ANCHOR MISMATCH: ${anchored.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(`anchor matches: the ${anchored.day} root is on Solana in ${signature}\n`);
  }
} else {
  process.stdout.write(`INVALID at ${result.where}: ${result.reason}\n`);
  process.exit(1);
}
