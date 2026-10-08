import { toolById, toolsForSenderDomain, type AiTool } from './ai-tools';
import type { ParsedEmail } from './mime';
import { parseAmount, parseStatementDate } from './statement';

/*
 * Receipt parsing for the receipts inbox (plan/phases/phase-12 §12.3). Deterministic: the vendor
 * comes from the sender domain (or the original sender inside a forwarded message), the plan
 * from the plan names in the catalogue, and the amount from the receipt's total line. Anything
 * that doesn't parse cleanly goes to a person for review; nothing is guessed.
 */

export interface ReceiptContext {
  /** Domains with a DKIM pass reported by our inbound mail server (see dkimPassDomains). */
  dkimPassDomains: readonly string[];
  /** The forwarding address belongs to a verified member of the org. */
  fromMember: boolean;
}

export type ReceiptTrust = 'dkim' | 'member' | 'none';

export interface ParsedReceipt {
  /** `imported` when everything parsed and the sender is trusted; otherwise `review`. */
  status: 'imported' | 'review';
  reason: string | null;
  toolId: string | null;
  vendorDomain: string | null;
  plan: string | null;
  /** Unsigned decimal string in `currency`. */
  amount: string | null;
  currency: string | null;
  /** `YYYY-MM-DD`. */
  occurredOn: string | null;
  renewsOn: string | null;
  trust: ReceiptTrust;
  /** A one-off charge (credits, top-ups) rather than a subscription. */
  oneOff: boolean;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  US$: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
};
const ISO = /^(USD|EUR|GBP|AED|SAR|QAR|KWD|BHD|OMR|INR|CAD|AUD|SGD|CHF|JPY)$/;

