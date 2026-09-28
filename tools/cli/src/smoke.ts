/**
 * Post-deploy smoke suite (plan/phases/phase-10 §10.10): read-only checks that a deployment is
 * up and wired correctly. Spends nothing and needs no credentials.
 *
 *   pnpm smoke --api https://api.example.com --gateway https://gw.example.com [--web https://app.example.com]
 *
 * Exit 0 when every check passes; otherwise prints the failures and exits 1.
 */
import { argv, exit, stdout } from 'node:process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: argv.slice(2),
  options: { api: { type: 'string' }, gateway: { type: 'string' }, web: { type: 'string' } },
});
if (values.api === undefined) {
  stdout.write('usage: smoke --api <url> [--gateway <url>] [--web <url>]\n');
  exit(2);
}
const api = values.api.replace(/\/+$/, '');
const gateway = values.gateway?.replace(/\/+$/, '');
const web = values.web?.replace(/\/+$/, '');

type Check = [name: string, run: () => Promise<string | undefined>];
// 90 s: free-tier hosts cold-start after idling.
const get = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });

const checks: Check[] = [
  ['api is ready', async () => ((await get(`${api}/readyz`)).ok ? undefined : 'readyz is not 200')],
  [
    'api serves its OpenAPI document',
    async () => {
      const doc = (await (await get(`${api}/api/v1/openapi.json`)).json()) as { paths?: Record<string, unknown> };
      return Object.keys(doc.paths ?? {}).length > 50 ? undefined : 'too few paths';
    },
  ],
  [
    'org routes require a session',
    async () => {
      const response = await get(`${api}/api/v1/orgs/00000000-0000-4000-8000-000000000000`);
      return response.status === 401 ? undefined : `expected 401, got ${String(response.status)}`;
    },
  ],
  [
    'metrics are not public',
    async () => ((await get(`${api}/metrics`)).status === 404 ? undefined : '/metrics answered without a token'),
  ],
  [
    'Stripe webhooks refuse unknown connections',
    async () => {
      const response = await get(`${api}/webhooks/stripe/00000000-0000-4000-8000-000000000000/authorization`, {
        method: 'POST',
        body: '{}',
      });
      return response.status === 404 ? undefined : `expected 404, got ${String(response.status)}`;
    },
  ],
];
if (gateway !== undefined) {
  checks.push(
    ['gateway is ready', async () => ((await get(`${gateway}/readyz`)).ok ? undefined : 'readyz is not 200')],
    [
      'gateway refuses requests without a key',
      async () => {
        const response = await get(`${gateway}/v1/chat/completions`, { method: 'POST', body: '{}' });
        return response.status === 401 ? undefined : `expected 401, got ${String(response.status)}`;
      },
    ],
  );
}
if (web !== undefined) {
  checks.push([
    'web sends a nonce CSP',
    async () => {
      const policy = (await get(`${web}/login`)).headers.get('content-security-policy') ?? '';
      return policy.includes("'nonce-") ? undefined : 'no nonce-based Content-Security-Policy';
    },
  ]);
}

let failed = 0;
for (const [name, run] of checks) {
  const problem = await run().catch((error: unknown) => (error instanceof Error ? error.message : 'failed'));
  if (problem === undefined) stdout.write(`ok    ${name}\n`);
  else {
    failed += 1;
    stdout.write(`FAIL  ${name}: ${problem}\n`);
  }
}
stdout.write(failed === 0 ? `smoke passed (${String(checks.length)} checks)\n` : `${String(failed)} check(s) failed\n`);
exit(failed === 0 ? 0 : 1);
