import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseUsd } from '../money';
import { actionArb, documentArb, instantArb, layersArb, ruleArb } from './arbitraries.test-helper';
import { evaluatePolicy, type ActionInput, type Decision, type DecisionInput } from './evaluate';
import type { PolicyLayer, PolicyLevel } from './schema';

// Wednesday 23 Sep 2026, 10:00 in Dubai (06:00 UTC).
const wednesdayMorning = new Date('2026-09-23T06:00:00Z');

const layer = (document: unknown, level: PolicyLevel = 'org', version = 1): PolicyLayer => ({
  level,
  scopeId: `${level}-1`,
  version,
  document,
});

const decide = (action: Partial<ActionInput>, layers: PolicyLayer[], at = wednesdayMorning): Decision =>
  evaluatePolicy({
    action: { rail: 'gateway', amount: parseUsd('1'), provider: 'openrouter', model: 'openai/gpt-4o-mini', ...action },
    at,
    timeZone: 'Asia/Dubai',
    layers,
  });

const codes = (decision: Decision) => decision.reasons.map((reason) => reason.code);

describe('evaluatePolicy rules', () => {
  it('allows when there are no rules', () => {
    expect(decide({}, [layer({ rules: [] })]).outcome).toBe('allow');
  });

  it('restricts providers and models on AI rails only', () => {
    const policy = layer({
      rules: [
        { id: 'p', type: 'allow_providers', providers: ['openrouter'] },
        { id: 'm', type: 'allow_models', patterns: ['anthropic/claude-*'] },
      ],
    });
    expect(codes(decide({ model: 'openai/gpt-4o-mini' }, [policy]))).toEqual(['model_not_allowed']);
    expect(decide({ model: 'anthropic/claude-sonnet-5' }, [policy]).outcome).toBe('allow');
    expect(codes(decide({ provider: 'openai', model: 'anthropic/claude-sonnet-5' }, [policy]))).toEqual([
      'provider_not_allowed',
    ]);
    const card: Partial<ActionInput> = { rail: 'card', merchant: { category: 'airlines_air_carriers', country: 'AE' } };
    expect(decide(card, [policy]).outcome).toBe('allow');
  });

  it('fails closed when an AI action has no provider or model', () => {
    const policy = layer({ rules: [{ id: 'm', type: 'allow_models', patterns: ['*'] }] });
    const withoutModel: ActionInput = { rail: 'gateway', amount: parseUsd('1'), provider: 'openrouter' };
    const decision = evaluatePolicy({ action: withoutModel, at: wednesdayMorning, timeZone: 'UTC', layers: [policy] });
    expect(codes(decision)).toEqual(['model_unknown']);
  });

  it('denies listed providers and models', () => {
    const policy = layer({
      rules: [
        { id: 'dp', type: 'deny_providers', providers: ['google'] },
        { id: 'dm', type: 'deny_models', patterns: ['openai/*'] },
      ],
    });
    expect(codes(decide({ model: 'openai/gpt-4o' }, [policy]))).toEqual(['model_denied']);
    expect(codes(decide({ provider: 'google', model: 'google/gemini-3-pro' }, [policy]))).toEqual(['provider_denied']);
  });

  it('applies per-action caps and approval thresholds, optionally per rail', () => {
    const policy = layer({
      rules: [
        { id: 'cap', type: 'max_amount_per_action', max: '5' },
        { id: 'cardApproval', type: 'approval_threshold', rail: 'card', above: '2' },
      ],
    });
    expect(decide({ amount: parseUsd('5') }, [policy]).outcome).toBe('allow');
    expect(codes(decide({ amount: parseUsd('5.000001') }, [policy]))).toEqual(['amount_over_limit']);
    expect(decide({ rail: 'gateway', amount: parseUsd('3') }, [policy]).outcome).toBe('allow');
    const card = decide({ rail: 'card', amount: parseUsd('3') }, [policy]);
    expect(card.outcome).toBe('require_approval');
    expect(codes(card)).toEqual(['approval_required']);
  });

  it('deny wins over approval', () => {
    const policy = layer({
      rules: [
        { id: 'a', type: 'approval_threshold', above: '1' },
        { id: 'c', type: 'max_amount_per_action', max: '2' },
      ],
    });
    expect(decide({ amount: parseUsd('3') }, [policy]).outcome).toBe('deny');
  });

  it('evaluates time windows in the org timezone, start inclusive and end exclusive (P9)', () => {
    // Sun–Thu (Dubai work week), 08:00–20:00.
    const policy = layer({
      rules: [{ id: 'hours', type: 'time_window', days: [7, 1, 2, 3, 4], startMinute: 480, endMinute: 1200 }],
    });
    expect(decide({}, [policy], new Date('2026-09-23T04:00:00Z')).outcome).toBe('allow'); // 08:00 Wed
    expect(decide({}, [policy], new Date('2026-09-23T03:59:59Z')).outcome).toBe('deny'); // 07:59 Wed
    expect(decide({}, [policy], new Date('2026-09-23T16:00:00Z')).outcome).toBe('deny'); // 20:00 Wed
    expect(decide({}, [policy], new Date('2026-09-25T06:00:00Z')).outcome).toBe('deny'); // Fri
  });

  it('checks merchant category and country on cards, preferring deny', () => {
    const policy = layer({
      rules: [
        { id: 'mcc', type: 'merchant_categories', allow: ['airlines_air_carriers'], deny: ['restaurants'] },
        { id: 'geo', type: 'merchant_countries', allow: ['AE', 'US'] },
      ],
    });
    const card = (category: string, country: string) =>
      decide({ rail: 'card', merchant: { category, country } }, [policy]);
    expect(card('airlines_air_carriers', 'AE').outcome).toBe('allow');
    expect(codes(card('restaurants', 'AE'))).toEqual(['merchant_category_denied']);
    expect(codes(card('hotels_motels_and_resorts', 'GB'))).toEqual([
      'merchant_category_not_allowed',
      'merchant_country_not_allowed',
    ]);
    expect(codes(decide({ rail: 'card' }, [policy]))).toContain('merchant_category_unknown');
  });

  it('requires x402 payees to match the allowlist exactly (X1)', () => {
    const payee = { origin: 'https://data.example.com', payTo: 'PayToA', network: 'solana:devnet', asset: 'USDC' };
    const policy = layer({ rules: [{ id: 'payees', type: 'x402_payees', allow: [payee] }] });
    expect(decide({ rail: 'x402', payee }, [policy]).outcome).toBe('allow');
    expect(codes(decide({ rail: 'x402', payee: { ...payee, payTo: 'Attacker' } }, [policy]))).toEqual([
      'payee_not_allowed',
    ]);
  });

  it('enforces media limits', () => {
    const policy = layer({ rules: [{ id: 'media', type: 'media_limits', maxVideoSeconds: 10, maxImages: 4 }] });
    expect(decide({ media: { videoSeconds: 10 } }, [policy]).outcome).toBe('allow');
    expect(codes(decide({ media: { videoSeconds: 11 } }, [policy]))).toEqual(['media_over_limit']);
    expect(codes(decide({ media: { images: 5 } }, [policy]))).toEqual(['media_over_limit']);
  });

  it('merges obligations to the most restrictive value across layers', () => {
    const decision = decide({}, [
      layer({
        rules: [
          { id: 't', type: 'max_output_tokens', max: 8_000 },
          { id: 'l', type: 'prompt_logging', level: 'full' },
        ],
      }),
      layer(
        {
          rules: [
            { id: 't2', type: 'max_output_tokens', max: 2_000 },
            { id: 'l2', type: 'prompt_logging', level: 'metadata' },
          ],
        },
        'team',
      ),
    ]);
    expect(decision.obligations).toEqual({ maxOutputTokens: 2_000, promptLogging: 'metadata' });
  });

  it('requires every layer to allow (P1: a team cannot override an org deny)', () => {
    const org = layer({ rules: [{ id: 'no-openai', type: 'deny_models', patterns: ['openai/*'] }] }, 'org');
    const team = layer({ rules: [{ id: 'only-openai', type: 'allow_models', patterns: ['openai/*'] }] }, 'team');
    const decision = decide({ model: 'openai/gpt-4o' }, [org, team]);
    expect(decision.outcome).toBe('deny');
    expect(decision.reasons[0]).toMatchObject({ level: 'org', ruleId: 'no-openai' });
  });

  it('records the policy versions it used', () => {
    expect(decide({}, [layer({ rules: [] }, 'org', 7)]).layers).toEqual([
      { level: 'org', scopeId: 'org-1', version: 7 },
    ]);
  });
});

