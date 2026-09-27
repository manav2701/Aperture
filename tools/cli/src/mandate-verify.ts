/**
 * Verifies an Aperture mandate offline, against the org's published keys.
 *
 *   pnpm mandate-verify <mandate.jws | -> --jwks <jwks.json | https://…/jwks.json> [--parent <parent.jws>]…
 *
 * Exit code 0: valid (signature, validity window, and each delegation inside its parent).
 * 1: invalid, with the reason. Revocation can only be checked online (GET /v1/me or the API).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Jwk } from '@aperture/crypto';
import { verifyMandate } from './mandate';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { jwks: { type: 'string' }, parent: { type: 'string', multiple: true } },
});
const input = positionals[0];
if (input === undefined || values.jwks === undefined) {
  process.stderr.write('usage: mandate-verify <mandate.jws | -> --jwks <file | url> [--parent <file>]…\n');
  process.exit(2);
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const read = (value: string) => (value === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(cwd, value), 'utf8'));
const token = (value: string) => (value.split('.').length === 3 && !value.includes('/') ? value : read(value));

const jwks = values.jwks.startsWith('https://')
  ? ((await (await fetch(values.jwks, { signal: AbortSignal.timeout(10_000) })).json()) as { keys: Jwk[] })
  : (JSON.parse(read(values.jwks)) as { keys: Jwk[] });
const result = verifyMandate(token(input), jwks, { parents: (values.parent ?? []).map(token) });

if (result.ok) {
  process.stdout.write(
    `valid: mandate ${result.id} for ${result.subject} from ${result.issuer} ("${result.purpose}"), chain depth ${String(result.depth)}\n`,
  );
} else {
  process.stdout.write(`INVALID: ${result.reason}\n`);
  process.exit(1);
}
