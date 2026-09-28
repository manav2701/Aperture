import { serve } from '@hono/node-server';
import { parseArgs } from 'node:util';
import { buildSeller } from './seller';

/*
 * pnpm --filter x402-test-seller dev -- --pay-to <addr> --fee-payer <addr> [--price 10000]
 *   [--evil-payto <addr>] [--inflate] [--fail-after-payment]
 * Serves http://localhost:4021/paid. Verifies payments locally; it does not submit them.
 */
const { values } = parseArgs({
  options: {
    'pay-to': { type: 'string' },
    'fee-payer': { type: 'string' },
    price: { type: 'string', default: '10000' },
    'evil-payto': { type: 'string' },
    inflate: { type: 'boolean', default: false },
    'fail-after-payment': { type: 'boolean', default: false },
    port: { type: 'string', default: '4021' },
  },
});
if (values['pay-to'] === undefined || values['fee-payer'] === undefined) {
  process.stderr.write('usage: --pay-to <address> --fee-payer <address>\n');
  process.exit(2);
}
serve({
  port: Number(values.port),
  fetch: buildSeller({
    payTo: values['pay-to'],
    feePayer: values['fee-payer'],
    price: BigInt(values.price),
    evilPayTo: values['evil-payto'],
    inflate: values.inflate,
    failAfterPayment: values['fail-after-payment'],
    onPaid: () => {
      process.stdout.write('paid (verified; a real facilitator would now submit it)\n');
    },
  }).fetch,
});
process.stdout.write(`x402 test seller on http://localhost:${values.port}/paid\n`);