describe('fail closed (P8, INV-10)', () => {
  it('denies when a policy document is invalid', () => {
    const invalid = [
      { rules: [{ id: 'x', type: 'max_amount_per_action', max: '1.0000001' }] },
      { rules: [{ id: 'x', type: 'time_window', days: [1], startMinute: 600, endMinute: 600 }] },
      {
        rules: [
          { id: 'dup', type: 'deny_models', patterns: ['*'] },
          { id: 'dup', type: 'deny_providers', providers: ['a'] },
        ],
      },
      { rules: [{ id: 'x', type: 'allow_models', patterns: ['open*ai'] }] },
      { rules: [{ id: 'x', type: 'unknown_rule' }] },
      'not an object',
      null,
    ];
    for (const document of invalid) {
      expect(codes(decide({}, [layer(document)]))).toContain('policy_invalid');
    }
  });

  it('never throws and never allows for arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const decision = evaluatePolicy(input as DecisionInput);
        expect(decision.outcome).toBe('deny');
      }),
      { numRuns: 1_000 },
    );
  });

  it('never throws and never allows when a layer holds arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), actionArb, (document, action) => {
        const decision = evaluatePolicy({ action, at: wednesdayMorning, timeZone: 'UTC', layers: [layer(document)] });
        const valid = typeof document === 'object' && document !== null && 'rules' in document;
        if (!valid) expect(decision.outcome).toBe('deny');
      }),
      { numRuns: 1_000 },
    );
  });
});

