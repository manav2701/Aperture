import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  csvCell,
  detectDelimiter,
  extractStatement,
  guessColumns,
  headerSignature,
  parseAmount,
  parseCsv,
  parseStatementDate,
  toCsv,
} from './statement';

/*
 * Statement layouts modelled on what UAE banks and card platforms export. The column names are
 * typical of each, not copied from real files: VERIFY against redacted exports (plan §11.4).
 */
const FORMATS: { name: string; csv: string; currency: string; spendIsNegative?: boolean; ai: number }[] = [
  {
    name: 'Emirates NBD style (debit/credit columns, day-first dates)',
    currency: 'AED',
    csv: [
      'Transaction Date,Description,Debit,Credit,Balance',
      '05/10/2026,OPENAI *CHATGPT SUBSCR,73.45,,10000.00',
      '06/10/2026,CARREFOUR MOE,250.00,,9750.00',
      '07/10/2026,SALARY,,25000.00,34750.00',
      '08/10/2026,"CURSOR, AI POWERED IDE",146.90,,34603.10',
    ].join('\r\n'),
    ai: 2,
  },
  {
    name: 'ADCB style (signed amount, semicolons, European decimals)',
    currency: 'AED',
    csv: [
      'Date;Narrative;Amount;Currency',
      '2026-10-01;MIDJOURNEY INC.;-110,20;AED',
      '2026-10-02;TALABAT;-85,00;AED',
      '2026-10-03;REFUND MIDJOURNEY INC.;110,20;AED',
    ].join('\n'),
    ai: 1,
  },
  {
    name: 'FAB style (DD-MMM-YYYY, DR/CR suffix)',
    currency: 'AED',
    csv: [
      'Value Date,Transaction Details,Amount,Currency',
      '04-Oct-2026,PERPLEXITY.AI,73.50 DR,AED',
      '05-Oct-2026,DEWA,410.00 DR,AED',
      '06-Oct-2026,CASH DEPOSIT,1000.00 CR,AED',
    ].join('\n'),
    ai: 1,
  },
  {
    name: 'Mashreq style (parenthesised debits, thousands separators)',
    currency: 'AED',
    csv: ['Posting Date,Particulars,Amount', '03/10/2026,ANTHROPIC,"(1,835.00)"', '04/10/2026,NOON.COM,(99.00)'].join(
      '\n',
    ),
    ai: 1,
  },
  {
    name: 'Pemo style card export (positive spend, merchant column, USD)',
    currency: 'USD',
    spendIsNegative: false,
    csv: [
      'Date,Merchant,Billing Amount,Billing Currency,Cardholder',
      '2026-10-02,ELEVENLABS.IO,22.00,USD,Sara',
      '2026-10-02,GITHUB *COPILOT,19.00,USD,Omar',
      '2026-10-03,ADNOC,45.00,AED,Omar',
    ].join('\n'),
    ai: 2,
  },
];

describe('statement formats', () => {
  it.each(FORMATS)('$name', (format) => {
    const table = parseCsv(format.csv);
    const header = table[0] ?? [];
    const mapping = guessColumns(header);
    expect(mapping, headerSignature(header)).toBeDefined();
    if (mapping === undefined) return;
    const result = extractStatement(table, {
      mapping,
      defaultCurrency: format.currency,
      spendIsNegative: format.spendIsNegative ?? true,
    });
    expect(result.skipped).toEqual([]);
    expect(result.matched).toHaveLength(format.ai);
    for (const row of result.rows) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.amount).toMatch(/^\d+(\.\d{1,6})?$/);
    }
  });

  it('keeps unrelated rows out of the matched set and leaves credits out entirely', () => {
    const table = parseCsv(FORMATS[0]?.csv ?? '');
    const mapping = guessColumns(table[0] ?? []);
    if (mapping === undefined) throw new Error('no mapping');
    const result = extractStatement(table, { mapping, defaultCurrency: 'AED' });
    expect(result.rows.map((r) => r.descriptor)).not.toContain('SALARY');
    expect(result.matched.map((r) => r.tool.id)).toEqual(['chatgpt', 'cursor']);
    expect(result.matched[0]).toMatchObject({ date: '2026-10-05', amount: '73.45', currency: 'AED' });
  });

  it('reports rows it cannot read instead of guessing', () => {
    const table = parseCsv('Date,Description,Amount\nnot-a-date,OPENAI,-5\n2026-10-01,OPENAI,abc\n');
    const mapping = guessColumns(table[0] ?? []);
    if (mapping === undefined) throw new Error('no mapping');
    expect(extractStatement(table, { mapping, defaultCurrency: 'USD' }).skipped).toEqual([1, 2]);
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF, a BOM, and blank lines', () => {
    expect(parseCsv('﻿a,"b,c","say ""hi"""\r\n\r\n1,2,3\n', ',')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('detects the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('never throws and never loses a non-empty cell count on arbitrary input (fuzz)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        const rows = parseCsv(text);
        expect(Array.isArray(rows)).toBe(true);
        for (const row of rows) expect(row.length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips through toCsv for arbitrary cells', () => {
    const cell = fc.string({ maxLength: 30 }).filter((s) => !/^[=+\-@\t\r]/.test(s) && s.trim() !== '');
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 10 }), (rows) => {
        const width = rows[0]?.length ?? 2;
        const square = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? 'x'));
        const [head = [], ...rest] = square;
        expect(parseCsv(toCsv(head, rest), ',')).toEqual(square);
      }),
      { numRuns: 300 },
    );
  });
});

describe('parseAmount', () => {
  it.each([
    ['1,234.56', '1234.56', false],
    ['1.234,56', '1234.56', false],
    ['(12.00)', '12.00', true],
    ['-12.00', '12.00', true],
    ['12.00 DR', '12.00', true],
    ['12.00 CR', '12.00', false],
    ['AED 1,234.50', '1234.50', false],
    ['12-', '12', true],
    ["1'234.50", '1234.50', false],
    ['0.000001', '0.000001', false],
    ['007', '7', false],
  ])('%s → %s (negative %s)', (raw, value, negative) => {
    expect(parseAmount(raw)).toEqual({ value, negative });
  });

  it.each(['', 'abc', '1.2.3,4,5x', '12.1234567', '=1+2'])('rejects %j', (raw) => {
    expect(parseAmount(raw)).toBeUndefined();
  });
});

describe('parseStatementDate', () => {
  it.each([
    ['2026-10-05', 'dmy', '2026-10-05'],
    ['05/10/2026', 'dmy', '2026-10-05'],
    ['05/10/2026', 'mdy', '2026-05-10'],
    ['5.10.26', 'dmy', '2026-10-05'],
    ['04-Oct-2026', 'dmy', '2026-10-04'],
    ['4 October 2026', 'dmy', '2026-10-04'],
    ['Oct 4, 2026', 'dmy', '2026-10-04'],
    ['2026-10-05 14:30:00', 'dmy', '2026-10-05'],
  ] as const)('%s (%s) → %s', (raw, order, expected) => {
    expect(parseStatementDate(raw, order)).toBe(expected);
  });

  it.each(['31/02/2026', '2026-13-01', 'yesterday', ''])('rejects %j', (raw) => {
    expect(parseStatementDate(raw)).toBeUndefined();
  });
});

describe('csvCell', () => {
  it('neutralizes formula prefixes and quotes separators', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-2)).toBe('-2');
    expect(csvCell(null)).toBe('');
  });
});
