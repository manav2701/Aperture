import { z } from 'zod';
import { formatUsd, type Micros } from './money';
import { PERIODS } from './period';
import { modelPatternSchema, patternWithin } from './policy/patterns';
import { payeeSchema, usdAmountSchema, type Payee, type PolicyDocumentInput } from './policy/schema';
import { RAILS } from './rails';

/**
 * What a mandate lets its holder do. An omitted list means "no restriction at this level"
 * (ancestor mandates and policies still apply); to forbid a kind of spend, leave its rail out.
 */
export const mandateScopeSchema = z
  .object({
    rails: z
      .array(z.enum(RAILS))
      .min(1)
      .refine((rails) => new Set(rails).size === rails.length, 'rails must be unique'),
    providers: z.array(z.string().min(1).max(100)).min(1).optional(),
    models: z.array(modelPatternSchema).min(1).optional(),
    payees: z.array(payeeSchema).min(1).optional(),
    maxPerAction: usdAmountSchema.optional(),
    budget: z.object({ limit: usdAmountSchema, period: z.enum(PERIODS) }),
    notBefore: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    maxUses: z.number().int().min(1).optional(),
    purpose: z.string().min(1).max(500),
  })
  .refine((scope) => Date.parse(scope.notBefore) < Date.parse(scope.expiresAt), 'notBefore must be before expiresAt');

export type MandateScopeInput = z.input<typeof mandateScopeSchema>;
export type MandateScope = z.output<typeof mandateScopeSchema>;

export interface ParentAllowance {
  /** What is left of the parent's budget right now; the child's limit may not exceed it. */
  remainingBudget?: Micros;
  /** Uses left on the parent mandate. */
  remainingUses?: number;
}

export type WithinResult = { ok: true } | { ok: false; violations: string[] };

const samePayee = (a: Payee, b: Payee) =>
  a.origin === b.origin && a.payTo === b.payTo && a.network === b.network && a.asset === b.asset;

/**
 * Attenuation check: true only if the child grants nothing the parent doesn't. Delegation can
 * narrow authority, never widen it (plan/architecture §10).
 */
export function isWithin(child: MandateScope, parent: MandateScope, allowance: ParentAllowance = {}): WithinResult {
  const violations: string[] = [];

  const extraRails = child.rails.filter((rail) => !parent.rails.includes(rail));
  if (extraRails.length > 0) violations.push(`rails not granted by parent: ${extraRails.join(', ')}`);

  if (parent.providers) {
    const parentProviders = parent.providers;
    if (!child.providers) violations.push('parent restricts providers; child must too');
    else {
      const extra = child.providers.filter((provider) => !parentProviders.includes(provider));
      if (extra.length > 0) violations.push(`providers not granted by parent: ${extra.join(', ')}`);
    }
  }

  if (parent.models) {
    const parentModels = parent.models;
    if (!child.models) violations.push('parent restricts models; child must too');
    else {
      const extra = child.models.filter((pattern) => !parentModels.some((outer) => patternWithin(pattern, outer)));
      if (extra.length > 0) violations.push(`models not granted by parent: ${extra.join(', ')}`);
    }
  }

  if (parent.payees) {
    const parentPayees = parent.payees;
    if (!child.payees) violations.push('parent restricts payees; child must too');
    else if (child.payees.some((payee) => !parentPayees.some((outer) => samePayee(payee, outer)))) {
      violations.push('payees not granted by parent');
    }
  }

  if (parent.maxPerAction !== undefined) {
    if (child.maxPerAction === undefined) violations.push('parent caps each action; child must too');
    else if (child.maxPerAction > parent.maxPerAction) violations.push('per-action cap exceeds parent');
  }

  if (child.budget.limit > parent.budget.limit) violations.push('budget exceeds parent budget');
  if (allowance.remainingBudget !== undefined && child.budget.limit > allowance.remainingBudget) {
    violations.push(`budget exceeds what the parent has left (${formatUsd(allowance.remainingBudget)} USD)`);
  }

  if (Date.parse(child.notBefore) < Date.parse(parent.notBefore)) violations.push('starts before parent');
  if (Date.parse(child.expiresAt) > Date.parse(parent.expiresAt)) violations.push('expires after parent');

  const parentUses = allowance.remainingUses ?? parent.maxUses;
  if (parentUses !== undefined) {
    if (child.maxUses === undefined) violations.push('parent limits uses; child must too');
    else if (child.maxUses > parentUses) violations.push('uses exceed what the parent has left');
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * The scope part of a mandate as a policy layer. Budget, validity window, and use counts are
 * enforced by the ledger inside the reserve transaction, not by the policy engine.
 */
export function mandateToPolicyDocument(scope: MandateScope): PolicyDocumentInput {
  const rules: PolicyDocumentInput['rules'] = [{ id: 'mandate-rails', type: 'allow_rails', rails: scope.rails }];
  if (scope.providers) rules.push({ id: 'mandate-providers', type: 'allow_providers', providers: scope.providers });
  if (scope.models) rules.push({ id: 'mandate-models', type: 'allow_models', patterns: scope.models });
  if (scope.payees) rules.push({ id: 'mandate-payees', type: 'x402_payees', allow: scope.payees });
  if (scope.maxPerAction !== undefined) {
    rules.push({ id: 'mandate-max-per-action', type: 'max_amount_per_action', max: formatUsd(scope.maxPerAction) });
  }
  return { rules };
}
