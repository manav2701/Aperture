import { PERIODS, RAILS, parseUsd, policyDocumentSchema, type PolicyDocumentInput } from '@aperture/core';
import { z } from 'zod';

/** A simulator scenario (YAML). See scenarios/two-teams.yaml for a worked example. */

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase words joined by dashes');
const usd = z.string().refine((value) => {
  try {
    parseUsd(value);
    return true;
  } catch {
    return false;
  }
}, 'amount must be a USD decimal string such as "5" or "0.25"');

/**
 * Policies stay in their stored form (amounts as strings): the policy engine validates and
 * parses documents itself, exactly as it would documents loaded from the database.
 */
const storedPolicy = z.custom<PolicyDocumentInput>(
  (value) => policyDocumentSchema.safeParse(value).success,
  'invalid policy document',
);

const spendStep = z.object({
  principal: id,
  amount: usd,
  count: z.number().int().min(1).max(10_000).default(1),
  concurrent: z.boolean().default(false),
  rail: z.enum(RAILS).default('gateway'),
  provider: z.string().optional(),
  model: z.string().optional(),
  /** `full`: settle at the reserved amount; `none`: leave holds open. */
  settle: z.enum(['full', 'none']).default('full'),
});

export const scenarioSchema = z
  .object({
    org: z.object({ name: z.string().min(1), timezone: z.string().default('Asia/Dubai') }),
    principals: z.array(z.object({ id, kind: z.enum(['user', 'agent']), name: z.string().min(1) })).min(1),
    budgets: z
      .array(
        z.object({
          id,
          parent: id.optional(),
          name: z.string().min(1),
          scope: z.enum(['org', 'team', 'principal', 'mandate']),
          principal: id.optional(),
          unit: z.enum(['micros', 'count']).default('micros'),
          period: z.enum(PERIODS),
          /** USD for money budgets; a whole number of actions for count budgets. */
          limit: z.string().min(1),
          mode: z.enum(['hard', 'soft']).default('hard'),
          rails: z.array(z.enum(RAILS)).default([]),
        }),
      )
      .min(1),
    policies: z
      .object({
        org: storedPolicy.optional(),
        principals: z.record(id, storedPolicy).default({}),
      })
      .default({ principals: {} }),
    steps: z
      .array(
        z.union([
          z.object({ title: z.string(), spend: spendStep }),
          z.object({ title: z.string(), setLimit: z.object({ budget: id, limit: z.string().min(1) }) }),
          z.object({ title: z.string(), pause: z.object({ principal: id }) }),
        ]),
      )
      .min(1),
  })
  .superRefine((scenario, ctx) => {
    const principals = new Set(scenario.principals.map((p) => p.id));
    const budgets = new Set(scenario.budgets.map((b) => b.id));
    scenario.budgets.forEach((budget, index) => {
      if (budget.parent !== undefined && !budgets.has(budget.parent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['budgets', index, 'parent'],
          message: `unknown budget "${budget.parent}"`,
        });
      }
      if (budget.scope === 'principal' && (budget.principal === undefined || !principals.has(budget.principal))) {
        ctx.addIssue({
          code: 'custom',
          path: ['budgets', index, 'principal'],
          message: 'principal budgets need a known principal',
        });
      }
    });
    scenario.steps.forEach((step, index) => {
      const principal = 'spend' in step ? step.spend.principal : 'pause' in step ? step.pause.principal : undefined;
      if (principal !== undefined && !principals.has(principal)) {
        ctx.addIssue({ code: 'custom', path: ['steps', index], message: `unknown principal "${principal}"` });
      }
      if ('setLimit' in step && !budgets.has(step.setLimit.budget)) {
        ctx.addIssue({ code: 'custom', path: ['steps', index], message: `unknown budget "${step.setLimit.budget}"` });
      }
    });
  });

export type Scenario = z.output<typeof scenarioSchema>;
export type ScenarioBudget = Scenario['budgets'][number];

/** Budget limits are USD for money budgets and plain counts for count budgets. */
export function parseLimit(budget: Pick<ScenarioBudget, 'unit'>, limit: string): bigint {
  if (budget.unit === 'count') {
    if (!/^\d+$/.test(limit)) throw new Error(`count limit must be a whole number, got "${limit}"`);
    return BigInt(limit);
  }
  return parseUsd(limit);
}
