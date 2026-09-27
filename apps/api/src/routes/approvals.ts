import { formatUsd, grantFor, micros, parseUsd } from '@aperture/core';
import { and, decideApproval, desc, eq, inArray, schema, withOrg, type Transaction } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps, Membership } from '../http/context';
import { forbidden, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * Approvals (plan/architecture §14). Agents open them from the gateway; people with
 * approvals.decide answer them here. Team leads decide for their own team's agents only, and
 * nobody decides their own request or one from an agent they own (A1, enforced in the db layer).
 */

const STATUSES = ['pending', 'approved', 'denied', 'expired', 'used'] as const;

const ApprovalSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(STATUSES),
    requester: z.object({ id: z.uuid(), name: z.string(), teamId: z.uuid().nullable() }),
    rail: z.string(),
    resource: z.string(),
    amount: UsdSchema,
    // A union rather than .nullable(): generators read a nullable $ref as an intersection.
    approvedAmount: z.union([UsdSchema, z.null()]),
    purpose: z.string(),
    context: z.record(z.string(), z.unknown()),
    decidedBy: z.string().nullable(),
    note: z.string().nullable(),
    mandateId: z.uuid().nullable(),
    expiresAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi('Approval');

const ApprovalParams = OrgParams.extend({
  approvalId: z.uuid().openapi({ param: { name: 'approvalId', in: 'path' } }),
});

interface Row {
  approval: typeof schema.approvals.$inferSelect;
  requester: typeof schema.principals.$inferSelect;
}

const usd = (amount: bigint) => formatUsd(micros(amount));

function view({ approval, requester }: Row): z.infer<typeof ApprovalSchema> {
  return {
    id: approval.id,
    status: approval.status,
    requester: { id: requester.id, name: requester.name, teamId: requester.teamId },
    rail: approval.rail,
    resource: approval.resource,
    amount: usd(approval.amount),
    approvedAmount: approval.approvedAmount === null ? null : usd(approval.approvedAmount),
    purpose: approval.purpose,
    context: approval.context,
    decidedBy: approval.decidedBy,
    note: approval.decisionNote,
    mandateId: approval.mandateId,
    expiresAt: approval.expiresAt.toISOString(),
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    createdAt: approval.createdAt.toISOString(),
  };
}

async function loadApproval(tx: Transaction, orgId: string, approvalId: string): Promise<Row> {
  const [row] = await tx
    .select({ approval: schema.approvals, requester: schema.principals })
    .from(schema.approvals)
    .innerJoin(schema.principals, eq(schema.principals.id, schema.approvals.requesterPrincipalId))
    .where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.orgId, orgId)));
  if (!row) throw notFound('approval');
  return row;
}

function assertCanDecide(membership: Membership, requester: { teamId: string | null }) {
  const reach = reachOf(membership, 'approvals.decide');
  if (reach.kind === 'team' && requester.teamId !== reach.teamId) {
    throw forbidden('you can only decide requests from your team');
  }
}

export function registerApprovalRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'approvals.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/approvals',
      tags: ['approvals'],
      summary: 'Approval requests, newest first (pending ones first when no status is given)',
      request: {
        params: OrgParams,
        query: z.object({ status: z.enum(STATUSES).optional() }),
      },
      responses: { 200: json(z.object({ approvals: z.array(ApprovalSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { status } = c.req.valid('query');
      // Approvers whose authority is one team (team leads) see that team's queue; auditors and
      // org-wide approvers see everything.
      const membership = c.var.membership;
      const teamOnly = grantFor(membership.role, 'approvals.decide') === 'team' ? membership.teamId : null;
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ approval: schema.approvals, requester: schema.principals })
          .from(schema.approvals)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.approvals.requesterPrincipalId))
          .where(
            and(
              eq(schema.approvals.orgId, orgId),
              status === undefined
                ? inArray(schema.approvals.status, [...STATUSES])
                : eq(schema.approvals.status, status),
              teamOnly === null ? undefined : eq(schema.principals.teamId, teamOnly),
            ),
          )
          .orderBy(desc(schema.approvals.createdAt))
          .limit(200),
      );
      const approvals = rows.map(view);
      approvals.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
      return c.json({ approvals }, 200);
    },
  );

  const decide = (approve: boolean) =>
    createRoute({
      method: 'post',
      path: `/api/v1/orgs/{orgId}/approvals/{approvalId}/${approve ? 'approve' : 'deny'}`,
      tags: ['approvals'],
      summary: approve
        ? 'Approve: issues a one-shot mandate for this exact request, optionally with a lower cap'
        : 'Deny the request',
      request: {
        params: ApprovalParams,
        ...jsonBody(
          z.object({
            ...(approve ? { amount: UsdSchema.optional() } : {}),
            note: z.string().trim().max(500).optional(),
          }),
        ),
      },
      responses: { 200: json(ApprovalSchema), ...errorResponses },
    });

  for (const approve of [true, false]) {
    router.add({ permission: 'approvals.decide' }, decide(approve), async (c) => {
      const user = requireUser(c);
      const { orgId, approvalId } = c.req.valid('param');
      const body = c.req.valid('json') as { amount?: string; note?: string };
      const decided = await withOrg(deps.db, orgId, async (tx) => {
        const current = await loadApproval(tx, orgId, approvalId);
        assertCanDecide(c.var.membership, current.requester);
        await decideApproval(tx, deps.ring, {
          orgId,
          approvalId,
          deciderUserId: user.id,
          approve,
          amount: body.amount === undefined ? undefined : parseUsd(body.amount),
          note: body.note,
        });
        const after = await loadApproval(tx, orgId, approvalId);
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: approve ? 'approval.approved' : 'approval.denied',
          subject: `approval:${approvalId}`,
          data: {
            requester: after.requester.id,
            resource: after.approval.resource,
            amount: usd(after.approval.amount),
            approved: after.approval.approvedAmount === null ? null : usd(after.approval.approvedAmount),
            mandateId: after.approval.mandateId,
          },
        });
        return after;
      });
      return c.json(view(decided), 200);
    });
  }
}
