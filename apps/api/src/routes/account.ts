import { PLAN_LABELS, PLAN_LIMITS, type Plan } from '@aperture/core';
import { StripeError, stripeClient, verifyStripeSignature } from '@aperture/cards';
import { and, appendAuditEvent, count, desc, eq, isNull, ne, schema, withOrg, withSystem } from '@aperture/db';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps, AppEnv } from '../http/context';
import { AppError, forbidden } from '../http/errors';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';
import { effectivePlan, usageOf } from '../plans';

/*
 * The org's account (plan/phases/phase-10 §10.6–10.8): privacy settings, data export and
 * deletion; Aperture's own billing (Stripe Checkout, Customer Portal, webhook); and the
 * onboarding checklist.
 */

const PrivacySchema = z
  .object({
    requestLogDays: z.number().int().min(7).max(3650),
    mediaDays: z.number().int().min(1).max(3650),
    deletion: z.enum(['none', 'requested', 'scheduled']),
    deletionRequestedAt: Timestamp.nullable(),
  })
  .openapi('PrivacySettings');

const EXPORT_LIMIT = 50_000;

export function registerAccountRoutes(router: Router, deps: AppDeps): void {
  const settingsOf = (orgId: string) =>
    withOrg(deps.db, orgId, async (tx) => {
      const [row] = await tx.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId));
      return {
        requestLogDays: row?.requestLogDays ?? 90,
        mediaDays: row?.mediaDays ?? 90,
        deletion: row?.deletion ?? 'none',
        deletionRequestedAt: row?.deletionRequestedAt?.toISOString() ?? null,
      };
    });

  router.add(
    { permission: 'org.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/settings/privacy',
      tags: ['privacy'],
      summary: 'Retention and deletion settings',
      request: { params: OrgParams },
      responses: { 200: json(PrivacySchema), ...errorResponses },
    }),
    async (c) => c.json(await settingsOf(c.req.valid('param').orgId), 200),
  );

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/settings/privacy',
      tags: ['privacy'],
      summary: 'Set how long request logs and generated media are kept (the ledger and audit chain are always kept)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({ requestLogDays: z.number().int().min(7).max(3650), mediaDays: z.number().int().min(1).max(3650) }),
        ),
      },
      responses: { 200: json(PrivacySchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .insert(schema.orgSettings)
          .values({ orgId, ...body })
          .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { ...body, updatedAt: new Date() } });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'privacy.retention_changed',
          subject: `org:${orgId}`,
          data: body,
        });
      });
      return c.json(await settingsOf(orgId), 200);
    },
  );

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/deletion',
      tags: ['privacy'],
      summary: 'Owner only: request deletion of the organization (30-day grace period, cancellable)',
      request: { params: OrgParams, ...jsonBody(z.object({ confirmName: z.string() })) },
      responses: { 200: json(PrivacySchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      if (c.var.membership.role !== 'owner') throw forbidden('only the owner can delete the organization');
      await withOrg(deps.db, orgId, async (tx) => {
        const [org] = await tx.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
        if (org?.name !== c.req.valid('json').confirmName) {
          throw new AppError(400, 'confirmation_mismatch', 'type the organization’s exact name to confirm');
        }
        const values = {
          deletion: 'requested' as const,
          deletionRequestedAt: new Date(),
          deletionRequestedBy: user.id,
          updatedAt: new Date(),
        };
        await tx
          .insert(schema.orgSettings)
          .values({ orgId, ...values })
          .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: values });
        await auditByUser(tx, { orgId, userId: user.id, action: 'org.deletion.requested', subject: `org:${orgId}` });
      });
      return c.json(await settingsOf(orgId), 200);
    },
  );

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/deletion',
      tags: ['privacy'],
      summary: 'Cancel a pending deletion request',
      request: { params: OrgParams },
      responses: { 200: json(PrivacySchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId));
        if (row?.deletion !== 'requested')
          throw new AppError(409, 'not_pending', 'there is no pending deletion to cancel');
        await tx
          .update(schema.orgSettings)
          .set({ deletion: 'none', deletionRequestedAt: null, deletionRequestedBy: null, updatedAt: new Date() })
          .where(eq(schema.orgSettings.orgId, orgId));
        await auditByUser(tx, { orgId, userId: user.id, action: 'org.deletion.cancelled', subject: `org:${orgId}` });
      });
      return c.json(await settingsOf(orgId), 200);
    },
  );

  router.add(
    { permission: 'audit.export' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/export',
      tags: ['privacy'],
      summary: 'Everything the org owns in Aperture, as JSON (secrets and key hashes excluded)',
      description: `Each table is capped at ${String(EXPORT_LIMIT)} rows, newest first; the audit chain has its own export.`,
      request: { params: OrgParams },
      responses: { 200: json(z.record(z.string(), z.unknown())), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const data = await withOrg(deps.db, orgId, async (tx) => {
        const pick = (rows: Record<string, unknown>[], drop: string[]) =>
          rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key))));
        const result = {
          org: await tx.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)),
          members: await tx.select().from(schema.members).where(eq(schema.members.orgId, orgId)),
          teams: await tx.select().from(schema.teams).where(eq(schema.teams.orgId, orgId)),
          principals: await tx.select().from(schema.principals).where(eq(schema.principals.orgId, orgId)),
          budgets: await tx.select().from(schema.budgets).where(eq(schema.budgets.orgId, orgId)),
          policies: await tx.select().from(schema.policies).where(eq(schema.policies.orgId, orgId)),
          apiKeys: pick(await tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, orgId)), ['hash']),
          connections: pick(await tx.select().from(schema.connections).where(eq(schema.connections.orgId, orgId)), [
            'secret',
          ]),
          ledgerEntries: await tx
            .select()
            .from(schema.ledgerEntries)
            .where(eq(schema.ledgerEntries.orgId, orgId))
            .orderBy(desc(schema.ledgerEntries.occurredAt))
            .limit(EXPORT_LIMIT),
          gatewayRequests: await tx
            .select()
            .from(schema.gatewayRequests)
            .where(eq(schema.gatewayRequests.orgId, orgId))
            .orderBy(desc(schema.gatewayRequests.createdAt))
            .limit(EXPORT_LIMIT),
          approvals: await tx.select().from(schema.approvals).where(eq(schema.approvals.orgId, orgId)),
          mandates: await tx.select().from(schema.mandates).where(eq(schema.mandates.orgId, orgId)),
          cards: await tx.select().from(schema.cards).where(eq(schema.cards.orgId, orgId)),
          cardAuthorizations: await tx
            .select()
            .from(schema.cardAuthorizations)
            .where(eq(schema.cardAuthorizations.orgId, orgId)),
          x402Accounts: pick(await tx.select().from(schema.x402Accounts).where(eq(schema.x402Accounts.orgId, orgId)), [
            'delegateSecret',
          ]),
          x402Payments: await tx.select().from(schema.x402Payments).where(eq(schema.x402Payments.orgId, orgId)),
          mediaJobs: await tx.select().from(schema.mediaJobs).where(eq(schema.mediaJobs.orgId, orgId)),
        };
        await auditByUser(tx, { orgId, userId: user.id, action: 'org.exported', subject: `org:${orgId}` });
        return result;
      });
      // Bigints become strings so the export is plain JSON.
      const body = JSON.parse(
        JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ) as Record<string, unknown>;
      return c.json(body, 200, { 'content-disposition': `attachment; filename="aperture-${orgId}.json"` });
    },
  );

  // -------------------------------------------------------------------------------------------
  // Billing

  const BillingSchema = z
    .object({
      enabled: z.boolean(),
      plan: z.enum(['pilot', 'free', 'team', 'business']),
      label: z.string(),
      status: z.string().nullable(),
      pilotEndsAt: Timestamp.nullable(),
      currentPeriodEnd: Timestamp.nullable(),
      limits: z.object({
        members: z.number().nullable(),
        agents: z.number().nullable(),
        connections: z.number().nullable(),
      }),
      usage: z.object({ members: z.number(), agents: z.number(), connections: z.number() }),
    })
    .openapi('Billing');

  router.add(
    { permission: 'org.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/billing',
      tags: ['billing'],
      summary: 'The org’s plan, its limits and current usage',
      request: { params: OrgParams },
      responses: { 200: json(BillingSchema), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const result = await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId));
        return {
          row,
          plan: deps.billing === undefined ? 'business' : await effectivePlan(tx, orgId),
          usage: await usageOf(tx, orgId),
        };
      });
      const limits = PLAN_LIMITS[result.plan];
      return c.json(
        {
          enabled: deps.billing !== undefined,
          plan: result.plan,
          label: deps.billing === undefined ? 'Self-hosted (no limits)' : PLAN_LABELS[result.plan],
          status: result.row?.status ?? null,
          pilotEndsAt: result.row?.pilotEndsAt?.toISOString() ?? null,
          currentPeriodEnd: result.row?.currentPeriodEnd?.toISOString() ?? null,
          limits: { members: limits.members, agents: limits.agents, connections: limits.connections },
          usage: result.usage,
        },
        200,
      );
    },
  );

  const stripe = () => {
    if (deps.billing === undefined)
      throw new AppError(503, 'billing_disabled', 'billing is not configured on this deployment');
    return { client: stripeClient(deps.billing.secretKey, deps.jobs.fetch), config: deps.billing };
  };

  const customerFor = async (orgId: string, email: string) => {
    const { client } = stripe();
    const [row] = await withOrg(deps.db, orgId, (tx) =>
      tx.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId)),
    );
    if (row?.stripeCustomerId != null) return row.stripeCustomerId;
    const customer = await client.request<{ id: string }>('POST', '/v1/customers', {
      email,
      metadata: { aperture_org_id: orgId },
    });
    await withOrg(deps.db, orgId, (tx) =>
      tx
        .insert(schema.orgBilling)
        .values({ orgId, stripeCustomerId: customer.id })
        .onConflictDoUpdate({
          target: schema.orgBilling.orgId,
          set: { stripeCustomerId: customer.id, updatedAt: new Date() },
        }),
    );
    return customer.id;
  };

  const stripeFailure = (error: unknown) =>
    error instanceof StripeError ? new AppError(502, 'stripe_error', `Stripe: ${error.message}`) : error;

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/billing/checkout',
      tags: ['billing'],
      summary: 'Start Stripe Checkout for a plan; returns the URL to send the browser to',
      request: { params: OrgParams, ...jsonBody(z.object({ plan: z.enum(['team', 'business']) })) },
      responses: { 200: json(z.object({ url: z.url() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { client, config } = stripe();
      const { plan } = c.req.valid('json');
      try {
        const session = await client.request<{ url: string }>('POST', '/v1/checkout/sessions', {
          mode: 'subscription',
          customer: await customerFor(orgId, user.email),
          client_reference_id: orgId,
          line_items: [{ price: config.prices[plan], quantity: 1 }],
          subscription_data: { metadata: { aperture_org_id: orgId, aperture_plan: plan } },
          success_url: `${deps.webOrigin}/orgs/${orgId}/settings/billing?checkout=done`,
          cancel_url: `${deps.webOrigin}/orgs/${orgId}/settings/billing`,
        });
        return c.json({ url: session.url }, 200);
      } catch (error) {
        throw stripeFailure(error);
      }
    },
  );

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/billing/portal',
      tags: ['billing'],
      summary: 'Open the Stripe Customer Portal (plan changes, invoices, payment method)',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ url: z.url() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { client } = stripe();
      try {
        const session = await client.request<{ url: string }>('POST', '/v1/billing_portal/sessions', {
          customer: await customerFor(orgId, user.email),
          return_url: `${deps.webOrigin}/orgs/${orgId}/settings/billing`,
        });
        return c.json({ url: session.url }, 200);
      } catch (error) {
        throw stripeFailure(error);
      }
    },
  );

  // -------------------------------------------------------------------------------------------
  // Onboarding checklist (§10.8)

  router.add(
    { permission: 'org.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/onboarding',
      tags: ['orgs'],
      summary: 'Getting-started steps and which are done',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            steps: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean(), href: z.string() })),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const counts = await withOrg(deps.db, orgId, async (tx) => {
        const n = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
        return {
          connections: await n(
            tx
              .select({ n: count() })
              .from(schema.connections)
              .where(and(eq(schema.connections.orgId, orgId), ne(schema.connections.status, 'disabled'))),
          ),
          teams: await n(tx.select({ n: count() }).from(schema.teams).where(eq(schema.teams.orgId, orgId))),
          budgets: await n(
            tx
              .select({ n: count() })
              .from(schema.budgets)
              .where(and(eq(schema.budgets.orgId, orgId), isNull(schema.budgets.archivedAt))),
          ),
          members: await n(tx.select({ n: count() }).from(schema.members).where(eq(schema.members.orgId, orgId))),
          agents: await n(
            tx
              .select({ n: count() })
              .from(schema.principals)
              .where(
                and(
                  eq(schema.principals.orgId, orgId),
                  eq(schema.principals.kind, 'agent'),
                  isNull(schema.principals.systemRole),
                ),
              ),
          ),
        };
      });
      const base = `/orgs/${orgId}`;
      return c.json(
        {
          steps: [
            {
              id: 'connect',
              label: 'Connect your first AI provider',
              done: counts.connections > 0,
              href: `${base}/connections`,
            },
            { id: 'teams', label: 'Create your teams', done: counts.teams > 0, href: `${base}/settings/teams` },
            { id: 'budgets', label: 'Set budgets', done: counts.budgets > 0, href: `${base}/budgets` },
            { id: 'members', label: 'Invite members', done: counts.members > 1, href: `${base}/settings/members` },
            { id: 'agent', label: 'Create your first agent', done: counts.agents > 0, href: `${base}/agents` },
          ],
        },
        200,
      );
    },
  );
}

