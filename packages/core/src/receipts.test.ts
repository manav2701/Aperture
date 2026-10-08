import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeEncodedWords, dkimPassDomains, htmlToText, parseEmail } from './mime';
import { parseReceipt, receiptLabel } from './receipts';

const b64 = (text: string) =>
  Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

function email(input: {
  from: string;
  subject: string;
  body: string;
  html?: boolean;
  encoding?: 'base64' | 'quoted-printable' | '8bit';
  extraHeaders?: string[];
}): string {
  const encoding = input.encoding ?? '8bit';
  const body =
    encoding === 'base64'
      ? b64(input.body)
      : encoding === 'quoted-printable'
        ? input.body.replace(/=/g, '=3D').replace(/(.{70})/g, '$1=\r\n')
        : input.body;
  return [
    `From: ${input.from}`,
    'To: receipts-acme@in.aperture.example',
    `Subject: ${input.subject}`,
    'Date: Mon, 05 Oct 2026 09:12:00 +0000',
    'Message-ID: <abc@example.com>',
    ...(input.extraHeaders ?? []),
    'MIME-Version: 1.0',
    `Content-Type: ${input.html === true ? 'text/html' : 'text/plain'}; charset="utf-8"`,
    `Content-Transfer-Encoding: ${encoding}`,
    '',
    body,
  ].join('\r\n');
}

const memberContext = { dkimPassDomains: [], fromMember: true };

