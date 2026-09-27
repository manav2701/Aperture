import {
  CardSetupError,
  StripeError,
  activeStripeConnection,
  connectStripe,
  issueCard,
  setCardStatus,
} from '@aperture/cards';
import { formatUsd, micros, parseUsd } from '@aperture/core';
import { and, desc, eq, gte, schema, sql, withOrg, type Transaction } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import type { AppDeps, Membership } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * Cards (plan/phases/phase-08 §8.1, §8.4, §8.8): connect the org's Stripe Issuing program, issue
 * virtual cards to agents, freeze or cancel them, and see every authorization with Aperture's
 * decision. Card numbers never pass through Aperture (K13).
 */

const CardSchema = z
  .object({
    id: z.uuid(),
    principal: z.object({ id: z.uuid(), name: z.string() }),
    kind: z.enum(['agent', 'task']),
    status: z.enum(['active', 'inactive', 'canceled']),
    last4: z.string().nullable(),
    purpose: z.string().nullable(),
    controls: z.record(z.string(), z.unknown()),
    approvalId: z.uuid().nullable(),
    expiresAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi('Card');

const AuthorizationSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    decision: z.enum(['approved', 'declined', 'unseen']),
    reasons: z.array(z.unknown()),
    requested: UsdSchema,
    settled: z.union([UsdSchema, z.null()]),
    currency: z.string(),
    merchant: z.record(z.string(), z.unknown()),
    createdAt: Timestamp,
  })
  .openapi('CardAuthorization');

const CardParams = OrgParams.extend({ cardId: z.uuid().openapi({ param: { name: 'cardId', in: 'path' } }) });
const usd = (amount: bigint) => formatUsd(micros(amount));

type CardRow = typeof schema.cards.$inferSelect;

function view(card: CardRow, principalName: string): z.infer<typeof CardSchema> {
  return {
    id: card.id,
    principal: { id: card.principalId, name: principalName },
    kind: card.kind,
    status: card.status,
    last4: card.last4,
    purpose: card.purpose,
    controls: card.controls,
    approvalId: card.approvalId,
    expiresAt: card.expiresAt?.toISOString() ?? null,
    createdAt: card.createdAt.toISOString(),
  };
}

function assertTeam(membership: Membership, principal: { teamId: string | null }) {
  const reach = reachOf(membership, 'agents.manage');
  if (reach.kind === 'team' && principal.teamId !== reach.teamId)
    throw forbidden('you can only manage your team’s cards');
}

async function principalOf(tx: Transaction, orgId: string, principalId: string) {
  const [row] = await tx
    .select()
    .from(schema.principals)
    .where(and(eq(schema.principals.id, principalId), eq(schema.principals.orgId, orgId)));
  if (row?.systemRole !== null) throw notFound('principal');
  return row;
}

const stripeFailure = (error: unknown) => {
  if (error instanceof StripeError) return new AppError(400, 'stripe_error', `Stripe: ${error.message}`);
  if (error instanceof CardSetupError) return new AppError(409, 'cards_not_ready', error.message);
  return error;
};

