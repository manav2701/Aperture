import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatUsd, micros, parseUsd } from './money';
import {
  isWithin,
  mandateScopeSchema,
  mandateToPolicyDocument,
  type MandateScope,
  type MandateScopeInput,
} from './mandate';
import { MODEL_PATTERNS, MODELS, PAYEES, PROVIDERS, actionArb, instantArb } from './policy/arbitraries.test-helper';
import { evaluatePolicy } from './policy/evaluate';
import { matchesModel, patternWithin } from './policy/patterns';
import { RAILS } from './rails';

const scope = (input: Partial<MandateScopeInput> = {}): MandateScope =>
  mandateScopeSchema.parse({
    rails: ['gateway', 'x402'],
    budget: { limit: '50', period: 'none' },
    notBefore: '2026-09-01T00:00:00Z',
    expiresAt: '2026-10-01T00:00:00Z',
    purpose: 'Q4 market research',
    ...input,
  });

const violations = (child: MandateScope, parent: MandateScope, allowance = {}) => {
  const result = isWithin(child, parent, allowance);
  return result.ok ? [] : result.violations;
};

describe('isWithin', () => {
  const parent = scope({
    providers: ['openrouter'],
    models: ['anthropic/claude-*'],
    maxPerAction: '5',
    maxUses: 100,
  });

  it('accepts a strictly narrower child', () => {
    const child = scope({
      rails: ['gateway'],
      providers: ['openrouter'],
      models: ['anthropic/claude-sonnet-5'],
      maxPerAction: '1',
      budget: { limit: '10', period: 'day' },
      notBefore: '2026-09-10T00:00:00Z',
      expiresAt: '2026-09-11T00:00:00Z',
      maxUses: 20,
    });
    expect(isWithin(child, parent)).toEqual({ ok: true });
  });

  it('lists every way a child widens its parent (P2)', () => {
    const child = scope({
      rails: ['gateway', 'card'],
      models: ['anthropic/*'],
      maxPerAction: '6',
      budget: { limit: '51', period: 'none' },
      notBefore: '2026-08-31T00:00:00Z',
      expiresAt: '2026-10-02T00:00:00Z',
    });
    expect(violations(child, parent)).toEqual([
      'rails not granted by parent: card',
      'parent restricts providers; child must too',
      'models not granted by parent: anthropic/*',
      'per-action cap exceeds parent',
      'budget exceeds parent budget',
      'starts before parent',
      'expires after parent',
      'parent limits uses; child must too',
    ]);
  });

  it('bounds the child by what the parent has left', () => {
    const child = scope({
      providers: ['openrouter'],
      models: ['anthropic/claude-opus-5'],
      maxPerAction: '1',
      budget: { limit: '20', period: 'none' },
      maxUses: 10,
    });
    expect(violations(child, parent, { remainingBudget: parseUsd('15'), remainingUses: 5 })).toEqual([
      'budget exceeds what the parent has left (15.00 USD)',
      'uses exceed what the parent has left',
    ]);
  });

  it('rejects invalid scopes', () => {
    const base = { rails: ['gateway'], budget: { limit: '1', period: 'none' }, purpose: 'x' };
    expect(() =>
      mandateScopeSchema.parse({ ...base, notBefore: '2026-09-02T00:00:00Z', expiresAt: '2026-09-01T00:00:00Z' }),
    ).toThrow();
    expect(() =>
      mandateScopeSchema.parse({
        ...base,
        rails: ['gateway', 'gateway'],
        notBefore: '2026-09-01T00:00:00Z',
        expiresAt: '2026-09-02T00:00:00Z',
      }),
    ).toThrow();
    expect(() =>
      mandateScopeSchema.parse({
        ...base,
        providers: [],
        notBefore: '2026-09-01T00:00:00Z',
        expiresAt: '2026-09-02T00:00:00Z',
      }),
    ).toThrow();
  });
});

