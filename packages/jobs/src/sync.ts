import {
  connectorFor,
  ConnectorError,
  normalizeModel,
  type Connector,
  type ExternalKey,
  type Provider,
  PROVIDERS,
} from '@aperture/connectors';
import { actualTextCost } from '@aperture/core';
import {
  adjust,
  and,
  appendAuditEvent,
  budgetHeadroom,
  eq,
  inArray,
  lookupPrice,
  readConnectionSecret,
  recordSpend,
  schema,
  sql,
  withOrg,
  type BudgetBreach,
  type Transaction,
} from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { queueAlert } from './alerts';
import { dbOf, SYSTEM_ACTOR, type JobDeps } from './deps';

type CredentialRow = typeof schema.credentials.$inferSelect;
type ConnectionRow = typeof schema.connections.$inferSelect;

/** Usage re-imported on every run so late buckets are caught (C4). */
const REIMPORT_WINDOW_MS = 2 * 60 * 60 * 1000;
/** How far back the very first bucket import reaches. */
const FIRST_IMPORT_MS = 60 * 60 * 1000;

export interface SyncResult {
  keys: number;
  imported: number;
  revoked: number;
  limitsUpdated: number;
}

const isProvider = (value: string): value is Provider => (PROVIDERS as readonly string[]).includes(value);

/** Builds a connector for a stored connection (decrypting its secret). */
export async function connectorForConnection(deps: JobDeps, connection: ConnectionRow): Promise<Connector> {
  if (!isProvider(connection.provider))
    throw new ConnectorError('unsupported', `no connector for ${connection.provider}`);
  const secret = await withOrg(dbOf(deps), connection.orgId, (tx) =>
    readConnectionSecret(tx, deps.ring, { orgId: connection.orgId, connectionId: connection.id }),
  );
  if (secret === undefined) throw new Error('connection disappeared');
  return connectorFor(connection.provider, {
    secret,
    config: connection.config as Record<string, unknown>,
    fetch: deps.fetch,
  });
}

/** The org's catch-all principal for spend on keys nobody has claimed yet (C7). */
export async function unassignedPrincipal(tx: Transaction, orgId: string): Promise<string> {
  await tx
    .insert(schema.principals)
    .values({ id: uuidv7(), orgId, kind: 'agent', name: 'Unassigned provider keys', systemRole: 'unassigned' })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: schema.principals.id })
    .from(schema.principals)
    .where(and(eq(schema.principals.orgId, orgId), eq(schema.principals.systemRole, 'unassigned')));
  if (!row) throw new Error('unassigned principal missing');
  return row.id;
}