/** Stripe Billing webhook: keeps org_billing in step with subscriptions (signed, raw body). */
export function registerBillingWebhook(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  app.post('/webhooks/stripe-billing', async (c) => {
    const billing = deps.billing;
    if (billing === undefined) return c.text('billing disabled', 404);
    const raw = await c.req.text();
    if (!verifyStripeSignature(billing.webhookSecret, c.req.header('stripe-signature') ?? null, raw)) {
      return c.text('invalid signature', 400);
    }
    const event = JSON.parse(raw) as { type?: string; data?: { object?: Record<string, unknown> } };
    const object = event.data?.object ?? {};
    const planFor = (priceId: unknown): Plan | undefined =>
      priceId === billing.prices.team ? 'team' : priceId === billing.prices.business ? 'business' : undefined;

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const customer = typeof object.customer === 'string' ? object.customer : undefined;
      if (customer === undefined) return c.json({ received: true });
      const items =
        (object.items as { data?: { price?: { id?: string }; current_period_end?: unknown }[] } | undefined)?.data ??
        [];
      const plan = planFor(items[0]?.price?.id);
      const status = typeof object.status === 'string' ? object.status : null;
      // API versions from 2025-03-31 moved the period from the subscription onto its items.
      const periodEndSeconds = object.current_period_end ?? items[0]?.current_period_end;
      const periodEnd = typeof periodEndSeconds === 'number' ? new Date(periodEndSeconds * 1000) : null;
      const [row] = await withSystem(deps.db, (tx) =>
        tx
          .select({ orgId: schema.orgBilling.orgId })
          .from(schema.orgBilling)
          .where(eq(schema.orgBilling.stripeCustomerId, customer)),
      );
      if (row === undefined) return c.json({ received: true });
      await withOrg(deps.db, row.orgId, async (tx) => {
        await tx
          .update(schema.orgBilling)
          .set({
            plan: event.type === 'customer.subscription.deleted' ? 'free' : (plan ?? 'free'),
            status: event.type === 'customer.subscription.deleted' ? 'canceled' : status,
            stripeSubscriptionId: typeof object.id === 'string' ? object.id : null,
            currentPeriodEnd: periodEnd,
            updatedAt: new Date(),
          })
          .where(eq(schema.orgBilling.orgId, row.orgId));
        await appendAuditEvent(tx, row.orgId, {
          actor: 'system:billing',
          action: `billing.${(event.type ?? '').split('.').at(-1) ?? 'updated'}`,
          subject: `org:${row.orgId}`,
          data: { plan: plan ?? null, status },
        });
      });
    }
    return c.json({ received: true });
  });
}