describe('model patterns', () => {
  const pattern = fc.constantFrom(...MODEL_PATTERNS);
  const model = fc.constantFrom(...MODELS, 'anthropic/claude', 'openai/o3', 'x');

  it('patternWithin is sound: an inner pattern never matches a model its outer pattern rejects', () => {
    fc.assert(
      fc.property(pattern, pattern, model, (inner, outer, candidate) => {
        if (patternWithin(inner, outer) && matchesModel(inner, candidate)) {
          expect(matchesModel(outer, candidate)).toBe(true);
        }
      }),
    );
  });

  it('every pattern is within itself and within *', () => {
    fc.assert(
      fc.property(pattern, (p) => {
        expect(patternWithin(p, p)).toBe(true);
        expect(patternWithin(p, '*')).toBe(true);
      }),
    );
  });
});

const subsetOf = <T>(values: readonly T[]) => fc.uniqueArray(fc.constantFrom(...values), { minLength: 1 });
const optional = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

const scopeArb: fc.Arbitrary<MandateScope> = fc
  .record({
    rails: subsetOf(RAILS),
    providers: optional(subsetOf(PROVIDERS)),
    models: optional(subsetOf(MODEL_PATTERNS)),
    payees: optional(subsetOf(PAYEES)),
    maxPerAction: optional(fc.bigInt({ min: 0n, max: 20_000_000n })),
    limit: fc.bigInt({ min: 0n, max: 100_000_000n }),
  })
  .map(({ maxPerAction, limit, ...rest }) =>
    scope({
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
      ...(maxPerAction === undefined ? {} : { maxPerAction: formatUsd(micros(maxPerAction)) }),
      budget: { limit: formatUsd(micros(limit)), period: 'none' },
    }),
  );

describe('INV-9: attenuation', () => {
  const layer = (s: MandateScope) => ({
    level: 'mandate' as const,
    scopeId: 'm',
    version: 1,
    document: mandateToPolicyDocument(s),
  });

  it('a child accepted by isWithin never allows an action its parent denies', () => {
    fc.assert(
      fc.property(scopeArb, scopeArb, actionArb, instantArb, (parent, child, action, at) => {
        fc.pre(isWithin(child, parent).ok);
        const childDecision = evaluatePolicy({ action, at, timeZone: 'UTC', layers: [layer(child)] });
        const parentDecision = evaluatePolicy({ action, at, timeZone: 'UTC', layers: [layer(parent)] });
        if (childDecision.outcome === 'allow') expect(parentDecision.outcome).toBe('allow');
      }),
      { numRuns: 2_000 },
    );
  });

  it('holds for children derived by narrowing their parent', () => {
    const narrowed = scopeArb.chain((parent) =>
      fc
        .record({
          rails: subsetOf(parent.rails),
          providers: parent.providers ? subsetOf(parent.providers) : optional(subsetOf(PROVIDERS)),
          models: parent.models ? subsetOf(parent.models) : optional(subsetOf(MODEL_PATTERNS)),
          payees: parent.payees ? subsetOf(parent.payees) : optional(subsetOf(PAYEES)),
          capShare: fc.bigInt({ min: 0n, max: 100n }),
        })
        .map(({ capShare, ...child }) => ({
          parent,
          child: scope({
            ...Object.fromEntries(Object.entries(child).filter(([, value]) => value !== undefined)),
            ...(parent.maxPerAction === undefined
              ? {}
              : { maxPerAction: formatUsd(micros((parent.maxPerAction * capShare) / 100n)) }),
            budget: { limit: formatUsd(micros((parent.budget.limit * capShare) / 100n)), period: 'none' },
          }),
        })),
    );
    fc.assert(
      fc.property(narrowed, actionArb, instantArb, ({ parent, child }, action, at) => {
        expect(isWithin(child, parent)).toEqual({ ok: true });
        const childDecision = evaluatePolicy({ action, at, timeZone: 'UTC', layers: [layer(child)] });
        const parentDecision = evaluatePolicy({ action, at, timeZone: 'UTC', layers: [layer(parent)] });
        if (childDecision.outcome === 'allow') expect(parentDecision.outcome).toBe('allow');
      }),
      { numRuns: 2_000 },
    );
  });

  it('a mandate always produces a valid policy document', () => {
    fc.assert(
      fc.property(scopeArb, actionArb, instantArb, (s, action, at) => {
        const decision = evaluatePolicy({ action, at, timeZone: 'UTC', layers: [layer(s)] });
        expect(decision.reasons.map((reason) => reason.code)).not.toContain('policy_invalid');
      }),
    );
  });
});
