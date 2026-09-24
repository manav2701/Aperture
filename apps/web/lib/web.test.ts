import { readFileSync } from 'node:fs';
import { policyDocumentSchema } from '@aperture/core';
import { describe, expect, it } from 'vitest';
import { RULE_EXAMPLES, STARTER_POLICY } from '../app/orgs/[orgId]/policies/rule-examples';
import { safeNext } from './auth-client';
import { formatAmount, percentUsed } from './format';

describe('formatAmount', () => {
  it('groups digits without losing precision', () => {
    expect(formatAmount('1234567.5', 'micros')).toBe('$1,234,567.50');
    expect(formatAmount('90071992547409.123456', 'micros')).toBe('$90,071,992,547,409.123456');
    expect(formatAmount('-3.1', 'micros')).toBe('-$3.10');
    expect(formatAmount('12000', 'count')).toBe('12,000 actions');
  });
});

describe('percentUsed', () => {
  const budget = (limit: string, spent: string, held = '0') => ({
    limit,
    unit: 'micros' as const,
    usage: { spent, held },
  });

  it('counts holds and clamps to 0–999', () => {
    expect(percentUsed(budget('100', '25', '25'))).toBe(50);
    expect(percentUsed(budget('100', '-5'))).toBe(0);
    expect(percentUsed(budget('1', '50'))).toBe(999);
    expect(percentUsed(budget('0', '0'))).toBe(0);
    expect(percentUsed(budget('0', '0.01'))).toBe(999);
  });
});

describe('safeNext', () => {
  it('only allows same-site paths', () => {
    expect(safeNext('/invite/abc')).toBe('/invite/abc');
    for (const unsafe of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      undefined,
    ]) {
      expect(safeNext(unsafe)).toBe('/app');
    }
  });
});

describe('policy rule examples', () => {
  it('are valid policy documents', () => {
    expect(policyDocumentSchema.safeParse({ rules: Object.values(RULE_EXAMPLES) }).success).toBe(true);
    expect(policyDocumentSchema.safeParse(JSON.parse(STARTER_POLICY)).success).toBe(true);
  });
});

describe('generated API types', () => {
  it('match docs/api/openapi.json (regenerate with `pnpm --filter @aperture/web api:types`)', async () => {
    const { default: openapiTS, astToString, COMMENT_HEADER } = await import('openapi-typescript');
    const spec = new URL('../../../docs/api/openapi.json', import.meta.url);
    const generated = COMMENT_HEADER + astToString(await openapiTS(spec, { defaultNonNullable: false }));
    const committed = readFileSync(new URL('./api/schema.d.ts', import.meta.url), 'utf8');
    expect(generated.replaceAll('\r\n', '\n')).toBe(committed.replaceAll('\r\n', '\n'));
  });
});