export function registerCardRoutes(router: Router, deps: AppDeps): void {
  const urlsFor = (origin: string, connectionId: string) => ({
    authorizationUrl: `${origin}/webhooks/stripe/${connectionId}/authorization`,
    eventsUrl: `${origin}/webhooks/stripe/${connectionId}/events`,
  });
  const originOf = (url: string) => deps.apiPublicUrl ?? new URL(url).origin;

  router.add(
    { permission: 'connections.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/cards/stripe',
      tags: ['cards'],
      summary: 'The Stripe Issuing connection, the two webhook URLs to set in Stripe, and decision health',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            connected: z.boolean(),
            connectionId: z.uuid().nullable(),
            livemode: z.boolean(),
            authorizationUrl: z.string().nullable(),
            eventsUrl: z.string().nullable(),
            last30Days: z.object({ approved: z.number(), declined: z.number(), unseen: z.number() }),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const result = await withOrg(deps.db, orgId, async (tx) => {
        const connection = await activeStripeConnection(tx, orgId);
        const counts = await tx
          .select({ decision: schema.cardAuthorizations.decision, n: sql<number>`count(*)::int` })
          .from(schema.cardAuthorizations)
          .where(
            and(
              eq(schema.cardAuthorizations.orgId, orgId),
              gte(schema.cardAuthorizations.createdAt, sql`now() - interval '30 days'`),
            ),
          )
          .groupBy(schema.cardAuthorizations.decision);
        return { connection, counts };
      });
      const count = (decision: string) => result.counts.find((row) => row.decision === decision)?.n ?? 0;
      const urls = result.connection === undefined ? null : urlsFor(originOf(c.req.url), result.connection.id);
      return c.json(
        {
          connected: result.connection !== undefined,
          connectionId: result.connection?.id ?? null,
          livemode: (result.connection?.config as { livemode?: boolean } | undefined)?.livemode === true,
          authorizationUrl: urls?.authorizationUrl ?? null,
          eventsUrl: urls?.eventsUrl ?? null,
          // "unseen" > 0 means Stripe approved without asking Aperture: check the timeout setting (K1, K2).
          last30Days: { approved: count('approved'), declined: count('declined'), unseen: count('unseen') },
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/cards/stripe',
      tags: ['cards'],
      summary: 'Connect Stripe Issuing with a restricted key and the two webhook signing secrets',
      description:
        'Creates one company cardholder. Then set the authorization URL as the Issuing real-time authorization webhook ' +
        '(timeout behaviour: decline) and the events URL for issuing_authorization.*, issuing_transaction.created and issuing_card.updated.',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            apiKey: z.string().regex(/^(rk|sk)_(test|live)_[A-Za-z0-9]+$/, 'a Stripe restricted key (rk_…)'),
            authorizationSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/),
            eventsSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/),
            company: z.object({
              name: z.string().trim().min(1).max(200),
              line1: z.string().trim().min(1).max(200),
              city: z.string().trim().min(1).max(100),
              postalCode: z.string().trim().min(1).max(20),
              country: z.string().length(2),
              state: z.string().max(50).optional(),
            }),
          }),
        ),
      },
      responses: {
        200: json(z.object({ connectionId: z.uuid(), authorizationUrl: z.string(), eventsUrl: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const connection = await connectStripe(deps.db, deps.ring, {
        orgId,
        userId: user.id,
        secrets: {
          apiKey: body.apiKey,
          authorizationSecret: body.authorizationSecret,
          eventsSecret: body.eventsSecret,
        },
        company: body.company,
        fetch: deps.jobs.fetch,
      }).catch((error: unknown) => {
        throw stripeFailure(error);
      });
      return c.json({ connectionId: connection.id, ...urlsFor(originOf(c.req.url), connection.id) }, 200);
    },
  );

  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/cards',
      tags: ['cards'],
      summary: 'Cards, newest first',
      request: { params: OrgParams, query: z.object({ principalId: z.uuid().optional() }) },
      responses: { 200: json(z.object({ cards: z.array(CardSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { principalId } = c.req.valid('query');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ card: schema.cards, name: schema.principals.name })
          .from(schema.cards)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.cards.principalId))
          .where(
            and(
              eq(schema.cards.orgId, orgId),
              principalId === undefined ? undefined : eq(schema.cards.principalId, principalId),
            ),
          )
          .orderBy(desc(schema.cards.createdAt))
          .limit(500),
      );
      return c.json({ cards: rows.map((row) => view(row.card, row.name)) }, 200);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/agents/{principalId}/cards',
      tags: ['cards'],
      summary: 'Issue a virtual card to an agent; every purchase is decided by Aperture in real time',
      request: {
        params: OrgParams.extend({ principalId: z.uuid().openapi({ param: { name: 'principalId', in: 'path' } }) }),
        ...jsonBody(
          z.object({
            purpose: z.string().trim().min(1).max(500),
            perAuthorization: UsdSchema.optional(),
            monthly: UsdSchema.optional(),
            categories: z
              .array(z.string().regex(/^[a-z_]+$/))
              .max(50)
              .optional(),
            countries: z.array(z.string().length(2)).max(50).optional(),
          }),
        ),
      },
      responses: { 201: json(CardSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, principalId } = c.req.valid('param');
      const body = c.req.valid('json');
      const principal = await withOrg(deps.db, orgId, (tx) => principalOf(tx, orgId, principalId));
      if (principal.kind !== 'agent') throw new AppError(400, 'not_an_agent', 'cards are for agents');
      assertTeam(c.var.membership, principal);
      const card = await issueCard(deps.db, deps.ring, {
        orgId,
        principalId,
        kind: 'agent',
        backstop: {
          perAuthorization: body.perAuthorization === undefined ? undefined : parseUsd(body.perAuthorization),
          monthly: body.monthly === undefined ? undefined : parseUsd(body.monthly),
          categories: body.categories,
          countries: body.countries,
        },
        purpose: body.purpose,
        createdBy: user.id,
        fetch: deps.jobs.fetch,
      }).catch((error: unknown) => {
        throw stripeFailure(error);
      });
      return c.json(view(card, principal.name), 201);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/cards/{cardId}/status',
      tags: ['cards'],
      summary: 'Freeze (inactive), unfreeze (active) or cancel (permanent) a card',
      request: { params: CardParams, ...jsonBody(z.object({ status: z.enum(['active', 'inactive', 'canceled']) })) },
      responses: { 200: json(CardSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, cardId } = c.req.valid('param');
      const { status } = c.req.valid('json');
      const principal = await withOrg(deps.db, orgId, async (tx) => {
        const [card] = await tx
          .select()
          .from(schema.cards)
          .where(and(eq(schema.cards.id, cardId), eq(schema.cards.orgId, orgId)));
        if (!card) throw notFound('card');
        return principalOf(tx, orgId, card.principalId);
      });
      assertTeam(c.var.membership, principal);
      const card = await setCardStatus(deps.db, deps.ring, {
        orgId,
        cardId,
        status,
        actor: `user:${user.id}`,
        fetch: deps.jobs.fetch,
      }).catch((error: unknown) => {
        throw stripeFailure(error);
      });
      if (card === undefined) throw notFound('card');
      return c.json(view(card, principal.name), 200);
    },
  );

  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/cards/{cardId}/authorizations',
      tags: ['cards'],
      summary: 'A card’s authorizations with Aperture’s decision and reasons',
      request: { params: CardParams },
      responses: { 200: json(z.object({ authorizations: z.array(AuthorizationSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId, cardId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.cardAuthorizations)
          .where(and(eq(schema.cardAuthorizations.orgId, orgId), eq(schema.cardAuthorizations.cardId, cardId)))
          .orderBy(desc(schema.cardAuthorizations.createdAt))
          .limit(200),
      );
      return c.json(
        {
          authorizations: rows.map((row) => ({
            id: row.externalId,
            status: row.status,
            decision: row.decision,
            reasons: row.reasons,
            requested: usd(row.requested),
            settled: row.settledAmount === null ? null : usd(row.settledAmount),
            currency: row.currency,
            merchant: row.merchant,
            createdAt: row.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );
}
