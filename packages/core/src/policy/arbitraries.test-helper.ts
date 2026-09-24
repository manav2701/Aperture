// fast-check generators shared by the policy and mandate property tests.
import fc from 'fast-check';
import { formatUsd, micros } from '../money';
import { RAILS } from '../rails';
import type { ActionInput } from './evaluate';
import type { PolicyLayer } from './schema';

export const PROVIDERS = ['openrouter', 'openai', 'anthropic', 'google'] as const;
export const MODELS = [
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'google/gemini-3-pro',
] as const;
export const MODEL_PATTERNS = [...MODELS, 'openai/*', 'anthropic/*', 'anthropic/claude-*', 'google/*', '*'] as const;
const CATEGORIES = ['airlines_air_carriers', 'hotels_motels_and_resorts', 'computer_software_stores', 'restaurants'];
const COUNTRIES = ['AE', 'US', 'GB', 'IN'];
export const PAYEES = [
  { origin: 'https://data.example.com', payTo: 'PayToA', network: 'solana:devnet', asset: 'USDC' },
  { origin: 'https://data.example.com', payTo: 'PayToB', network: 'solana:devnet', asset: 'USDC' },
  { origin: 'https://compute.example.com', payTo: 'PayToC', network: 'solana:devnet', asset: 'USDT' },
];

const usdString = fc.bigInt({ min: 0n, max: 50_000_000n }).map((value) => formatUsd(micros(value)));
const subset = <T>(values: readonly T[]) => fc.uniqueArray(fc.constantFrom(...values), { minLength: 1 });

let ruleCounter = 0;
const id = () => `r${String((ruleCounter += 1))}`;

export const ruleArb = fc.oneof(
  subset(RAILS).map((rails) => ({ id: id(), type: 'allow_rails', rails })),
  subset(PROVIDERS).map((providers) => ({ id: id(), type: 'allow_providers', providers })),
  subset(PROVIDERS).map((providers) => ({ id: id(), type: 'deny_providers', providers })),
  subset(MODEL_PATTERNS).map((patterns) => ({ id: id(), type: 'allow_models', patterns })),
  subset(MODEL_PATTERNS).map((patterns) => ({ id: id(), type: 'deny_models', patterns })),
  fc.record({ rail: fc.option(fc.constantFrom(...RAILS), { nil: undefined }), max: usdString }).map((r) => ({
    id: id(),
    type: 'max_amount_per_action',
    ...(r.rail ? { rail: r.rail } : {}),
    max: r.max,
  })),
  fc.record({ rail: fc.option(fc.constantFrom(...RAILS), { nil: undefined }), above: usdString }).map((r) => ({
    id: id(),
    type: 'approval_threshold',
    ...(r.rail ? { rail: r.rail } : {}),
    above: r.above,
  })),
  fc
    .tuple(subset([1, 2, 3, 4, 5, 6, 7]), fc.integer({ min: 0, max: 1438 }), fc.integer({ min: 1, max: 1440 }))
    .filter(([, start, end]) => start < end)
    .map(([days, startMinute, endMinute]) => ({ id: id(), type: 'time_window', days, startMinute, endMinute })),
  subset(CATEGORIES).map((allow) => ({ id: id(), type: 'merchant_categories', allow })),
  subset(CATEGORIES).map((deny) => ({ id: id(), type: 'merchant_categories', deny })),
  subset(COUNTRIES).map((allow) => ({ id: id(), type: 'merchant_countries', allow })),
  fc
    .uniqueArray(fc.constantFrom(...PAYEES), { minLength: 1 })
    .map((allow) => ({ id: id(), type: 'x402_payees', allow })),
  fc.integer({ min: 1, max: 100_000 }).map((max) => ({ id: id(), type: 'max_output_tokens', max })),
  fc.constantFrom('off', 'metadata', 'full').map((level) => ({ id: id(), type: 'prompt_logging', level })),
  fc.integer({ min: 1, max: 60 }).map((maxVideoSeconds) => ({ id: id(), type: 'media_limits', maxVideoSeconds })),
);

export const documentArb = fc.array(ruleArb, { maxLength: 6 }).map((rules) => ({ rules }));

export const layersArb = fc.array(documentArb, { maxLength: 4 }).map((documents): PolicyLayer[] =>
  documents.map((document, index) => ({
    level: 'principal',
    scopeId: `scope-${String(index)}`,
    version: 1,
    document,
  })),
);

export const actionArb: fc.Arbitrary<ActionInput> = fc.record(
  {
    rail: fc.constantFrom(...RAILS),
    amount: fc.bigInt({ min: 0n, max: 60_000_000n }).map(micros),
    provider: fc.constantFrom(...PROVIDERS),
    model: fc.constantFrom(...MODELS),
    merchant: fc.record({ category: fc.constantFrom(...CATEGORIES), country: fc.constantFrom(...COUNTRIES) }),
    payee: fc.constantFrom(...PAYEES),
    media: fc.record({ videoSeconds: fc.integer({ min: 0, max: 90 }) }),
  },
  { requiredKeys: ['rail', 'amount'] },
);

export const instantArb = fc.date({
  min: new Date('2026-01-01T00:00:00Z'),
  max: new Date('2027-12-31T00:00:00Z'),
  noInvalidDate: true,
});
