import { ConnectorError, PROVIDER_INFO, PROVIDERS, connectorFor, type Provider } from '@aperture/connectors';
import { formatUsd, micros } from '@aperture/core';
import { encryptSecret } from '@aperture/crypto';
import { and, budgetHeadroom, createConnection, desc, eq, schema, sealCredentialSecret, withOrg } from '@aperture/db';
import { connectorForConnection, syncConnection } from '@aperture/jobs';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, notFound } from '../http/errors';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

const ProviderSchema = z.enum(PROVIDERS).openapi('Provider');
const TierSchema = z.enum(['T1', 'T2', 'T3']);
const SLACK_PREFIX = 'https://hooks.slack.com/';

const ConnectionSchema = z
  .object({
    id: z.uuid(),
    provider: ProviderSchema,
    name: z.string(),
    status: z.enum(['active', 'broken', 'disabled']),
    tier: TierSchema,
    capabilities: z.object({ createKey: z.boolean(), setLimit: z.boolean(), revoke: z.boolean(), usage: z.string() }),
    lastSyncedAt: Timestamp.nullable(),
    lastError: z.string().nullable(),
    keys: z.number().int(),
    unassigned: z.number().int(),
    gatewayReady: z.boolean(),
    createdAt: Timestamp,
  })
  .openapi('Connection');

const CredentialSchema = z
  .object({
    id: z.uuid(),
    connectionId: z.uuid(),
    provider: z.string(),
    name: z.string(),
    hint: z.string().nullable(),
    status: z.enum(['active', 'disabled', 'revoked']),
    principal: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    createdByAperture: z.boolean(),
    managedByGateway: z.boolean(),
    /** USD limit mirrored to the provider, if any. */
    limit: z.string().nullable(),
    createdAt: Timestamp,
  })
  .openapi('Credential');

const ConnectionParams = OrgParams.extend({
  connectionId: z.uuid().openapi({ param: { name: 'connectionId', in: 'path' } }),
});
const CredentialParams = OrgParams.extend({
  credentialId: z.uuid().openapi({ param: { name: 'credentialId', in: 'path' } }),
});

type ConnectionRow = typeof schema.connections.$inferSelect;
interface Stored {
  tier: 'T1' | 'T2' | 'T3';
  capabilities: { createKey: boolean; setLimit: boolean; revoke: boolean; usage: string };
}

const usdOrNull = (value: bigint | null) => (value === null ? null : formatUsd(micros(value)));

function providerError(error: unknown): never {
  if (error instanceof ConnectorError) {
    const status = error.code === 'bad_request' || error.code === 'unsupported' ? 400 : 502;
    throw new AppError(status, `provider_${error.code}`, error.message);
  }
  throw error;
}

async function loadConnection(deps: AppDeps, orgId: string, connectionId: string): Promise<ConnectionRow> {
  const [row] = await withOrg(deps.db, orgId, (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.id, connectionId), eq(schema.connections.orgId, orgId))),
  );
  if (!row || !(PROVIDERS as readonly string[]).includes(row.provider)) throw notFound('connection');
  return row;
}

async function presentConnections(deps: AppDeps, orgId: string) {
  return withOrg(deps.db, orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.orgId, orgId))
      .orderBy(desc(schema.connections.createdAt));
    const credentials = await tx.select().from(schema.credentials).where(eq(schema.credentials.orgId, orgId));
    return rows
      .filter((row) => (PROVIDERS as readonly string[]).includes(row.provider))
      .map((row) => {
        const stored = row.config as Partial<Stored>;
        const mine = credentials.filter(
          (c) => c.connectionId === row.id && !c.managedByGateway && c.status !== 'revoked',
        );
        const gatewayKey = credentials.some(
          (c) => c.connectionId === row.id && c.managedByGateway && c.status === 'active',
        );
        const keyOnly = (row.provider === 'google' || row.provider === 'huggingface') && stored.tier === 'T3';
        return {
          id: row.id,
          provider: row.provider as Provider,
          name: row.name,
          status: row.status,
          tier: stored.tier ?? 'T3',
          capabilities: stored.capabilities ?? { createKey: false, setLimit: false, revoke: false, usage: 'none' },
          lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
          lastError: row.lastError,
          keys: mine.length,
          unassigned: mine.filter((c) => c.principalId === null).length,
          gatewayReady: row.status === 'active' && (gatewayKey || keyOnly),
          createdAt: row.createdAt.toISOString(),
        };
      });
  });
}

