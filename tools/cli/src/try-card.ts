/**
 * Simulates card purchases in a Stripe **test-mode** Issuing account, so you can watch Aperture
 * decide them (plan/phases/phase-08 "Try it yourself"). Uses Stripe's test helpers; nothing is
 * charged. Needs STRIPE_TEST_KEY=sk_test_… (the same account Aperture is connected to).
 *
 *   pnpm try:card auth --card ic_… --amount 12.50 [--category computer_software_stores] [--merchant "Acme"]
 *   pnpm try:card capture --auth iauth_… [--amount 12.50]
 *   pnpm try:card force-capture --card ic_… --amount 5
 */
import { argv, env, exit, stdout } from 'node:process';
import { parseArgs } from 'node:util';

const key = env.STRIPE_TEST_KEY;
if (key === undefined || (!key.startsWith('sk_test_') && !key.startsWith('rk_test_'))) {
  stdout.write('Set STRIPE_TEST_KEY to a Stripe test-mode key (sk_test_… or rk_test_…). Live keys are refused.\n');
  exit(1);
}

const [command = '', ...rest] = argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    card: { type: 'string' },
    auth: { type: 'string' },
    amount: { type: 'string' },
    category: { type: 'string', default: 'computer_software_stores' },
    merchant: { type: 'string', default: 'Aperture Test Merchant' },
    country: { type: 'string', default: 'US' },
  },
});
const cents = (usd: string | undefined) => {
  if (usd === undefined || !/^\d+(\.\d{1,2})?$/.test(usd)) {
    stdout.write('--amount must be a USD amount like 12.50\n');
    exit(1);
  }
  return String(Math.round(Number(usd) * 100));
};

async function stripe(path: string, params: Record<string, string>) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key ?? ''}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await response.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) {
    stdout.write(`Stripe: ${body.error?.message ?? String(response.status)}\n`);
    exit(1);
  }
  return body;
}

const describeAuth = (auth: Record<string, unknown>) => {
  const history = (auth.request_history as { approved: boolean; reason: string }[] | undefined) ?? [];
  const last = history.at(-1);
  const metadata = (auth.metadata as Record<string, string> | undefined) ?? {};
  return `${String(auth.id)}: ${auth.approved === true ? 'APPROVED' : 'DECLINED'} (${last?.reason ?? '?'}${
    metadata.aperture_reason === undefined ? '' : `, aperture: ${metadata.aperture_reason}`
  })`;
};

if (command === 'auth') {
  const auth = await stripe('/v1/test_helpers/issuing/authorizations', {
    card: values.card ?? '',
    amount: cents(values.amount),
    'merchant_data[category]': values.category,
    'merchant_data[name]': values.merchant,
    'merchant_data[country]': values.country,
  });
  stdout.write(`${describeAuth(auth)}\n`);
  if (auth.approved === true) stdout.write(`  → capture it: pnpm try:card capture --auth ${String(auth.id)}\n`);
} else if (command === 'capture') {
  const params: Record<string, string> = {};
  if (values.amount !== undefined) params.capture_amount = cents(values.amount);
  const auth = await stripe(`/v1/test_helpers/issuing/authorizations/${values.auth ?? ''}/capture`, params);
  stdout.write(
    `${String(auth.id)} captured; status ${String(auth.status)}. Spend in Aperture updates from the events webhook.\n`,
  );
} else if (command === 'force-capture') {
  const transaction = await stripe('/v1/test_helpers/issuing/transactions/create_force_capture', {
    card: values.card ?? '',
    amount: cents(values.amount),
    'merchant_data[name]': values.merchant,
  });
  stdout.write(`${String(transaction.id)}: force capture created. Expect an "unheld capture" alert in Aperture.\n`);
} else {
  stdout.write('usage: try:card auth|capture|force-capture … (see the header of tools/cli/src/try-card.ts)\n');
  exit(2);
}
