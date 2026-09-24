import { z } from 'zod';
import { MoneyError, parseUsd } from '../money';
import { RAILS } from '../rails';
import { modelPatternSchema } from './patterns';

/** USD amounts in policy documents are decimal strings ("5.00"), parsed to µUSD. */
export const usdAmountSchema = z.string().transform((value, ctx) => {
  try {
    return parseUsd(value);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof MoneyError ? error.message : 'invalid amount' });
    return z.NEVER;
  }
});

const railSchema = z.enum(RAILS);
const nonEmptyUnique = <T extends z.ZodType<string | number>>(item: T) =>
  z
    .array(item)
    .min(1)
    .max(1_000)
    .refine((values) => new Set(values).size === values.length, 'values must be unique');

export const payeeSchema = z.object({
  /** Origin of the paid API, e.g. "https://data.example.com". */
  origin: z.string().min(1).max(300),
  payTo: z.string().min(1).max(100),
  /** CAIP-2 network id, e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp". */
  network: z.string().min(1).max(100),
  /** Token mint / asset id. */
  asset: z.string().min(1).max(100),
});
export type Payee = z.infer<typeof payeeSchema>;

export const PROMPT_LOGGING_LEVELS = ['off', 'metadata', 'full'] as const;
export type PromptLogging = (typeof PROMPT_LOGGING_LEVELS)[number];

const ruleId = z.string().min(1).max(100);

export const ruleSchema = z.discriminatedUnion('type', [
  z.object({ id: ruleId, type: z.literal('allow_rails'), rails: nonEmptyUnique(railSchema) }),
  z.object({ id: ruleId, type: z.literal('allow_providers'), providers: nonEmptyUnique(z.string().min(1).max(100)) }),
  z.object({ id: ruleId, type: z.literal('deny_providers'), providers: nonEmptyUnique(z.string().min(1).max(100)) }),
  z.object({ id: ruleId, type: z.literal('allow_models'), patterns: nonEmptyUnique(modelPatternSchema) }),
  z.object({ id: ruleId, type: z.literal('deny_models'), patterns: nonEmptyUnique(modelPatternSchema) }),
  z.object({ id: ruleId, type: z.literal('max_amount_per_action'), rail: railSchema.optional(), max: usdAmountSchema }),
  z.object({ id: ruleId, type: z.literal('approval_threshold'), rail: railSchema.optional(), above: usdAmountSchema }),
  z
    .object({
      id: ruleId,
      type: z.literal('time_window'),
      /** ISO weekdays: 1 = Monday … 7 = Sunday, in the org's timezone. */
      days: nonEmptyUnique(z.number().int().min(1).max(7)),
      /** Minutes after local midnight; start inclusive, end exclusive. Windows can't cross midnight. */
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(1).max(1440),
    })
    .refine((rule) => rule.startMinute < rule.endMinute, 'startMinute must be before endMinute'),
  z
    .object({
      id: ruleId,
      type: z.literal('merchant_categories'),
      allow: nonEmptyUnique(z.string().min(1).max(100)).optional(),
      deny: nonEmptyUnique(z.string().min(1).max(100)).optional(),
    })
    .refine((rule) => rule.allow ?? rule.deny, 'allow or deny is required'),
  z
    .object({
      id: ruleId,
      type: z.literal('merchant_countries'),
      allow: nonEmptyUnique(z.string().regex(/^[A-Z]{2}$/)).optional(),
      deny: nonEmptyUnique(z.string().regex(/^[A-Z]{2}$/)).optional(),
    })
    .refine((rule) => rule.allow ?? rule.deny, 'allow or deny is required'),
  z.object({ id: ruleId, type: z.literal('x402_payees'), allow: z.array(payeeSchema).min(1).max(1_000) }),
  z.object({ id: ruleId, type: z.literal('max_output_tokens'), max: z.number().int().min(1).max(10_000_000) }),
  z.object({ id: ruleId, type: z.literal('prompt_logging'), level: z.enum(PROMPT_LOGGING_LEVELS) }),
  z
    .object({
      id: ruleId,
      type: z.literal('media_limits'),
      maxVideoSeconds: z.number().int().min(1).max(3_600).optional(),
      maxImages: z.number().int().min(1).max(1_000).optional(),
    })
    .refine((rule) => rule.maxVideoSeconds !== undefined || rule.maxImages !== undefined, 'set at least one limit'),
]);
export type Rule = z.infer<typeof ruleSchema>;
export type RuleType = Rule['type'];

export const policyDocumentSchema = z
  .object({ rules: z.array(ruleSchema).max(500) })
  .refine((doc) => new Set(doc.rules.map((rule) => rule.id)).size === doc.rules.length, 'rule ids must be unique');
/** A policy document as stored (amounts as decimal strings). */
export type PolicyDocumentInput = z.input<typeof policyDocumentSchema>;
export type PolicyDocument = z.output<typeof policyDocumentSchema>;

export const POLICY_LEVELS = ['org', 'team', 'principal', 'mandate'] as const;
export type PolicyLevel = (typeof POLICY_LEVELS)[number];

export interface PolicyLayer {
  level: PolicyLevel;
  scopeId: string;
  version: number;
  /** Validated during evaluation; an invalid document denies. */
  document: unknown;
}
