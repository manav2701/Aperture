/**
 * Pays an x402 resource through Aperture, the way an agent would (plan/phases/phase-09 "Try it"):
 *
 *   APERTURE_KEY=apk_… APERTURE_GATEWAY_URL=https://…/gw pnpm try:x402 --url http://localhost:4021/paid
 *
 * On a 402, Aperture checks the price (budget, policy, payee, allowance), the signer signs as the
 * agent's delegate, and the request is retried with PAYMENT-SIGNATURE. Refusals print why.
 */
import { argv, env, exit, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { Aperture, ApertureError } from '@aperture/sdk';

const { values } = parseArgs({ args: argv.slice(2), options: { url: { type: 'string' } } });
if (env.APERTURE_KEY === undefined || env.APERTURE_GATEWAY_URL === undefined || values.url === undefined) {
  stdout.write('Set APERTURE_KEY and APERTURE_GATEWAY_URL, and pass --url <paid resource>.\n');
  exit(1);
}
const aperture = new Aperture({ apiKey: env.APERTURE_KEY, baseUrl: env.APERTURE_GATEWAY_URL });
try {
  const response = await aperture.x402Fetch(values.url);
  stdout.write(`${String(response.status)} ${(await response.text()).slice(0, 500)}\n`);
  if (response.ok)
    stdout.write('Paid. The settlement appears in Crypto → Payments once the watcher sees it on chain.\n');
} catch (error) {
  if (!(error instanceof ApertureError)) throw error;
  const reason = typeof error.details.reason === 'string' ? ` (${error.details.reason})` : '';
  stdout.write(`refused: ${error.type}${reason}: ${error.message}\n`);
  exit(1);
}
