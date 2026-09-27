// Test fixtures for .semgrep/aperture.yml — run with `semgrep --test .semgrep`.
// `ruleid:` marks lines that must be flagged, `ok:` lines that must not.
/* eslint-disable */

declare const stripe: any;
declare const request: any;
declare const c: any;

async function cards() {
  // ruleid: no-card-number-expansion
  await stripe.issuing.cards.retrieve('ic_123', { expand: ['number', 'cvc'] });

  // ruleid: no-card-number-expansion
  await stripe.issuing.cards.retrieve('ic_123', { expand: ['cvc'] });

  // ok: no-card-number-expansion
  await stripe.issuing.cards.retrieve('ic_123', { expand: ['cardholder'] });

  // ruleid: no-card-number-expansion
  await fetch('https://api.stripe.com/v1/issuing/cards/ic_123?expand[]=number');

  // ruleid: no-card-number-expansion
  await request('GET', '/v1/issuing/cards/ic_123', { 'expand[0]': 'cvc' });

  // ok: no-card-number-expansion
  await request('GET', '/v1/issuing/cards/ic_123', { 'expand[0]': 'cardholder' });
}

async function ssrf() {
  const target = request.nextUrl.searchParams.get('target');
  // ruleid: no-fetch-of-request-controlled-url
  await fetch(target, { method: 'GET' });

  const upstream = c.req.header('x-upstream');
  // ruleid: no-fetch-of-request-controlled-url
  await fetch(`${upstream}/v1/chat/completions`);

  // ok: no-fetch-of-request-controlled-url
  await fetch('https://openrouter.ai/api/v1/chat/completions', { body: c.req.query('prompt') });
}