/** Brings the credentials table in line with the provider's keys. New keys arrive unassigned. */
async function upsertKeys(
  deps: JobDeps,
  connection: ConnectionRow,
  keys: ExternalKey[],
): Promise<Map<string, CredentialRow>> {
  return withOrg(dbOf(deps), connection.orgId, async (tx) => {
    const existing = await tx
      .select()
      .from(schema.credentials)
      .where(eq(schema.credentials.connectionId, connection.id));
    const byExternal = new Map(existing.map((row) => [row.externalId, row]));
    for (const key of keys) {
      const row = byExternal.get(key.externalId);
      if (row === undefined) {
        const [inserted] = await tx
          .insert(schema.credentials)
          .values({
            id: uuidv7(),
            orgId: connection.orgId,
            connectionId: connection.id,
            externalId: key.externalId,
            name: key.name,
            hint: key.hint,
            status: key.disabled ? 'disabled' : 'active',
            // Spend before Aperture was connected is history, not something to charge now.
            lastUsage: key.usage ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) byExternal.set(key.externalId, inserted);
        continue;
      }
      const status = row.status === 'revoked' ? 'revoked' : key.disabled ? 'disabled' : 'active';
      if (row.name !== key.name || row.hint !== key.hint || row.status !== status) {
        const [updated] = await tx
          .update(schema.credentials)
          .set({ name: key.name, hint: key.hint, status })
          .where(eq(schema.credentials.id, row.id))
          .returning();
        if (updated) byExternal.set(key.externalId, updated);
      }
    }
    return byExternal;
  });
}

/**
 * Records observed spend once per source key. If the provider later reports a different amount
 * for the same bucket (late data), the difference is booked as an adjustment (C3, C4).
 */
async function importObserved(
  deps: JobDeps,
  input: {
    orgId: string;
    principalId: string;
    sourceKey: string;
    amount: bigint;
    occurredAt: Date;
    meta: Record<string, unknown>;
  },
): Promise<BudgetBreach[]> {
  return withOrg(dbOf(deps), input.orgId, async (tx) => {
    const booked = await tx.execute<{ total: string | null }>(sql`
      select sum(amount)::text as total from ledger_entries
      where org_id = ${input.orgId} and (idempotency_key = ${input.sourceKey} or meta->>'sourceKey' = ${input.sourceKey})`);
    const total = BigInt(booked.rows[0]?.total ?? '0');
    const alreadyBooked = booked.rows[0]?.total !== null;
    if (!alreadyBooked) {
      if (input.amount <= 0n) return [];
      const result = await recordSpend(tx, {
        orgId: input.orgId,
        principalId: input.principalId,
        rail: 'provider',
        kind: 'observed',
        amount: input.amount,
        idempotencyKey: input.sourceKey,
        occurredAt: input.occurredAt,
        meta: { ...input.meta, sourceKey: input.sourceKey },
      });
      return result.overBudget;
    }
    const difference = input.amount - total;
    if (difference !== 0n) {
      await adjust(tx, {
        orgId: input.orgId,
        principalId: input.principalId,
        rail: 'provider',
        amount: difference,
        idempotencyKey: `${input.sourceKey}:total:${input.amount.toString()}`,
        occurredAt: input.occurredAt,
        meta: { ...input.meta, sourceKey: input.sourceKey, reason: 'provider revised usage' },
      });
    }
    return [];
  });
}

const principalFor = async (deps: JobDeps, orgId: string, credential: CredentialRow) =>
  credential.principalId ?? (await withOrg(dbOf(deps), orgId, (tx) => unassignedPrincipal(tx, orgId)));

/** `key_totals` providers (OpenRouter): import the growth of each key's lifetime spend. */
async function importKeyTotals(
  deps: JobDeps,
  connection: ConnectionRow,
  keys: ExternalKey[],
  credentials: Map<string, CredentialRow>,
) {
  let imported = 0;
  const breached = new Set<string>();
  for (const key of keys) {
    const credential = credentials.get(key.externalId);
    if (credential === undefined || key.usage === undefined) continue;
    // Gateway traffic is already in the ledger with exact per-request cost (G11).
    if (credential.managedByGateway) continue;
    const previous = credential.lastUsage;
    if (previous !== null && key.usage > previous) {
      const principalId = await principalFor(deps, connection.orgId, credential);
      const breaches = await importObserved(deps, {
        orgId: connection.orgId,
        principalId,
        // Keyed by where the delta starts: if a crash replays it with a larger end, the extra
        // becomes an adjustment instead of a second charge.
        sourceKey: `${connection.provider}:${key.externalId}:from:${previous.toString()}`,
        amount: key.usage - previous,
        occurredAt: new Date(),
        meta: { connectionId: connection.id, credentialId: credential.id, provider: connection.provider },
      });
      imported += 1;
      if (breaches.length > 0) breached.add(principalId);
    }
    if (previous !== key.usage) {
      await withOrg(dbOf(deps), connection.orgId, (tx) =>
        tx.update(schema.credentials).set({ lastUsage: key.usage }).where(eq(schema.credentials.id, credential.id)),
      );
      credential.lastUsage = key.usage;
    }
  }
  return { imported, breached };
}

/** `buckets` providers (OpenAI, Anthropic): price per-minute usage by key and model. */
async function importBuckets(
  deps: JobDeps,
  connection: ConnectionRow,
  connector: Connector,
  credentials: Map<string, CredentialRow>,
) {
  const cursor = (connection.syncCursor ?? {}) as { lastBucketEnd?: string };
  const now = Date.now();
  const since =
    cursor.lastBucketEnd === undefined
      ? new Date(now - FIRST_IMPORT_MS)
      : new Date(Math.min(Date.parse(cursor.lastBucketEnd), now) - REIMPORT_WINDOW_MS);
  const records = (await connector.usageSince?.(since)) ?? [];
  let imported = 0;
  let lastBucketEnd = cursor.lastBucketEnd === undefined ? since : new Date(cursor.lastBucketEnd);
  const breached = new Set<string>();
  const unpriced = new Set<string>();

  for (const record of records) {
    if (record.bucketEnd > lastBucketEnd) lastBucketEnd = record.bucketEnd;
    const credential = credentials.get(record.externalKeyId);
    if (credential === undefined || credential.managedByGateway) continue;
    const provider = connection.provider as Provider;
    const model = normalizeModel(provider, record.model);
    const price = await withOrg(dbOf(deps), connection.orgId, (tx) => lookupPrice(tx, provider, model));
    if (price === undefined) {
      unpriced.add(model);
      continue;
    }
    const cost = actualTextCost(
      {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheReadTokens: record.cacheReadTokens,
        cacheWriteTokens: record.cacheWriteTokens,
      },
      price,
    );
    const principalId = await principalFor(deps, connection.orgId, credential);
    const breaches = await importObserved(deps, {
      orgId: connection.orgId,
      principalId,
      sourceKey: `${provider}:${record.bucketStart.toISOString()}:${record.externalKeyId}:${model}`,
      amount: cost,
      occurredAt: record.bucketStart,
      meta: {
        connectionId: connection.id,
        credentialId: credential.id,
        provider,
        model,
        inputTokens: record.inputTokens.toString(),
        outputTokens: record.outputTokens.toString(),
      },
    });
    imported += 1;
    if (breaches.length > 0) breached.add(principalId);
  }

  for (const model of unpriced) {
    await queueAlert(deps, connection.orgId, {
      dedupeKey: `unpriced:${connection.provider}:${model}`,
      kind: 'unpriced_model',
      payload: { provider: connection.provider, model },
    });
  }
  await withOrg(dbOf(deps), connection.orgId, (tx) =>
    tx
      .update(schema.connections)
      .set({ syncCursor: { lastBucketEnd: lastBucketEnd.toISOString() } })
      .where(eq(schema.connections.id, connection.id)),
  );
  return { imported, breached };
}

/**
 * T1: keep each Aperture-created key's provider limit at "lifetime usage + remaining budget",
 * so the provider itself stops the key when the budget runs out (C6).
 */
async function mirrorLimits(
  deps: JobDeps,
  connection: ConnectionRow,
  connector: Connector,
  keys: ExternalKey[],
  credentials: Map<string, CredentialRow>,
) {
  if (connector.setLimit === undefined) return 0;
  let updated = 0;
  for (const key of keys) {
    const credential = credentials.get(key.externalId);
    if (credential?.principalId == null || !credential.createdByAperture || credential.managedByGateway) continue;
    if (credential.status !== 'active' || key.usage === undefined) continue;
    const { remaining } = await withOrg(dbOf(deps), connection.orgId, (tx) =>
      budgetHeadroom(tx, { orgId: connection.orgId, principalId: credential.principalId ?? '', rail: 'provider' }),
    );
    const target = remaining === null ? null : key.usage + remaining;
    if (target === credential.mirroredLimit && target === (key.limit ?? null)) continue;
    await connector.setLimit(key.externalId, target);
    await withOrg(dbOf(deps), connection.orgId, (tx) =>
      tx.update(schema.credentials).set({ mirroredLimit: target }).where(eq(schema.credentials.id, credential.id)),
    );
    updated += 1;
  }
  return updated;
}

/** T2: over a hard budget → revoke the principal's keys on this provider, audit, and alert (C1). */
async function enforceBreaches(
  deps: JobDeps,
  connection: ConnectionRow,
  connector: Connector,
  principals: Set<string>,
  credentials: Map<string, CredentialRow>,
) {
  if (!connector.capabilities.revoke || connector.capabilities.setLimit) return 0;
  let revoked = 0;
  for (const principalId of principals) {
    const { remaining, budgetName } = await withOrg(dbOf(deps), connection.orgId, (tx) =>
      budgetHeadroom(tx, { orgId: connection.orgId, principalId, rail: 'provider' }),
    );
    if (remaining !== 0n) continue;
    for (const credential of credentials.values()) {
      if (credential.principalId !== principalId || credential.status !== 'active' || credential.managedByGateway)
        continue;
      await connector.revoke(credential.externalId);
      await withOrg(dbOf(deps), connection.orgId, async (tx) => {
        await tx
          .update(schema.credentials)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(eq(schema.credentials.id, credential.id));
        await appendAuditEvent(tx, connection.orgId, {
          actor: SYSTEM_ACTOR,
          action: 'credential.revoked',
          subject: `credential:${credential.id}`,
          data: {
            provider: connection.provider,
            principalId,
            reason: 'hard budget exhausted',
            budget: budgetName ?? '',
          },
        });
      });
      credential.status = 'revoked';
      await queueAlert(deps, connection.orgId, {
        dedupeKey: `revoked:${credential.id}`,
        kind: 'credential_revoked',
        payload: { provider: connection.provider, credential: credential.name, budget: budgetName ?? '' },
      });
      revoked += 1;
    }
  }
  return revoked;
}

async function markConnection(deps: JobDeps, connection: ConnectionRow, error: string | null) {
  await withOrg(dbOf(deps), connection.orgId, (tx) =>
    tx
      .update(schema.connections)
      .set(
        error === null
          ? { status: 'active', lastError: null, lastSyncedAt: new Date() }
          : { status: 'broken', lastError: error.slice(0, 500) },
      )
      .where(eq(schema.connections.id, connection.id)),
  );
}

/** One full sync of one connection: keys, usage, enforcement. Errors mark the connection broken (C5). */
export async function syncConnection(deps: JobDeps, connection: ConnectionRow): Promise<SyncResult> {
  try {
    const connector = await connectorForConnection(deps, connection);
    const keys = await connector.listKeys();
    const credentials = await upsertKeys(deps, connection, keys);

    let usage = { imported: 0, breached: new Set<string>() };
    if (connector.capabilities.usage === 'key_totals')
      usage = await importKeyTotals(deps, connection, keys, credentials);
    if (connector.capabilities.usage === 'buckets')
      usage = await importBuckets(deps, connection, connector, credentials);

    const limitsUpdated = await mirrorLimits(deps, connection, connector, keys, credentials);
    const revoked = await enforceBreaches(deps, connection, connector, usage.breached, credentials);
    await markConnection(deps, connection, null);
    return { keys: keys.length, imported: usage.imported, revoked, limitsUpdated };
  } catch (error) {
    const message = error instanceof ConnectorError ? `${error.code}: ${error.message}` : 'internal error during sync';
    deps.logger.warn(
      { connectionId: connection.id, provider: connection.provider, err: error },
      'connection sync failed',
    );
    await markConnection(deps, connection, message);
    if (error instanceof ConnectorError && (error.code === 'unauthorized' || error.code === 'forbidden')) {
      await queueAlert(deps, connection.orgId, {
        dedupeKey: `broken:${connection.id}:${new Date().toISOString().slice(0, 10)}`,
        kind: 'connection_broken',
        payload: { provider: connection.provider, name: connection.name, error: message },
      });
    }
    throw error;
  }
}

/** Every connection with a key or usage API, across orgs. Broken ones are retried too, so a fixed key recovers on its own. */
export async function syncAllConnections(deps: JobDeps): Promise<void> {
  const rows = await dbOf(deps).transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system', 'on', true)`);
    return tx
      .select()
      .from(schema.connections)
      .where(inArray(schema.connections.status, ['active', 'broken']));
  });
  for (const connection of rows) {
    if (!isProvider(connection.provider) || connection.provider === 'google' || connection.provider === 'huggingface')
      continue;
    try {
      await syncConnection(deps, connection);
    } catch {
      // Already recorded on the connection and logged.
    }
  }
}
