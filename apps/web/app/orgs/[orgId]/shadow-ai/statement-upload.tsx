'use client';

import {
  STATEMENT_MAX_BYTES,
  extractStatement,
  guessColumns,
  headerSignature,
  parseCsv,
  type ColumnMapping,
  type DateOrder,
  type ExtractResult,
} from '@aperture/core';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

const MAPPINGS_KEY = 'aperture.statement-mappings';

/** Remembered column mappings per bank layout (per browser; a convenience, never required). */
function rememberedMapping(signature: string): ColumnMapping | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(MAPPINGS_KEY) ?? '{}') as Record<string, ColumnMapping>;
    return stored[signature];
  } catch {
    // Private windows can block storage; guessing the columns again is fine.
    return undefined;
  }
}
function rememberMapping(signature: string, mapping: ColumnMapping) {
  try {
    const stored = JSON.parse(localStorage.getItem(MAPPINGS_KEY) ?? '{}') as Record<string, ColumnMapping>;
    localStorage.setItem(MAPPINGS_KEY, JSON.stringify({ ...stored, [signature]: mapping }));
  } catch {
    // Not remembering a mapping only costs the person one more confirmation next time.
  }
}

/**
 * Statement upload (plan §11.4): the file is parsed and matched here, in the browser. Only rows
 * that match an AI vendor are sent; everything else stays on this machine.
 */
export function StatementUpload({ orgId }: { orgId: string }) {
  const { submit, pending, error, setError } = useSubmit();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | undefined>();
  const [currency, setCurrency] = useState('AED');
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [spendIsNegative, setSpendIsNegative] = useState(true);
  const [sent, setSent] = useState<string | null>(null);
  const header = table[0] ?? [];

  const result: ExtractResult | undefined = useMemo(() => {
    if (mapping === undefined || table.length < 2) return undefined;
    try {
      return extractStatement(table, { mapping, defaultCurrency: currency, dateOrder, spendIsNegative });
    } catch {
      return undefined;
    }
  }, [table, mapping, currency, dateOrder, spendIsNegative]);

  const onFile = async (file: File) => {
    setSent(null);
    setError(null);
    if (file.size > STATEMENT_MAX_BYTES) {
      setError('That file is larger than 5 MB. Export a shorter period.');
      return;
    }
    const rows = parseCsv(await file.text());
    setFileName(file.name);
    setTable(rows);
    const head = rows[0] ?? [];
    setMapping(rememberedMapping(headerSignature(head)) ?? guessColumns(head));
  };

  const column = (key: keyof ColumnMapping, label: string, optional = false) => (
    <Field label={label} htmlFor={`col-${key}`}>
      <Select
        id={`col-${key}`}
        value={mapping?.[key] === undefined ? '' : String(mapping[key])}
        onChange={(e) => {
          const value = e.target.value === '' ? undefined : Number(e.target.value);
          setMapping({ date: 0, description: 0, ...mapping, [key]: value });
        }}
      >
        {optional ? <option value="">—</option> : null}
        {header.map((cell, index) => (
          <option key={`${cell}-${String(index)}`} value={index}>
            {cell === '' ? `Column ${String(index + 1)}` : cell}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-4 text-sm">
      <FormNotice>
        The CSV is read in your browser. Only charges that match a known AI vendor are sent to Aperture; groceries,
        salaries, and everything else never leave this machine.
      </FormNotice>
      <Input
        type="file"
        accept=".csv,text/csv"
        className="py-2"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void onFile(file);
        }}
      />
      {table.length === 0 ? null : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {column('date', 'Date column')}
            {column('description', 'Description column')}
            {column('amount', 'Amount column', true)}
            {column('debit', 'Debit column (if separate)', true)}
            {column('currency', 'Currency column', true)}
            <Field label="Account currency" htmlFor="stmt-currency">
              <Input
                id="stmt-currency"
                value={currency}
                maxLength={3}
                onChange={(e) => {
                  setCurrency(e.target.value.toUpperCase());
                }}
              />
            </Field>
            <Field label="Dates are" htmlFor="stmt-order">
              <Select
                id="stmt-order"
                value={dateOrder}
                onChange={(e) => {
                  setDateOrder(e.target.value as DateOrder);
                }}
              >
                <option value="dmy">day / month / year</option>
                <option value="mdy">month / day / year</option>
              </Select>
            </Field>
            <Field label="Spend appears as" htmlFor="stmt-sign" hint="Only for a single amount column">
              <Select
                id="stmt-sign"
                value={spendIsNegative ? 'neg' : 'pos'}
                onChange={(e) => {
                  setSpendIsNegative(e.target.value === 'neg');
                }}
              >
                <option value="neg">negative amounts (most bank accounts)</option>
                <option value="pos">positive amounts (most card exports)</option>
              </Select>
            </Field>
          </div>
          {result === undefined ? (
            <p className="text-muted-foreground">Choose the date, description, and amount columns.</p>
          ) : (
            <div className="space-y-2">
              <p>
                {result.rows.length} charges read ·{' '}
                <span className="font-semibold">{result.matched.length} match an AI vendor</span>
                {result.skipped.length > 0 ? ` · ${String(result.skipped.length)} rows couldn’t be read` : ''}
              </p>
              {result.matched.length === 0 ? null : (
                <ul className="max-h-60 divide-y divide-border overflow-y-auto border border-border">
                  {result.matched.map((row, index) => (
                    <li
                      key={`${row.date}-${row.descriptor}-${String(index)}`}
                      className="flex justify-between gap-2 p-2"
                    >
                      <span>
                        <span className="font-medium">{row.tool.product}</span>{' '}
                        <span className="font-mono text-xs text-muted-foreground">
                          {row.date} · {row.descriptor}
                        </span>
                      </span>
                      <span className="font-mono">
                        {row.amount} {row.currency}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                disabled={pending || result.matched.length === 0}
                onClick={() => {
                  if (mapping !== undefined) rememberMapping(headerSignature(header), mapping);
                  submit(
                    () =>
                      api.POST('/api/v1/orgs/{orgId}/external-spend/uploads', {
                        params: { path: { orgId } },
                        body: {
                          fileName,
                          rows: result.matched.map(({ date, amount, currency: c, descriptor }) => ({
                            date,
                            amount,
                            currency: c,
                            descriptor,
                          })),
                        },
                      }),
                    () => {
                      setSent(`Sent ${String(result.matched.length)} AI charges. Nothing else left your browser.`);
                      setTable([]);
                    },
                  );
                }}
              >
                Send {result.matched.length} AI charges
              </Button>
            </div>
          )}
        </>
      )}
      {sent === null ? null : <FormNotice>{sent}</FormNotice>}
      <FormError message={error} />
    </div>
  );
}