const rank = { allow: 0, require_approval: 1, deny: 2 } as const;

describe('properties', () => {
  it('INV-7: adding a rule never makes a decision more permissive', () => {
    fc.assert(
      fc.property(layersArb, ruleArb, actionArb, instantArb, fc.nat(), (layers, extra, action, at, pick) => {
        fc.pre(layers.length > 0);
        const before = evaluatePolicy({ action, at, timeZone: 'Asia/Dubai', layers });
        const target = pick % layers.length;
        const extended = layers.map((l, index) =>
          index === target
            ? { ...l, document: { rules: [...(l.document as { rules: unknown[] }).rules, { ...extra, id: 'extra' }] } }
            : l,
        );
        const after = evaluatePolicy({ action, at, timeZone: 'Asia/Dubai', layers: extended });
        expect(rank[after.outcome]).toBeGreaterThanOrEqual(rank[before.outcome]);
        if (before.obligations.maxOutputTokens !== undefined) {
          expect(after.obligations.maxOutputTokens).toBeLessThanOrEqual(before.obligations.maxOutputTokens);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('INV-8: an action allowed with all layers is allowed by every prefix of the layer chain', () => {
    fc.assert(
      fc.property(layersArb, actionArb, instantArb, (layers, action, at) => {
        const full = evaluatePolicy({ action, at, timeZone: 'Asia/Dubai', layers });
        for (let k = 0; k <= layers.length; k += 1) {
          const prefix = evaluatePolicy({ action, at, timeZone: 'Asia/Dubai', layers: layers.slice(0, k) });
          expect(rank[prefix.outcome]).toBeLessThanOrEqual(rank[full.outcome]);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic for equal inputs', () => {
    fc.assert(
      fc.property(documentArb, actionArb, instantArb, (document, action, at) => {
        const input = { action, at, timeZone: 'Asia/Dubai', layers: [layer(document)] };
        expect(evaluatePolicy(input)).toEqual(evaluatePolicy(structuredClone(input)));
      }),
    );
  });
});
