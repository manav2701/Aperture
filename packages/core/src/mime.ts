/*
 * A small RFC 5322 / MIME reader for receipt emails (plan/phases/phase-12 §12.3): headers with
 * folding and encoded words, nested multiparts, base64 and quoted-printable bodies, and charsets
 * the platform's TextDecoder knows. It extracts text for receipt parsing and nothing else:
 * attachments are skipped and never kept. Pure; works in Node and browsers.
 */

export class MimeError extends Error {
  readonly code: 'too_large' | 'malformed';

  constructor(code: MimeError['code'], message: string) {
    super(message);
    this.name = 'MimeError';
    this.code = code;
  }
}

export const MAX_EMAIL_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_PARTS = 200;

export interface ParsedEmail {
  /** Lower-cased header names; values unfolded and decoded, in order. */
  headers: Map<string, string[]>;
  from: { address: string; name: string } | null;
  subject: string;
  date: Date | null;
  messageId: string | null;
  /** Plain text: the text/plain parts, or text extracted from HTML when there are none. */
  text: string;
}

const latin1 = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};
const toBytes = (binary: string) => {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
};

function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const label = (charset ?? 'utf-8').trim().replace(/^"|"$/g, '').toLowerCase();
  try {
    return new TextDecoder(label === 'us-ascii' ? 'utf-8' : label, { fatal: false }).decode(bytes);
  } catch {
    // An unknown charset label: UTF-8 with replacement characters is the least-bad reading.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  // Padding may be missing (encoded words often drop it); one leftover character carries no byte.
  const usable = clean.length % 4 === 1 ? clean.slice(0, -1) : clean;
  try {
    return toBytes(atob(usable.padEnd(Math.ceil(usable.length / 4) * 4, '=')));
  } catch {
    // Broken base64 in one part shouldn't sink the whole email; that part just reads as empty.
    return new Uint8Array();
  }
}

function decodeQuotedPrintable(text: string): Uint8Array {
  const joined = text.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const char = joined[i];
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(joined.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

/** RFC 2047 encoded words: =?charset?B|Q?text?= (adjacent words join without the space between). */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, encoding: string, text: string) => {
      const bytes =
        encoding.toUpperCase() === 'B' ? decodeBase64(text) : decodeQuotedPrintable(text.replace(/_/g, ' '));
      return decodeCharset(bytes, charset);
    });
}

function parseHeaders(block: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    // Header bytes may be raw UTF-8 (RFC 6532) as well as encoded words.
    const value = decodeEncodedWords(decodeCharset(toBytes(line.slice(colon + 1).trim()), 'utf-8'));
    headers.set(name, [...(headers.get(name) ?? []), value]);
  }
  return headers;
}

/** Splits `type/subtype; a=b; c="d"` into the media type and its parameters. */
function parseContentType(value: string | undefined): { type: string; params: Record<string, string> } {
  const [type = 'text/plain', ...rest] = (value ?? 'text/plain').split(';');
  const params: Record<string, string> = {};
  for (const param of rest) {
    const eq = param.indexOf('=');
    if (eq < 0) continue;
    params[param.slice(0, eq).trim().toLowerCase()] = param
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  return { type: type.trim().toLowerCase(), params };
}

function splitHead(raw: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (match === null) return { head: raw, body: '' };
  return { head: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

/** Turns HTML into readable text: drops scripts and styles, keeps line breaks, decodes entities. */
export function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

interface Collected {
  plain: string[];
  html: string[];
  parts: number;
}

function walk(raw: string, depth: number, collected: Collected): void {
  if (depth > MAX_DEPTH) throw new MimeError('malformed', 'MIME parts are nested too deeply');
  collected.parts += 1;
  if (collected.parts > MAX_PARTS) throw new MimeError('malformed', 'too many MIME parts');
  const { head, body } = splitHead(raw);
  const headers = parseHeaders(head);
  const { type, params } = parseContentType(headers.get('content-type')?.[0]);
  const disposition = headers.get('content-disposition')?.[0]?.toLowerCase() ?? '';
  if (disposition.startsWith('attachment')) return;
  if (type.startsWith('multipart/')) {
    const boundary = params.boundary;
    if (boundary === undefined) return;
    const delimiter = `--${boundary}`;
    // Everything after the closing delimiter is the epilogue; everything before the first one is the preamble.
    const close = body.indexOf(`${delimiter}--`);
    const content = close >= 0 ? body.slice(0, close) : body;
    const sections = content.split(
      new RegExp(`\\r?\\n?${delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\r?\\n?`),
    );
    for (const section of sections.slice(1)) if (section.trim() !== '') walk(section, depth + 1, collected);
    return;
  }
  if (type === 'message/rfc822') {
    walk(body, depth + 1, collected);
    return;
  }
  if (type !== 'text/plain' && type !== 'text/html') return;
  const encoding = (headers.get('content-transfer-encoding')?.[0] ?? '7bit').toLowerCase();
  const bytes =
    encoding === 'base64'
      ? decodeBase64(body)
      : encoding === 'quoted-printable'
        ? decodeQuotedPrintable(body)
        : toBytes(body);
  const text = decodeCharset(bytes, params.charset);
  (type === 'text/html' ? collected.html : collected.plain).push(text.trimEnd());
}

function parseAddress(value: string | undefined): ParsedEmail['from'] {
  if (value === undefined) return null;
  const angle = /^(.*)<([^>]+)>\s*$/.exec(value);
  const address = (angle?.[2] ?? value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  return { address, name: (angle?.[1] ?? '').trim().replace(/^"|"$/g, '') };
}

/** Parses a raw RFC 822 message (bytes or a binary string). */
export function parseEmail(raw: Uint8Array | string): ParsedEmail {
  const size = typeof raw === 'string' ? raw.length : raw.byteLength;
  if (size > MAX_EMAIL_BYTES) throw new MimeError('too_large', 'the email is larger than 5 MB');
  // A string with characters above U+00FF is already-decoded text: read it as its UTF-8 bytes.
  const binary =
    typeof raw !== 'string' ? latin1(raw) : /[\u0100-\uffff]/.test(raw) ? latin1(new TextEncoder().encode(raw)) : raw;
  const { head } = splitHead(binary);
  const headers = parseHeaders(head);
  if (headers.size === 0) throw new MimeError('malformed', 'no email headers found');
  const collected: Collected = { plain: [], html: [], parts: 0 };
  walk(binary, 0, collected);
  const dateHeader = headers.get('date')?.[0];
  const date = dateHeader === undefined ? null : new Date(dateHeader);
  const text = collected.plain.length > 0 ? collected.plain.join('\n') : collected.html.map(htmlToText).join('\n');
  return {
    headers,
    from: parseAddress(headers.get('from')?.[0]),
    subject: headers.get('subject')?.[0] ?? '',
    date: date !== null && !Number.isNaN(date.getTime()) ? date : null,
    messageId: headers.get('message-id')?.[0] ?? null,
    text: text.slice(0, 200_000),
  };
}

/**
 * Domains with `dkim=pass` in Authentication-Results headers added by the receiving server named
 * `authservId`. Headers from any other server are ignored, since a sender can forge them.
 */
export function dkimPassDomains(email: ParsedEmail, authservId: string): string[] {
  const domains: string[] = [];
  for (const value of email.headers.get('authentication-results') ?? []) {
    const [server = ''] = value.split(';');
    if (server.trim().toLowerCase() !== authservId.toLowerCase()) continue;
    for (const match of value.matchAll(/dkim=pass[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/gi)) {
      if (match[1] !== undefined) domains.push(match[1].toLowerCase());
    }
  }
  return [...new Set(domains)];
}
