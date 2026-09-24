import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { MAX_ABS_MICROS, type Micros } from '../money';
import { isValidTimeZone } from '../period';
import { RAILS, type Rail } from '../rails';
import { matchesModel } from './patterns';
import {
  PROMPT_LOGGING_LEVELS,
  payeeSchema,
  policyDocumentSchema,
  type PolicyLayer,
  type PolicyLevel,
  type PromptLogging,
  type Rule,
} from './schema';

export interface ActionInput {
  rail: Rail;
  /** Estimated cost of the action in µUSD (or the exact amount for cards and x402). */
  amount: Micros;
  provider?: string;
  model?: string;
  merchant?: { category?: string; country?: string; name?: string };
  payee?: { origin: string; payTo: string; network: string; asset: string };
  media?: { videoSeconds?: number; images?: number };
}

export interface DecisionInput {
  action: ActionInput;
  /** When the action happens; callers pass the database's clock, not the app's. */
  at: Date;
  /** The org's IANA timezone, used for time windows. */
  timeZone: string;
  /** Every layer must allow: org, team, principal (and its ancestors), mandate. */
  layers: readonly PolicyLayer[];
}

export type DecisionOutcome = 'allow' | 'deny' | 'require_approval';

export interface Reason {
  code: string;
  message: string;
  ruleId?: string;
  level?: PolicyLevel;
  scopeId?: string;
}

export interface Obligations {
  /** Cap on output tokens the gateway must enforce (injected into the request). */
  maxOutputTokens?: number;
  promptLogging?: PromptLogging;
}

export interface Decision {
  outcome: DecisionOutcome;
  reasons: Reason[];
  obligations: Obligations;
  /** Policy versions used, for the audit record. */
  layers: { level: PolicyLevel; scopeId: string; version: number }[];
}

const decisionInputSchema = z.object({
  action: z.object({
    rail: z.enum(RAILS),
    amount: z.bigint().min(0n).max(MAX_ABS_MICROS),
    provider: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(200).optional(),
    merchant: z
      .object({
        category: z.string().max(100).optional(),
        country: z.string().max(10).optional(),
        name: z.string().max(200).optional(),
      })
      .optional(),
    payee: payeeSchema.optional(),
    media: z
      .object({ videoSeconds: z.number().int().min(0).optional(), images: z.number().int().min(0).optional() })
      .optional(),
  }),
  at: z.date().refine((date) => !Number.isNaN(date.getTime()), 'invalid date'),
  timeZone: z.string().refine(isValidTimeZone, 'unknown time zone'),
  layers: z
    .array(
      z.object({
        level: z.enum(['org', 'team', 'principal', 'mandate']),
        scopeId: z.string().min(1),
        version: z.number().int().min(0),
        document: z.unknown(),
      }),
    )
    .max(50),
});

type RuleResult = { kind: 'deny' | 'approval'; code: string; message: string } | { kind: 'pass' };

const pass: RuleResult = { kind: 'pass' };
const deny = (code: string, message: string): RuleResult => ({ kind: 'deny', code, message });

/** Rails where provider and model attributes are meaningful. */
const aiRails: readonly Rail[] = ['gateway', 'provider'];

