import {
  evaluatePolicy,
  formatUsd,
  mandateToPolicyDocument,
  micros,
  type ActionInput,
  type Decision,
  type PolicyLayer,
} from '@aperture/core';
import {
  MandateError,
  consumeMandateUse,
  hasStandingMandate,
  mandateChain,
  markApprovalUsed,
  parseScope,
  requestApproval,
  reserve,
  standingMandate,
  usableApproval,
  withOrg,
  type ApprovalRow,
  type MandateRow,
  type ReserveInput,
  type ReserveResult,
} from '@aperture/db';
import type { Caller, PrincipalContext } from './context';
import { GatewayError } from './errors';
import type { GatewayDeps } from './pipeline';

/*
 * Mandates and approvals in the gateway (plan/phases/phase-07 §7.1, §7.3). A caller acts under
 * its standing mandate, or — when retrying with `x-aperture-approval: <id>` — under the
 * one-shot mandate an approver issued. Mandate scopes join the policy layers; the mandate's
 * budget joins the reserve path; its use is counted in the reserve transaction.
 */

export interface Authority {
  mandate: MandateRow | undefined;
  approval: ApprovalRow | undefined;
  layers: PolicyLayer[];
}

const usd = (amount: bigint) => formatUsd(micros(amount));

const layersFor = (chain: readonly MandateRow[]): PolicyLayer[] =>
  chain.map((link) => ({
    level: 'mandate',
    scopeId: link.id,
    version: 1,
    document: mandateToPolicyDocument(parseScope(link.scope)),
  }));

export async function resolveAuthority(
  deps: GatewayDeps,
  caller: Caller,
  request: Request,
  action: { rail: ActionInput['rail']; resource: string },
): Promise<Authority> {
  const approvalId = request.headers.get('x-aperture-approval');
  if (approvalId === null) {
    // The standing mandate is read on every request, so it is cached like the policy context
    // (invalidated by the mandates NOTIFY trigger). Use counts and validity stay authoritative:
    // they are re-checked with the rows locked when the use is counted (P5, P6).
    const standing = await deps.cache.get(`authority:${caller.principalId}`, caller.orgId, () =>
      withOrg(deps.db, caller.orgId, async (tx) => {
        const mandate = await standingMandate(tx, caller.principalId);
        const cut = mandate === undefined && (await hasStandingMandate(tx, caller.principalId));
        return { mandate, cut, layers: mandate === undefined ? [] : layersFor(await mandateChain(tx, mandate.id)) };
      }),
    );
    if (standing.cut) {
      throw new GatewayError('aperture_policy_denied', 'this caller’s mandate was revoked, has expired, or is used up');
    }
    return { mandate: standing.mandate, approval: undefined, layers: standing.layers };
  }
  return withOrg(deps.db, caller.orgId, async (tx) => {
    const approval = /^[0-9a-f-]{36}$/i.test(approvalId)
      ? await usableApproval(tx, { orgId: caller.orgId, approvalId, principalId: caller.principalId, ...action })
      : undefined;
    if (approval === undefined) {
      throw new GatewayError(
        'aperture_policy_denied',
        'that approval is not approved, already used, or for a different request',
      );
    }
    const chain = await mandateChain(tx, approval.mandateId ?? '');
    return { mandate: chain[0], approval, layers: layersFor(chain) };
  });
}

/**
 * Evaluates policy with the mandate layers. `require_approval` is satisfied only by an approval
 * whose cap covers the estimate; otherwise a pending approval is opened (or reused) and the
 * caller gets its id to wait on.
 */
export async function decide(
  deps: GatewayDeps,
  caller: Caller,
  authority: Authority,
  input: { action: ActionInput; context: PrincipalContext; resource: string; purpose: string; route: string },
): Promise<Decision> {
  const decision = evaluatePolicy({
    action: input.action,
    at: new Date(),
    timeZone: input.context.timezone,
    layers: [...input.context.layers, ...authority.layers],
  });
  if (decision.outcome === 'allow') return decision;
  if (decision.outcome === 'deny') {
    const message = decision.reasons.map((reason) => reason.message).join('; ') || 'denied by policy';
    throw new GatewayError('aperture_policy_denied', message, { reasons: decision.reasons });
  }
  const approved = authority.approval?.approvedAmount;
  if (approved != null && input.action.amount <= approved) return { ...decision, outcome: 'allow' };

  const approval = await withOrg(deps.db, caller.orgId, (tx) =>
    requestApproval(tx, {
      orgId: caller.orgId,
      principalId: caller.principalId,
      rail: input.action.rail,
      resource: input.resource,
      amount: input.action.amount,
      purpose: input.purpose,
      context: {
        route: input.route,
        provider: input.action.provider ?? null,
        model: input.action.model ?? null,
        estimateUsd: usd(input.action.amount),
        // Which rule asked for a person, so repeated approvals can suggest a policy change.
        reasons: decision.reasons.map((reason) => ({
          code: reason.code,
          message: reason.message,
          ruleId: reason.ruleId ?? null,
          level: reason.level ?? null,
          scopeId: reason.scopeId ?? null,
        })),
      },
    }),
  );
  await deps.onApprovalRequested?.(approval);
  throw new GatewayError(
    'aperture_approval_required',
    `${decision.reasons.map((reason) => reason.message).join('; ')}. Ask an approver, then retry with the header x-aperture-approval: ${approval.id}`,
    { approval_id: approval.id, estimate_usd: usd(input.action.amount) },
  );
}

/**
 * Reserves with the mandate's budget on the path, and counts the mandate use (locked, P6) and
 * consumes the approval in the same transaction — so a failed reserve uses nothing up.
 */
export async function reserveWithAuthority(
  deps: GatewayDeps,
  caller: Caller,
  authority: Authority,
  input: ReserveInput,
): Promise<ReserveResult> {
  try {
    return await withOrg(deps.db, caller.orgId, async (tx) => {
      const result = await reserve(tx, {
        ...input,
        ...(authority.mandate?.budgetId == null ? {} : { mandateBudgetId: authority.mandate.budgetId }),
        meta: { ...input.meta, ...(authority.mandate === undefined ? {} : { mandateId: authority.mandate.id }) },
      });
      if (!result.ok) return result;
      if (authority.mandate !== undefined) await consumeMandateUse(tx, authority.mandate.id);
      if (authority.approval !== undefined) await markApprovalUsed(tx, authority.approval.id);
      return result;
    });
  } catch (error) {
    if (error instanceof MandateError) {
      throw new GatewayError('aperture_policy_denied', `mandate: ${error.message}`, {
        mandate_id: authority.mandate?.id ?? null,
      });
    }
    throw error;
  }
}
