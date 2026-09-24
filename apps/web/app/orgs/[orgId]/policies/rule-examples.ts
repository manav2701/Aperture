import type { PolicyDocumentInput, RuleType } from '@aperture/core';

type StoredRule = PolicyDocumentInput['rules'][number];

/** One example per rule type; `satisfies` makes the compiler flag a missing or malformed one. */
export const RULE_EXAMPLES = {
  allow_rails: { id: 'rails', type: 'allow_rails', rails: ['gateway', 'provider'] },
  allow_providers: { id: 'providers', type: 'allow_providers', providers: ['openai', 'anthropic'] },
  deny_providers: { id: 'no-runway', type: 'deny_providers', providers: ['runway'] },
  allow_models: { id: 'models', type: 'allow_models', patterns: ['openai/gpt-5*', 'anthropic/*'] },
  deny_models: { id: 'no-o1-pro', type: 'deny_models', patterns: ['openai/o1-pro'] },
  max_amount_per_action: { id: 'per-action', type: 'max_amount_per_action', max: '5.00' },
  approval_threshold: { id: 'big-spend', type: 'approval_threshold', above: '100.00' },
  time_window: { id: 'office-hours', type: 'time_window', days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1140 },
  merchant_categories: { id: 'mcc', type: 'merchant_categories', deny: ['7995'] },
  merchant_countries: { id: 'countries', type: 'merchant_countries', allow: ['AE', 'US'] },
  x402_payees: {
    id: 'payees',
    type: 'x402_payees',
    allow: [
      {
        origin: 'https://data.example.com',
        payTo: 'MerchantWalletAddress',
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
    ],
  },
  max_output_tokens: { id: 'tokens', type: 'max_output_tokens', max: 4000 },
  prompt_logging: { id: 'logging', type: 'prompt_logging', level: 'metadata' },
  media_limits: { id: 'media', type: 'media_limits', maxVideoSeconds: 30, maxImages: 10 },
} satisfies { [T in RuleType]: Extract<StoredRule, { type: T }> };

export const STARTER_POLICY = JSON.stringify(
  { rules: [RULE_EXAMPLES.allow_providers, RULE_EXAMPLES.max_amount_per_action] },
  null,
  2,
);