function evaluateRule(rule: Rule, action: ActionInput, at: Date, timeZone: string): RuleResult {
  const aiRail = aiRails.includes(action.rail);
  switch (rule.type) {
    case 'allow_rails':
      return rule.rails.includes(action.rail) ? pass : deny('rail_not_allowed', `rail ${action.rail} is not allowed`);
    case 'allow_providers':
      if (!aiRail) return pass;
      if (action.provider === undefined) return deny('provider_unknown', 'the provider could not be determined');
      return rule.providers.includes(action.provider)
        ? pass
        : deny('provider_not_allowed', `provider ${action.provider} is not allowed`);
    case 'deny_providers':
      return aiRail && action.provider !== undefined && rule.providers.includes(action.provider)
        ? deny('provider_denied', `provider ${action.provider} is denied`)
        : pass;
    case 'allow_models':
      if (!aiRail) return pass;
      if (action.model === undefined) return deny('model_unknown', 'the model could not be determined');
      return rule.patterns.some((pattern) => matchesModel(pattern, action.model ?? ''))
        ? pass
        : deny('model_not_allowed', `model ${action.model} is not allowed`);
    case 'deny_models': {
      const model = action.model;
      return aiRail && model !== undefined && rule.patterns.some((pattern) => matchesModel(pattern, model))
        ? deny('model_denied', `model ${model} is denied`)
        : pass;
    }
    case 'max_amount_per_action':
      if (rule.rail !== undefined && rule.rail !== action.rail) return pass;
      return action.amount > rule.max ? deny('amount_over_limit', 'amount exceeds the per-action limit') : pass;
    case 'approval_threshold':
      if (rule.rail !== undefined && rule.rail !== action.rail) return pass;
      return action.amount > rule.above
        ? { kind: 'approval', code: 'approval_required', message: 'amount is above the approval threshold' }
        : pass;
    case 'time_window': {
      const local = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
      const minute = local.hour * 60 + local.minute;
      const inside = rule.days.includes(local.dayOfWeek) && minute >= rule.startMinute && minute < rule.endMinute;
      return inside ? pass : deny('outside_time_window', 'outside the allowed time window');
    }
    case 'merchant_categories': {
      if (action.rail !== 'card') return pass;
      const category = action.merchant?.category;
      if (category === undefined) return deny('merchant_category_unknown', 'the merchant category is unknown');
      if (rule.deny?.includes(category)) return deny('merchant_category_denied', `category ${category} is denied`);
      if (rule.allow && !rule.allow.includes(category)) {
        return deny('merchant_category_not_allowed', `category ${category} is not allowed`);
      }
      return pass;
    }
    case 'merchant_countries': {
      if (action.rail !== 'card') return pass;
      const country = action.merchant?.country;
      if (country === undefined) return deny('merchant_country_unknown', 'the merchant country is unknown');
      if (rule.deny?.includes(country)) return deny('merchant_country_denied', `country ${country} is denied`);
      if (rule.allow && !rule.allow.includes(country)) {
        return deny('merchant_country_not_allowed', `country ${country} is not allowed`);
      }
      return pass;
    }
    case 'x402_payees': {
      if (action.rail !== 'x402') return pass;
      const payee = action.payee;
      if (payee === undefined) return deny('payee_unknown', 'the payee is unknown');
      const allowed = rule.allow.some(
        (entry) =>
          entry.origin === payee.origin &&
          entry.payTo === payee.payTo &&
          entry.network === payee.network &&
          entry.asset === payee.asset,
      );
      return allowed ? pass : deny('payee_not_allowed', `payee ${payee.payTo} for ${payee.origin} is not allowed`);
    }
    case 'media_limits': {
      const media = action.media;
      if (media === undefined) return pass;
      if (rule.maxVideoSeconds !== undefined && (media.videoSeconds ?? 0) > rule.maxVideoSeconds) {
        return deny('media_over_limit', `video longer than ${String(rule.maxVideoSeconds)} seconds`);
      }
      if (rule.maxImages !== undefined && (media.images ?? 0) > rule.maxImages) {
        return deny('media_over_limit', `more than ${String(rule.maxImages)} images`);
      }
      return pass;
    }
    case 'max_output_tokens':
    case 'prompt_logging':
      return pass;
  }
}

const loggingRank = (level: PromptLogging) => PROMPT_LOGGING_LEVELS.indexOf(level);

function failClosed(code: string, message: string): Decision {
  return { outcome: 'deny', reasons: [{ code, message }], obligations: {}, layers: [] };
}

/**
 * Decides whether an action is allowed. Pure and total: any invalid input or policy, or any
 * unexpected error, produces `deny` — never an exception and never an accidental allow.
 * Budgets are not checked here; the ledger does that inside the reserve transaction.
 */
export function evaluatePolicy(input: DecisionInput): Decision {
  try {
    const parsedInput = decisionInputSchema.safeParse(input);
    if (!parsedInput.success) return failClosed('input_invalid', 'the decision input is invalid');
    const { action, at, timeZone, layers } = input;

    const reasons: Reason[] = [];
    const approvals: Reason[] = [];
    const obligations: Obligations = {};

    for (const layer of layers) {
      const context = { level: layer.level, scopeId: layer.scopeId };
      const document = policyDocumentSchema.safeParse(layer.document);
      if (!document.success) {
        reasons.push({ code: 'policy_invalid', message: `the ${layer.level} policy is invalid`, ...context });
        continue;
      }
      for (const rule of document.data.rules) {
        if (rule.type === 'max_output_tokens') {
          obligations.maxOutputTokens = Math.min(obligations.maxOutputTokens ?? rule.max, rule.max);
        } else if (rule.type === 'prompt_logging') {
          const current = obligations.promptLogging;
          if (current === undefined || loggingRank(rule.level) < loggingRank(current))
            obligations.promptLogging = rule.level;
        }
        const result = evaluateRule(rule, action, at, timeZone);
        if (result.kind === 'pass') continue;
        const reason: Reason = { code: result.code, message: result.message, ruleId: rule.id, ...context };
        (result.kind === 'deny' ? reasons : approvals).push(reason);
      }
    }

    const outcome: DecisionOutcome = reasons.length > 0 ? 'deny' : approvals.length > 0 ? 'require_approval' : 'allow';
    return {
      outcome,
      reasons: outcome === 'deny' ? reasons : approvals,
      obligations,
      layers: layers.map(({ level, scopeId, version }) => ({ level, scopeId, version })),
    };
  } catch {
    return failClosed('policy_error', 'the policy could not be evaluated');
  }
}
