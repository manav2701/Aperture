/**
 * Exercises a deployed gateway with an Aperture key, the way an agent would:
 *
 *   APERTURE_KEY=apk_… APERTURE_GATEWAY_URL=https://…/gw pnpm try:gateway            # one call + one stream
 *   APERTURE_KEY=apk_… APERTURE_GATEWAY_URL=https://…/gw pnpm try:gateway --exceed   # loop until the budget stops it
 *
 * Every call asks for at most 16 output tokens of a cheap model, and --exceed stops after 50
 * calls even if no budget does, so a mistake can't run up a bill.
 */
import { argv, env, exit, stdout } from 'node:process';

const key = env.APERTURE_KEY;
const baseUrl = env.APERTURE_GATEWAY_URL?.replace(/\/+$/, '');
const model = env.APERTURE_MODEL ?? 'openai/gpt-4o-mini';
const MAX_CALLS = 50;

if (key === undefined || baseUrl === undefined) {
  stdout.write('Set APERTURE_KEY and APERTURE_GATEWAY_URL (e.g. https://your-api.onrender.com/gw).\n');
  exit(1);
}

const request = (stream: boolean, prompt: string) =>
  fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream, max_tokens: 16, messages: [{ role: 'user', content: prompt }] }),
  });

const describe = async (response: Response) => {
  if (response.ok)
    return `${String(response.status)} cost $${response.headers.get('x-aperture-cost-usd') ?? '?'} remaining $${response.headers.get('x-aperture-budget-remaining-usd') ?? '?'}`;
  const body = (await response.json().catch(() => ({}))) as { error?: { type?: string; message?: string } };
  return `${String(response.status)} ${body.error?.type ?? ''} ${body.error?.message ?? ''}`.trim();
};

if (argv.includes('--exceed')) {
  for (let i = 1; i <= MAX_CALLS; i += 1) {
    const response = await request(false, 'Write one word.');
    stdout.write(`call ${String(i)}: ${await describe(response)}\n`);
    if (!response.ok) exit(response.status === 402 ? 0 : 1);
  }
  stdout.write(`Stopped after ${String(MAX_CALLS)} calls without reaching the budget; lower it to see the denial.\n`);
} else {
  stdout.write(`chat:   ${await describe(await request(false, 'Reply with one word: hello'))}\n`);
  const streamed = await request(true, 'Count to three');
  const text = await streamed.text();
  const events = text.split('\n\n').filter((event) => event.startsWith('data:')).length;
  stdout.write(
    `stream: ${String(streamed.status)} ${String(events)} events (cost settles from the final usage event; see Spend)\n`,
  );
}