export function registerConnectionRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'connections.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/providers',
      tags: ['connections'],
      summary: 'Providers Aperture can connect to, with setup steps',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            providers: z.array(
              z.object({
                provider: ProviderSchema,
                name: z.string(),
                secretLabel: z.string(),
                secretUrl: z.string(),
                steps: z.array(z.string()),
                configFields: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    (c) => c.json({ providers: Object.values(PROVIDER_INFO).map(({ gateway: _gateway, ...info }) => info) }, 200),
  );

  router.add(
    { permission: 'connections.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/connections',
      tags: ['connections'],
      request: { params: OrgParams },
      responses: { 200: json(z.object({ connections: z.array(ConnectionSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      return c.json({ connections: await presentConnections(deps, orgId) }, 200);
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/connections',
      tags: ['connections'],
      summary: 'Connect a provider account (the secret is tested, then stored encrypted and never returned)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            provider: ProviderSchema,
            name: z.string().trim().min(1).max(80).optional(),
            secret: z.string().trim().min(8).max(20_000),
            config: z.record(z.string(), z.string().max(200)).default({}),
          }),
        ),
      },
      responses: { 201: json(ConnectionSchema, 'Connected'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const info = PROVIDER_INFO[body.provider];
      for (const field of info.configFields) {
        if (field.required && (body.config[field.key] ?? '') === '')
          throw new AppError(400, 'missing_config', `${field.label} is required`);
      }
      const connector = connectorFor(body.provider, {
        secret: body.secret,
        config: body.config,
        fetch: deps.jobs.fetch,
      });
      const health = await connector.test().catch(providerError);
      const stored: Stored = { tier: connector.capabilities.tier, capabilities: connector.capabilities };

      const created = await withOrg(deps.db, orgId, async (tx) => {
        const [duplicate] = await tx
          .select({ id: schema.connections.id })
          .from(schema.connections)
          .where(
            and(
              eq(schema.connections.orgId, orgId),
              eq(schema.connections.provider, body.provider),
              eq(schema.connections.fingerprint, health.fingerprint),
            ),
          );
        if (duplicate) throw new AppError(409, 'already_connected', `this ${info.name} account is already connected`);
        const connection = await createConnection(tx, deps.ring, {
          orgId,
          provider: body.provider,
          name: body.name ?? info.name,
          secret: body.secret,
          fingerprint: health.fingerprint,
          config: { ...body.config, ...stored },
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'connection.created',
          subject: `connection:${connection.id}`,
          data: { provider: body.provider, tier: stored.tier },
        });
        return connection;
      });

      // Import keys right away so the person can assign them; a failure here shows on the card.
      const [row] = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.connections).where(eq(schema.connections.id, created.id)),
      );
      if (row && connector.capabilities.usage !== 'none') await syncConnection(deps.jobs, row).catch(() => undefined);
      const connection = (await presentConnections(deps, orgId)).find((item) => item.id === created.id);
      if (!connection) throw notFound('connection');
      return c.json(connection, 201);
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/connections/{connectionId}/sync',
      tags: ['connections'],
      summary: 'Sync keys and usage now',
      request: { params: ConnectionParams },
      responses: {
        200: json(z.object({ keys: z.number(), imported: z.number(), revoked: z.number(), limitsUpdated: z.number() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId, connectionId } = c.req.valid('param');
      const connection = await loadConnection(deps, orgId, connectionId);
      if (connection.status === 'disabled')
        throw new AppError(409, 'connection_disabled', 'this connection is disconnected');
      const result = await syncConnection(deps.jobs, connection).catch(providerError);
      return c.json(result, 200);
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/connections/{connectionId}',
      tags: ['connections'],
      summary: 'Disconnect (Aperture stops syncing and the gateway stops using it; keys at the provider are untouched)',
      request: { params: ConnectionParams },
      responses: { 204: { description: 'Disconnected' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, connectionId } = c.req.valid('param');
      const connection = await loadConnection(deps, orgId, connectionId);
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.connections)
          .set({ status: 'disabled', updatedAt: new Date() })
          .where(eq(schema.connections.id, connection.id));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'connection.disabled',
          subject: `connection:${connection.id}`,
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/connections/{connectionId}/gateway-key',
      tags: ['connections'],
      summary:
        'Give the gateway a key for this provider: created by Aperture where the provider allows it, else pasted',
      request: {
        params: ConnectionParams,
        ...jsonBody(z.object({ secret: z.string().trim().min(8).max(500).optional() })),
      },
      responses: {
        201: json(z.object({ credentialId: z.uuid(), hint: z.string().nullable() }), 'Ready'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, connectionId } = c.req.valid('param');
      const { secret: pasted } = c.req.valid('json');
      const connection = await loadConnection(deps, orgId, connectionId);
      if (connection.provider === 'google' || connection.provider === 'huggingface') {
        throw new AppError(400, 'not_needed', 'the gateway uses this connection’s own key');
      }
      const connector = await connectorForConnection(deps.jobs, connection).catch(providerError);
      let externalId: string;
      let secret: string;
      let hint: string | null;
      if (pasted !== undefined) {
        externalId = `pasted:${uuidv7()}`;
        secret = pasted;
        hint = `${pasted.slice(0, 10)}…`;
      } else if (connector.createKey !== undefined) {
        // No provider-side limit: the gateway enforces budgets per request before forwarding.
        const created = await connector.createKey('aperture-gateway', null).catch(providerError);
        externalId = created.key.externalId;
        secret = created.secret;
        hint = created.key.hint;
      } else {
        throw new AppError(
          400,
          'key_required',
          'this provider can’t create keys through its API; paste a key for the gateway to use',
        );
      }

      const credentialId = uuidv7();
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.credentials)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(
            and(eq(schema.credentials.connectionId, connection.id), eq(schema.credentials.managedByGateway, true)),
          );
        await tx.insert(schema.credentials).values({
          id: credentialId,
          orgId,
          connectionId: connection.id,
          externalId,
          name: 'Aperture gateway',
          hint,
          createdByAperture: pasted === undefined,
          managedByGateway: true,
          secret: sealCredentialSecret(deps.ring, { orgId, credentialId, secret }),
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'connection.gateway_key_set',
          subject: `connection:${connection.id}`,
          data: { created: pasted === undefined },
        });
      });
      return c.json({ credentialId, hint }, 201);
    },
  );

  router.add(
    { permission: 'connections.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/credentials',
      tags: ['connections'],
      summary: 'Provider keys Aperture knows about, and who each one belongs to',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ credentials: z.array(CredentialSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({
            credential: schema.credentials,
            provider: schema.connections.provider,
            principalName: schema.principals.name,
          })
          .from(schema.credentials)
          .innerJoin(schema.connections, eq(schema.connections.id, schema.credentials.connectionId))
          .leftJoin(schema.principals, eq(schema.principals.id, schema.credentials.principalId))
          .where(eq(schema.credentials.orgId, orgId))
          .orderBy(desc(schema.credentials.createdAt)),
      );
      return c.json(
        {
          credentials: rows.map(({ credential, provider, principalName }) => ({
            id: credential.id,
            connectionId: credential.connectionId,
            provider,
            name: credential.name,
            hint: credential.hint,
            status: credential.status,
            principal:
              credential.principalId === null ? null : { id: credential.principalId, name: principalName ?? '' },
            createdByAperture: credential.createdByAperture,
            managedByGateway: credential.managedByGateway,
            limit: usdOrNull(credential.mirroredLimit),
            createdAt: credential.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/credentials/{credentialId}',
      tags: ['connections'],
      summary: 'Assign a provider key to a person or agent (C7)',
      request: { params: CredentialParams, ...jsonBody(z.object({ principalId: z.uuid().nullable() })) },
      responses: { 204: { description: 'Assigned' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, credentialId } = c.req.valid('param');
      const { principalId } = c.req.valid('json');
      await withOrg(deps.db, orgId, async (tx) => {
        const [credential] = await tx.select().from(schema.credentials).where(eq(schema.credentials.id, credentialId));
        if (!credential) throw notFound('credential');
        if (credential.managedByGateway)
          throw new AppError(400, 'gateway_key', 'the gateway’s own key can’t be assigned');
        if (principalId !== null) {
          const [principal] = await tx
            .select({ systemRole: schema.principals.systemRole })
            .from(schema.principals)
            .where(eq(schema.principals.id, principalId));
          if (principal?.systemRole !== null)
            throw new AppError(400, 'invalid_principal', 'choose a person or agent in this organization');
        }
        await tx.update(schema.credentials).set({ principalId }).where(eq(schema.credentials.id, credentialId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'credential.assigned',
          subject: `credential:${credentialId}`,
          data: { principalId },
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/connections/{connectionId}/credentials',
      tags: ['connections'],
      summary: 'Create a provider key for a person or agent, limited to their remaining budget (shown once)',
      request: {
        params: ConnectionParams,
        ...jsonBody(z.object({ principalId: z.uuid(), name: z.string().trim().min(1).max(80).optional() })),
      },
      responses: {
        201: json(z.object({ credential: CredentialSchema, secret: z.string() }), 'Created — copy the key now'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, connectionId } = c.req.valid('param');
      const body = c.req.valid('json');
      const connection = await loadConnection(deps, orgId, connectionId);
      const connector = await connectorForConnection(deps.jobs, connection).catch(providerError);
      if (connector.createKey === undefined)
        throw new AppError(400, 'unsupported', `${connection.provider} keys can’t be created through its API`);
      const { principal, remaining } = await withOrg(deps.db, orgId, async (tx) => {
        const [found] = await tx.select().from(schema.principals).where(eq(schema.principals.id, body.principalId));
        if (found?.systemRole !== null)
          throw new AppError(400, 'invalid_principal', 'choose a person or agent in this organization');
        const headroom = await budgetHeadroom(tx, { orgId, principalId: found.id, rail: 'provider' });
        return { principal: found, remaining: headroom.remaining };
      });
      const limit = connector.capabilities.setLimit ? remaining : null;
      const created = await connector.createKey(body.name ?? `aperture:${principal.name}`, limit).catch(providerError);
      const credentialId = uuidv7();
      const row = await withOrg(deps.db, orgId, async (tx) => {
        const [inserted] = await tx
          .insert(schema.credentials)
          .values({
            id: credentialId,
            orgId,
            connectionId: connection.id,
            principalId: principal.id,
            externalId: created.key.externalId,
            name: created.key.name,
            hint: created.key.hint,
            createdByAperture: true,
            mirroredLimit: limit,
            lastUsage: created.key.usage ?? 0n,
          })
          .returning();
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'credential.created',
          subject: `credential:${credentialId}`,
          data: { provider: connection.provider, principalId: principal.id, limit: usdOrNull(limit) ?? 'none' },
        });
        return inserted;
      });
      if (!row) throw new Error('insert returned no row');
      return c.json(
        {
          credential: {
            id: row.id,
            connectionId: row.connectionId,
            provider: connection.provider,
            name: row.name,
            hint: row.hint,
            status: row.status,
            principal: { id: principal.id, name: principal.name },
            createdByAperture: true,
            managedByGateway: false,
            limit: usdOrNull(limit),
            createdAt: row.createdAt.toISOString(),
          },
          secret: created.secret,
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/credentials/{credentialId}/revoke',
      tags: ['connections'],
      summary: 'Revoke a provider key at the provider',
      request: { params: CredentialParams },
      responses: { 204: { description: 'Revoked' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, credentialId } = c.req.valid('param');
      const [credential] = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.credentials).where(eq(schema.credentials.id, credentialId)),
      );
      if (!credential) throw notFound('credential');
      const connection = await loadConnection(deps, orgId, credential.connectionId);
      if (!credential.managedByGateway || credential.createdByAperture) {
        const connector = await connectorForConnection(deps.jobs, connection).catch(providerError);
        if (connector.capabilities.revoke && !credential.externalId.startsWith('pasted:')) {
          await connector.revoke(credential.externalId).catch(providerError);
        }
      }
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.credentials)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(eq(schema.credentials.id, credentialId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'credential.revoked',
          subject: `credential:${credentialId}`,
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/alerts/slack',
      tags: ['alerts'],
      summary: 'Send budget alerts to a Slack channel (incoming webhook)',
      request: { params: OrgParams, ...jsonBody(z.object({ webhookUrl: z.url().max(500) })) },
      responses: { 204: { description: 'Saved' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { webhookUrl } = c.req.valid('json');
      if (!webhookUrl.startsWith(SLACK_PREFIX))
        throw new AppError(400, 'invalid_webhook', 'use a Slack incoming-webhook URL (https://hooks.slack.com/…)');
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.connections)
          .set({ status: 'disabled' })
          .where(and(eq(schema.connections.orgId, orgId), eq(schema.connections.provider, 'slack')));
        const id = uuidv7();
        await tx.insert(schema.connections).values({
          id,
          orgId,
          provider: 'slack',
          name: 'Slack alerts',
          fingerprint: id,
          secret: encryptSecret(webhookUrl, `${orgId}|${id}`, deps.ring),
        });
        await auditByUser(tx, { orgId, userId: user.id, action: 'alerts.slack_connected', subject: `org:${orgId}` });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'budgets.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/alerts',
      tags: ['alerts'],
      summary: 'Recent alerts and whether Slack is connected',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            slack: z.boolean(),
            alerts: z.array(
              z.object({
                id: z.uuid(),
                kind: z.string(),
                payload: z.unknown(),
                sentAt: Timestamp.nullable(),
                createdAt: Timestamp,
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { alerts, slack } = await withOrg(deps.db, orgId, async (tx) => ({
        alerts: await tx
          .select()
          .from(schema.alertLog)
          .where(eq(schema.alertLog.orgId, orgId))
          .orderBy(desc(schema.alertLog.createdAt))
          .limit(50),
        slack:
          (
            await tx
              .select({ id: schema.connections.id })
              .from(schema.connections)
              .where(
                and(
                  eq(schema.connections.orgId, orgId),
                  eq(schema.connections.provider, 'slack'),
                  eq(schema.connections.status, 'active'),
                ),
              )
          ).length > 0,
      }));
      return c.json(
        {
          slack,
          alerts: alerts.map((alert) => ({
            id: alert.id,
            kind: alert.kind,
            payload: alert.payload,
            sentAt: alert.sentAt?.toISOString() ?? null,
            createdAt: alert.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );
}
