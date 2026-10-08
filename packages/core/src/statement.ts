import { matchDescriptor, type AiTool } from './ai-tools';

/*
 * Bank and card statement CSVs (plan/phases/phase-11 §11.4). Parsing and matching run in the
 * browser so unrelated transactions never leave the person's machine; the server re-validates
 * and re-matches the rows it receives. Pure functions only.
 */

export class StatementError extends Error {
  readonly code: 'empty' | 'too_large' | 'no_columns' | 'invalid_row';

  constructor(code: StatementError['code'], message: string) {
    super(message);
    this.name = 'StatementError';
    this.code = code;
  }
}

/** Limits from the plan's security checklist: 5 MB and 20,000 rows per upload. */
export const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;
export const STATEMENT_MAX_ROWS = 20_000;

/** Picks the separator that splits the first lines most consistently (comma, semicolon, tab). */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = [',', ';', '\t'] as const;
  let best: ',' | ';' | '\t' = ',';
  let bestScore = -1;
  for (const candidate of candidates) {
    const counts = parseCsv(sample, candidate)
      .filter((row) => row.length > 1)
      .map((row) => row.length);
    if (counts.length === 0) continue;
    const consistent = counts.filter((count) => count === counts[0]).length;
    const score = consistent * (counts[0] ?? 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM. Empty lines are dropped. */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input.charAt(i);
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** One signed amount column … */
  amount?: number | undefined;
  /** … or separate debit and credit columns. */
  debit?: number | undefined;
  credit?: number | undefined;
  currency?: number | undefined;
}

const HEADER_HINTS: Record<keyof ColumnMapping, RegExp> = {
  date: /^(transaction |posting |value |txn )?date$|^date$|^تاريخ/i,
  description: /description|details|narrative|merchant|particulars|payee|memo|transaction$/i,
  amount: /^(transaction |billing |local )?amount( \(.*\))?$|^amount|^value$/i,
  debit: /debit|withdrawal|money out|paid out/i,
  credit: /credit|deposit|money in|paid in/i,
  currency: /currency|ccy/i,
};

/**
 * Guesses which columns hold the date, description, and amount from the header row. The person
 * confirms it in the upload dialog, and the confirmed mapping is remembered per header layout.
 */
export function guessColumns(header: readonly string[]): ColumnMapping | undefined {
  const find = (key: keyof ColumnMapping, taken: Set<number>) =>
    header.findIndex((cell, index) => !taken.has(index) && HEADER_HINTS[key].test(cell.trim()));
  const taken = new Set<number>();
  const date = find('date', taken);
  if (date >= 0) taken.add(date);
  const debit = find('debit', taken);
  if (debit >= 0) taken.add(debit);
  const credit = find('credit', taken);
  if (credit >= 0) taken.add(credit);
  const currency = find('currency', taken);
  if (currency >= 0) taken.add(currency);
  const amount = debit >= 0 ? -1 : find('amount', taken);
  if (amount >= 0) taken.add(amount);
  const description = find('description', taken);
  if (date < 0 || description < 0 || (amount < 0 && debit < 0)) return undefined;
  return {
    date,
    description,
    amount: amount >= 0 ? amount : undefined,
    debit: debit >= 0 ? debit : undefined,
    credit: credit >= 0 ? credit : undefined,
    currency: currency >= 0 ? currency : undefined,
  };
}

/** A stable key for a header layout, so a confirmed mapping can be remembered per bank format. */
export function headerSignature(header: readonly string[]): string {
  return header.map((cell) => cell.trim().toLowerCase()).join('|');
}

/**
 * Parses an amount as printed by banks: "1,234.56", "1.234,56", "(12.00)", "-12.00", "12.00 DR",
 * "AED 1,234.50". Returns an unsigned decimal string with at most 6 decimals and its sign, or
 * undefined when it isn't a number.
 */
export function parseAmount(raw: string): { value: string; negative: boolean } | undefined {
  let text = raw.trim();
  if (text === '') return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/\b(DR|DEBIT)\b/i.test(text)) negative = true;
  text = text.replace(/\b(DR|CR|DEBIT|CREDIT)\b/gi, '').replace(/[A-Za-z$€£¥\s\u00a0]/g, '');
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith('+')) text = text.slice(1);
  if (!/^[\d.,']+$/.test(text)) return undefined;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let whole: string;
  let fraction = '';
  if (lastComma > lastDot && text.length - lastComma - 1 <= 2) {
    // European style: 1.234,56
    whole = text.slice(0, lastComma).replace(/[.']/g, '');
    fraction = text.slice(lastComma + 1);
  } else if (lastDot >= 0 && lastDot > lastComma) {
    whole = text.slice(0, lastDot).replace(/[,']/g, '');
    fraction = text.slice(lastDot + 1);
  } else {
    whole = text.replace(/[,.']/g, '');
  }
  if (!/^\d+$/.test(whole === '' ? '0' : whole) || !/^\d{0,6}$/.test(fraction)) return undefined;
  const normalizedWhole = (whole === '' ? '0' : whole).replace(/^0+(?=\d)/, '');
  const value = fraction === '' ? normalizedWhole : `${normalizedWhole}.${fraction}`;
  return { value, negative };
}

const isZero = (decimal: string) => /^0+(\.0*)?$/.test(decimal);

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

/** Day-first (UAE and most of the world) unless the bank prints month first. */
export type DateOrder = 'dmy' | 'mdy';

/** Parses a statement date to `YYYY-MM-DD`, or undefined. ISO dates are always accepted. */
export function parseStatementDate(raw: string, order: DateOrder = 'dmy'): string | undefined {
  const text = raw.trim().toUpperCase();
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(text);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if ((match = /^(\d{1,2})[-/. ]([A-Z]{3})[A-Z]*[-/. ,]+(\d{2,4})(?:\s.*)?$/.exec(text))) {
    day = Number(match[1]);
    month = MONTHS[match[2] ?? ''] ?? 0;
    year = Number(match[3]);
  } else if ((match = /^([A-Z]{3})[A-Z]* (\d{1,2}),? (\d{4})$/.exec(text))) {
    month = MONTHS[match[1] ?? ''] ?? 0;
    day = Number(match[2]);
    year = Number(match[3]);
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/.exec(text))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    [day, month] = order === 'dmy' ? [a, b] : [b, a];
    year = Number(match[3]);
  } else return undefined;
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface StatementRow {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Unsigned decimal string in `currency`. */
  amount: string;
  /** ISO 4217, upper case. */
  currency: string;
  descriptor: string;
}

export interface MatchedRow extends StatementRow {
  tool: AiTool;
}

export interface ExtractResult {
  /** Debits (money out) that parsed cleanly. */
  rows: StatementRow[];
  matched: MatchedRow[];
  /** Rows that couldn't be parsed (bad date or amount), by line number from 1 after the header. */
  skipped: number[];
}

/**
 * Turns parsed CSV rows into money-out transactions and matches them against the AI tool
 * catalogue. Credits (refunds, payments to the card) are left out: we look for spend.
 */
export function extractStatement(
  table: readonly (readonly string[])[],
  options: {
    mapping: ColumnMapping;
    /** Currency for rows without a currency column (the account's currency). */
    defaultCurrency: string;
    dateOrder?: DateOrder;
    /** Single-amount files: whether spend is printed negative (most banks) or positive (most card exports). */
    spendIsNegative?: boolean;
    hasHeader?: boolean;
  },
): ExtractResult {
  const { mapping } = options;
  const body = options.hasHeader === false ? table : table.slice(1);
  if (body.length > STATEMENT_MAX_ROWS)
    throw new StatementError('too_large', `a statement can have at most ${String(STATEMENT_MAX_ROWS)} rows`);
  const rows: StatementRow[] = [];
  const skipped: number[] = [];
  body.forEach((cells, index) => {
    const date = parseStatementDate(cells[mapping.date] ?? '', options.dateOrder);
    const descriptor = (cells[mapping.description] ?? '').trim();
    let amount: { value: string; negative: boolean } | undefined;
    let isSpend: boolean;
    if (mapping.debit !== undefined) {
      const debit = parseAmount(cells[mapping.debit] ?? '');
      // A blank or zero debit is a credit row (a refund or a payment to the card): not spend.
      if (debit === undefined || isZero(debit.value)) return;
      amount = debit;
      isSpend = true;
    } else {
      amount = parseAmount(cells[mapping.amount ?? -1] ?? '');
      isSpend = amount?.negative === (options.spendIsNegative ?? true);
    }
    if (date === undefined || amount === undefined || descriptor === '') {
      skipped.push(index + 1);
      return;
    }
    if (!isSpend || isZero(amount.value)) return;
    const currency = (mapping.currency === undefined ? options.defaultCurrency : (cells[mapping.currency] ?? ''))
      .trim()
      .toUpperCase();
    rows.push({
      date,
      amount: amount.value,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : options.defaultCurrency.toUpperCase(),
      descriptor: descriptor.slice(0, 200),
    });
  });
  const matched = rows.flatMap((row) => {
    const tool = matchDescriptor(row.descriptor);
    return tool === undefined ? [] : [{ ...row, tool }];
  });
  return { rows, matched, skipped };
}

/** Prefixes that make spreadsheet apps run a cell as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Escapes one CSV cell for export: quotes when needed and neutralizes formula prefixes. */
export function csvCell(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds a CSV document (CRLF line ends, as RFC 4180 and Excel expect). */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | bigint | null)[])[],
): string {
  return [header, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n') + '\r\n';
}