/** Receipt shapes per vendor (wording modelled on real receipts, amounts invented). */
const VENDORS: {
  name: string;
  raw: string;
  context?: { dkimPassDomains: string[]; fromMember: boolean };
  expected: { toolId: string; plan: string | null; amount: string; currency: string; occurredOn: string };
}[] = [
  {
    name: 'ChatGPT Plus (from OpenAI, DKIM verified)',
    raw: email({
      from: 'OpenAI <noreply@tm.openai.com>',
      subject: 'Your ChatGPT Plus subscription receipt',
      body: 'Receipt\nChatGPT Plus Subscription\nDate paid October 5, 2026\nAmount paid $20.00\nRenews on November 5, 2026',
    }),
    context: { dkimPassDomains: ['tm.openai.com'], fromMember: false },
    expected: { toolId: 'chatgpt', plan: 'plus', amount: '20.00', currency: 'USD', occurredOn: '2026-10-05' },
  },
  {
    name: 'OpenAI API credits (HTML)',
    raw: email({
      from: 'OpenAI <billing@openai.com>',
      subject: 'Your receipt from OpenAI LLC #2201-4471',
      html: true,
      body: '<html><body><h1>Receipt</h1><table><tr><td>Credit purchase</td><td>$50.00</td></tr><tr><td><b>Total</b></td><td>$50.00</td></tr></table><p>Date paid: 2026-10-03</p></body></html>',
    }),
    expected: { toolId: 'openai_api', plan: null, amount: '50.00', currency: 'USD', occurredOn: '2026-10-03' },
  },
  {
    name: 'Claude Max (base64 body)',
    raw: email({
      from: 'Anthropic <invoice+statements@mail.anthropic.com>',
      subject: 'Your receipt from Anthropic, PBC',
      encoding: 'base64',
      body: 'Claude Max 5x plan\nPaid October 1, 2026\nTotal $100.00\nNext billing date: November 1, 2026',
    }),
    expected: { toolId: 'claude', plan: 'max_5x', amount: '100.00', currency: 'USD', occurredOn: '2026-10-01' },
  },
  {
    name: 'Cursor Pro (quoted-printable)',
    raw: email({
      from: 'Cursor <billing@cursor.com>',
      subject: 'Your Cursor receipt',
      encoding: 'quoted-printable',
      body: 'Cursor Pro — monthly\nInvoice date: 2026-10-02\nAmount charged $20.00 USD',
    }),
    expected: { toolId: 'cursor', plan: 'pro', amount: '20.00', currency: 'USD', occurredOn: '2026-10-02' },
  },
  {
    name: 'GitHub Copilot Pro',
    raw: email({
      from: 'GitHub <noreply@github.com>',
      subject: '[GitHub] Payment receipt for GitHub Copilot',
      body: 'We received payment for your GitHub Copilot Pro subscription.\nDate: 2026-10-04\nTotal: $10.00 USD',
    }),
    expected: { toolId: 'github_copilot', plan: 'pro', amount: '10.00', currency: 'USD', occurredOn: '2026-10-04' },
  },
  {
    name: 'Midjourney Standard',
    raw: email({
      from: 'Midjourney <billing@midjourney.com>',
      subject: 'Midjourney receipt',
      body: 'Standard Plan (monthly)\nPayment date 3 October 2026\nTotal US$30.00',
    }),
    expected: { toolId: 'midjourney', plan: 'standard', amount: '30.00', currency: 'USD', occurredOn: '2026-10-03' },
  },
  {
    name: 'Perplexity Pro in euros',
    raw: email({
      from: 'Perplexity <receipts@perplexity.ai>',
      subject: 'Your Perplexity Pro receipt',
      body: 'Perplexity Pro\nDate paid Oct 2, 2026\nTotal €20.00',
    }),
    expected: { toolId: 'perplexity', plan: 'pro', amount: '20.00', currency: 'EUR', occurredOn: '2026-10-02' },
  },
  {
    name: 'Google AI Pro',
    raw: email({
      from: 'Google Payments <payments-noreply@google.com>',
      subject: 'Your Google AI Pro receipt',
      body: 'Google AI Pro (Gemini)\nBilling date: 2026-10-01\nTotal: AED 73.49',
    }),
    expected: { toolId: 'gemini', plan: 'ai_pro', amount: '73.49', currency: 'AED', occurredOn: '2026-10-01' },
  },
  {
    name: 'Microsoft Copilot Pro',
    raw: email({
      from: 'Microsoft <microsoft-noreply@microsoft.com>',
      subject: 'Your Microsoft order has been processed',
      body: 'Copilot Pro\nOrder date: 2026-10-06\nTotal $20.00',
    }),
    expected: {
      toolId: 'microsoft_copilot',
      plan: 'copilot_pro',
      amount: '20.00',
      currency: 'USD',
      occurredOn: '2026-10-06',
    },
  },
  {
    name: 'ElevenLabs Creator',
    raw: email({
      from: 'ElevenLabs <billing@elevenlabs.io>',
      subject: 'Receipt from ElevenLabs',
      body: 'Creator plan\nDate paid October 7, 2026\nAmount paid $22.00',
    }),
    expected: { toolId: 'elevenlabs', plan: 'creator', amount: '22.00', currency: 'USD', occurredOn: '2026-10-07' },
  },
  {
    name: 'Runway Pro',
    raw: email({
      from: 'Runway <billing@runwayml.com>',
      subject: 'Your Runway receipt',
      body: 'Runway Pro\nInvoice date 2026-10-02\nGrand total $35.00',
    }),
    expected: { toolId: 'runway', plan: 'pro', amount: '35.00', currency: 'USD', occurredOn: '2026-10-02' },
  },
  {
    name: 'A ChatGPT receipt a member forwarded by hand',
    raw: email({
      from: 'Sara Khan <sara@acme.example>',
      subject: 'Fwd: Your ChatGPT Plus subscription receipt',
      body: '---------- Forwarded message ---------\nFrom: OpenAI <noreply@tm.openai.com>\nDate: Mon, 5 Oct 2026\nSubject: Your ChatGPT Plus subscription receipt\n\nChatGPT Plus Subscription\nDate paid October 5, 2026\nAmount paid $20.00',
    }),
    expected: { toolId: 'chatgpt', plan: 'plus', amount: '20.00', currency: 'USD', occurredOn: '2026-10-05' },
  },
];