/** The original sender inside a forwarded message ("From: OpenAI <noreply@tm.openai.com>"). */
function forwardedSenderDomain(text: string): string | null {
  const block =
    /(?:forwarded message|original message|begin forwarded message)[\s\S]{0,400}?\bfrom:\s*[^\n<]*<?([^\s<>@]+@([a-z0-9.-]+\.[a-z]{2,}))>?/i.exec(
      text,
    );
  return block?.[2]?.toLowerCase() ?? null;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

/** Several tools share a domain (openai.com sends ChatGPT and API receipts): decide by content. */
function chooseTool(candidates: AiTool[], haystack: string): AiTool | undefined {
  if (candidates.length <= 1) return candidates[0];
  const word = (phrase: string) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(phrase.toLowerCase())}([^a-z]|$)`).test(haystack);
  const mentions = (tool: AiTool) =>
    word(tool.product) || tool.plans.some((p) => (p.monthlyUsd !== null || p.team) && word(p.name));
  const named = candidates.filter((tool) => tool.category !== 'api' && mentions(tool));
  if (named.length === 1) return named[0];
  // A receipt that names no subscription product from a vendor with an API is API billing.
  if (named.length === 0) return candidates.find((tool) => tool.category === 'api');
  return undefined;
}

function findPlan(tool: AiTool, haystack: string): string | null {
  const plans = [...tool.plans].sort((a, b) => b.name.length - a.name.length);
  for (const plan of plans) {
    const name = escapeRegExp(plan.name.toLowerCase());
    if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(haystack)) return plan.id;
  }
  return null;
}

const AMOUNT_LINE =
  /\b(total(?: paid| charged| due)?|amount (?:paid|charged|due)|grand total|you paid|paid)\b[^\n\d$€£¥₹]{0,40}?(US\$|[$€£¥₹]|[A-Z]{3})?\s?(\d[\d,.]*\d|\d)\s?([A-Z]{3})?/gi;

function findAmount(text: string): { amount: string; currency: string } | null {
  let best: { amount: string; currency: string; rank: number } | null = null;
  for (const match of text.matchAll(AMOUNT_LINE)) {
    const label = (match[1] ?? '').toLowerCase();
    const symbol = (match[2] ?? '').toUpperCase();
    const trailing = (match[4] ?? '').toUpperCase();
    const currency =
      CURRENCY_SYMBOLS[match[2] ?? ''] ?? (ISO.test(symbol) ? symbol : ISO.test(trailing) ? trailing : '');
    const parsed = parseAmount(match[3] ?? '');
    if (parsed === undefined || currency === '') continue;
    // "Total" and "amount paid" beat a bare "paid"; the last strong match wins (totals come after line items).
    const rank = label.startsWith('total') || label.startsWith('amount') || label === 'grand total' ? 2 : 1;
    if (best === null || rank >= best.rank) best = { amount: parsed.value, currency, rank };
  }
  return best === null ? null : { amount: best.amount, currency: best.currency };
}

const DATE_WORDS =
  '((?:\\d{1,2}[ ./-])?[A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4}|\\d{1,2} [A-Za-z]{3,9} \\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})';

/**
 * The first date after one of `labels`. With `skipFuture`, dates introduced by "next …" or
 * "renews …" are skipped: they name the next charge, not this one.
 */
function findDate(text: string, labels: string, skipFuture = false): string | null {
  for (const match of text.matchAll(new RegExp(`(?:${labels})[:\\s]{1,5}${DATE_WORDS}`, 'gi'))) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (skipFuture && /\b(next|renew\w*)\W*$/i.test(before)) continue;
    const raw = match[1];
    if (raw === undefined) continue;
    const date = parseStatementDate(raw.replace(/\./g, ''), /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw) ? 'mdy' : 'dmy');
    if (date !== undefined) return date;
  }
  return null;
}

/** Parses a receipt email. Never throws on content; unknown shapes come back as `review`. */
export function parseReceipt(email: ParsedEmail, context: ReceiptContext): ParsedReceipt {
  const haystack = `${email.subject}\n${email.text}`.toLowerCase();
  const fromDomain = email.from === null ? null : domainOf(email.from.address);
  const forwarded = forwardedSenderDomain(email.text);
  const vendorDomain =
    (fromDomain !== null && toolsForSenderDomain(fromDomain).length > 0 ? fromDomain : null) ?? forwarded;
  const tool = vendorDomain === null ? undefined : chooseTool(toolsForSenderDomain(vendorDomain), haystack);

  const dkimVendor =
    vendorDomain !== null &&
    context.dkimPassDomains.some(
      (d) => d === vendorDomain || vendorDomain.endsWith(`.${d}`) || d.endsWith(`.${vendorDomain}`),
    );
  const trust: ReceiptTrust =
    dkimVendor && fromDomain === vendorDomain ? 'dkim' : context.fromMember ? 'member' : 'none';

  const money = findAmount(email.text) ?? findAmount(email.subject);
  const occurredOn =
    findDate(
      email.text,
      'date paid|paid on|payment date|invoice date|order date|date of issue|billing date|paid|date',
      true,
    ) ?? (email.date === null ? null : email.date.toISOString().slice(0, 10));
  const renewsOn = findDate(email.text, 'renews on|renewal date|next billing date|next payment|next charge');
  const plan = tool === undefined ? null : findPlan(tool, haystack);
  const oneOff =
    tool !== undefined &&
    (tool.pricing === 'usage' || /\b(credits?|top[- ]?up|usage)\b/.test(haystack)) &&
    plan === null;

  const base = {
    toolId: tool?.id ?? null,
    vendorDomain,
    plan,
    amount: money?.amount ?? null,
    currency: money?.currency ?? null,
    occurredOn,
    renewsOn,
    trust,
    oneOff,
  };
  const problem =
    tool === undefined
      ? 'the sender is not a known AI vendor'
      : money === null
        ? 'no total amount found'
        : occurredOn === null
          ? 'no date found'
          : trust === 'none'
            ? 'the sender is not a member and the vendor’s signature was not verified'
            : null;
  return { ...base, status: problem === null ? 'imported' : 'review', reason: problem };
}

/** The display name for a parsed receipt's tool and plan. */
export function receiptLabel(receipt: Pick<ParsedReceipt, 'toolId' | 'plan'>): string {
  const tool = receipt.toolId === null ? undefined : toolById(receipt.toolId);
  if (tool === undefined) return 'Unknown vendor';
  const plan = tool.plans.find((p) => p.id === receipt.plan);
  return plan === undefined ? tool.product : `${tool.product} ${plan.name}`;
}
