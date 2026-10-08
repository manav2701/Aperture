/**
 * Verifies an Aperture governance attestation offline (plan/phases/phase-11 §11.5).
 *
 *   pnpm attestation-verify att.json --jwks <jwks.json | https://…/jwks.json> [--audit audit.jsonl]
 *
 * `att.json` is the file the dashboard downloads ({ document, jws }) or a bare JWS. With a saved
 * JWKS it needs no network. With the period's audit export (Audit log → Export) it also checks
 * the chain range, the last hash, and the Merkle root. To check the daily on-chain anchors listed
 * in the attestation, run `pnpm audit-verify <that day's export> --check-anchor <signature>`.
 *
 * Exit code 0: valid. 1: invalid, with the reason. 2: usage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Jwk } from '@aperture/crypto';
import { verifyAttestation } from './attestation';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { jwks: { type: 'string' }, audit: { type: 'string' } },
});
const file = positionals[0];
if (file === undefined || values.jwks === undefined) {
  process.stderr.write('usage: attestation-verify <att.json> --jwks <file | url> [--audit <audit.jsonl>]\n');
  process.exit(2);
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const read = (path: string) => readFileSync(resolve(cwd, path), 'utf8');
const jwks = values.jwks.startsWith('https://')
  ? ((await (await fetch(values.jwks, { signal: AbortSignal.timeout(10_000) })).json()) as { keys: Jwk[] })
  : (JSON.parse(read(values.jwks)) as { keys: Jwk[] });
const result = verifyAttestation(read(file), jwks, values.audit === undefined ? undefined : read(values.audit));

if (!result.ok) {
  process.stdout.write(`INVALID: ${result.reason}\n`);
  process.exit(1);
}
const { document } = result;
const out = (line: string) => process.stdout.write(`${line}\n`);
out(`valid: signed by ${result.kid}`);
out(
  `  issuer:   ${document.issuer.kind === 'aperture_cloud' ? 'Aperture Cloud' : `operator of ${document.issuer.instance} (self-hosted)`}`,
);
out(`  org:      ${document.org.name} (${document.org.id})`);
out(`  period:   ${document.period.from} → ${document.period.to} (${document.period.timezone})`);
out(`  posture:  ${String(document.posture.score)}/100, grade ${document.posture.grade}`);
out(
  `  audit:    seq ${String(document.audit.firstSeq ?? '–')}–${String(document.audit.lastSeq ?? '–')}, ${document.audit.chainIntact ? 'chain intact' : `CHAIN BROKEN at seq ${String(document.audit.brokenAtSeq)}`}`,
);
if (result.audit !== undefined)
  out(`  checked:  ${String(result.audit.events)} events from the export, Merkle root ${result.audit.merkleRoot}`);
out(`  ${document.disclaimer}`);