describe('receipt templates', () => {
  it.each(VENDORS)('$name', ({ raw, context, expected }) => {
    const receipt = parseReceipt(parseEmail(raw), context ?? memberContext);
    expect(receipt).toMatchObject({ ...expected, status: 'imported', reason: null });
  });

  it('trusts the vendor’s DKIM signature only for mail sent from that vendor', () => {
    const verified = VENDORS[0];
    if (verified === undefined) throw new Error('missing sample');
    expect(
      parseReceipt(parseEmail(verified.raw), { dkimPassDomains: ['tm.openai.com'], fromMember: false }).trust,
    ).toBe('dkim');
  });

  it('sends a receipt from a stranger without a verified signature to review', () => {
    const spoofed = email({
      from: 'OpenAI <noreply@tm.openai.com>',
      subject: 'Your ChatGPT Pro receipt',
      body: 'ChatGPT Pro\nDate paid October 5, 2026\nAmount paid $200.00',
    });
    const receipt = parseReceipt(parseEmail(spoofed), { dkimPassDomains: [], fromMember: false });
    expect(receipt.status).toBe('review');
    expect(receipt.trust).toBe('none');
  });

  it('sends unknown vendors and receipts without a total to review', () => {
    const unknown = parseReceipt(
      parseEmail(email({ from: 'Shop <hi@shop.example>', subject: 'Thanks', body: 'Total $9.00\nDate: 2026-10-01' })),
      memberContext,
    );
    expect(unknown).toMatchObject({ status: 'review', toolId: null });
    const noTotal = parseReceipt(
      parseEmail(
        email({ from: 'Cursor <billing@cursor.com>', subject: 'Welcome to Cursor', body: 'Thanks for signing up.' }),
      ),
      memberContext,
    );
    expect(noTotal).toMatchObject({ status: 'review', toolId: 'cursor', reason: 'no total amount found' });
  });

  it('labels receipts', () => {
    expect(receiptLabel({ toolId: 'chatgpt', plan: 'plus' })).toBe('ChatGPT Plus');
    expect(receiptLabel({ toolId: 'openai_api', plan: null })).toBe('OpenAI API');
    expect(receiptLabel({ toolId: null, plan: null })).toBe('Unknown vendor');
  });
});

describe('parseEmail', () => {
  it('reads nested multiparts, skips attachments, and prefers text/plain', () => {
    const raw = [
      'From: Billing <billing@cursor.com>',
      'Subject: =?UTF-8?B?WW91ciByZWNlaXB0IOKAlCBDdXJzb3I=?=',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      'preamble',
      '--outer',
      'Content-Type: multipart/alternative; boundary=inner',
      '',
      '--inner',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain body ✓',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML body</p>',
      '--inner--',
      '--outer',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="receipt.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--outer--',
      'epilogue',
    ].join('\r\n');
    const parsed = parseEmail(Buffer.from(raw, 'utf8'));
    expect(parsed.subject).toBe('Your receipt — Cursor');
    expect(parsed.text).toBe('Plain body ✓');
    expect(parsed.text).not.toContain('JVBER');
    expect(parsed.from).toEqual({ address: 'billing@cursor.com', name: 'Billing' });
  });

  it('decodes encoded words in Q and B forms and joins adjacent words', () => {
    expect(decodeEncodedWords('=?ISO-8859-1?Q?Caf=E9_receipt?=')).toBe('Café receipt');
    expect(decodeEncodedWords('=?UTF-8?B?SGVs?= =?UTF-8?B?bG8=?=')).toBe('Hello');
  });

  it('turns HTML into text', () => {
    expect(htmlToText('<style>x{}</style><p>Total&nbsp;&#36;5.00</p><br>Thanks &amp; bye')).toBe(
      'Total $5.00\nThanks & bye',
    );
  });

  it('reads DKIM results only from our own receiving server', () => {
    const raw = [
      'From: a@tm.openai.com',
      'Authentication-Results: mx.aperture.example; dkim=pass header.d=tm.openai.com; spf=pass',
      'Authentication-Results: evil.example; dkim=pass header.d=anthropic.com',
      'Subject: x',
      '',
      'body',
    ].join('\r\n');
    expect(dkimPassDomains(parseEmail(raw), 'mx.aperture.example')).toEqual(['tm.openai.com']);
  });

  it('rejects input without headers and oversized messages', () => {
    expect(() => parseEmail('no headers here')).toThrow();
    expect(() => parseEmail('x'.repeat(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
  });

  it('never crashes on arbitrary bytes after a valid header (fuzz)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 4000 }),
        fc.constantFrom('text/plain', 'multipart/mixed; boundary=b', 'text/html'),
        (bytes, type) => {
          const head = Buffer.from(
            `From: x@cursor.com\r\nContent-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
          );
          const parsed = parseEmail(Buffer.concat([head, Buffer.from(bytes)]));
          expect(typeof parsed.text).toBe('string');
          expect(parseReceipt(parsed, memberContext).status).toMatch(/imported|review/);
        },
      ),
      { numRuns: 300 },
    );
  });
});
