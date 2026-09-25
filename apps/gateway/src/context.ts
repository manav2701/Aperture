import { hashApiKey, looksLikeApiKey, verifyWorkspaceToken, type KeyRing } from '@aperture/crypto';
import type { PolicyLayer } from '@aperture/core';
import type { Provider } from '@aperture/connectors';
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  openCredentialSecret,
  or,
  readConnectionSecret,
  schema,
  sql,
  withOrg,
  withSystem,
  type Database,
} from '@aperture/db';

/** Who is calling: resolved from an Aperture key or a workspace token. */
export interface Caller {
  orgId: string;
  principalId: string;
  apiKeyId: string | null;
}

export interface PrincipalContext {
  timezone: string;
  layers: PolicyLayer[];
}

/** Maximum time any cached decision input may be stale, even without a notification (P7). */
const TTL_MS = 30_000;

interface Entry<T> {
  value: T;
  expires: number;
  orgId: string;
}

/**
 * Caches policy layers, upstream keys and connected providers per org. Entries expire after 30 s, and
 * `invalidate(orgId)` (driven by Postgres NOTIFY aperture_invalidate) drops an org at once.
 * Budgets and principal status are not cached: `reserve` reads them fresh in its transaction,
 * which is what makes the kill switch immediate.
 */
export class GatewayCache {
  private readonly entries = new Map<string, Entry<unknown>>();

  async get<T>(key: string, orgId: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit !== undefined && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    this.entries.set(key, { value, expires: Date.now() + TTL_MS, orgId });
    if (this.entries.size > 50_000) this.entries.clear();
    return value;
  }

  invalidate(orgId: string) {
    for (const [key, entry] of this.entries) if (entry.orgId === orgId) this.entries.delete(key);
  }
}

export async function resolveCaller(
  db: Database,
  secrets: { pepper: string; workspaceSecret: string },
  credential: string,
): Promise<Caller | undefined> {
  if (credential.startsWith('wst.')) {
    const claims = verifyWorkspaceToken(credential, secrets.workspaceSecret);
    return claims === undefined ? undefined : { orgId: claims.orgId, principalId: claims.principalId, apiKeyId: null };
  }
  if (!looksLikeApiKey(credential)) return undefined;
  const hash = hashApiKey(credential, secrets.pepper);
  // The hash is unguessable, so looking it up across orgs reveals nothing (same as an invitation token).
  const [row] = await withSystem(db, (tx) =>
    tx
      .select({ id: schema.apiKeys.id, orgId: schema.apiKeys.orgId, principalId: schema.apiKeys.principalId })
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.hash, hash),
          isNull(schema.apiKeys.revokedAt),
          or(isNull(schema.apiKeys.expiresAt), gt(schema.apiKeys.expiresAt, sql`now()`)),
        ),
      ),
  );
  // Not cached: revoking a key must take effect on the very next request.
  if (row === undefined) return undefined;
  return { orgId: row.orgId, principalId: row.principalId, apiKeyId: row.id };
}

/** Org time zone and the active policy layers that apply to the principal (org → team → principal). */
export function loadPrincipalContext(db: Database, cache: GatewayCache, caller: Caller): Promise<PrincipalContext> {
  return cache.get(`ctx:${caller.principalId}`, caller.orgId, () =>
    withOrg(db, caller.orgId, async (tx) => {
      const [org] = await tx
        .select({ timezone: schema.orgs.timezone })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, caller.orgId));
      const [principal] = await tx
        .select({ teamId: schema.principals.teamId })
        .from(schema.principals)
        .where(eq(schema.principals.id, caller.principalId));
      const scopes: { scope: 'org' | 'team' | 'principal'; id: string }[] = [
        { scope: 'org', id: caller.orgId },
        ...(principal?.teamId == null ? [] : [{ scope: 'team' as const, id: principal.teamId }]),
        { scope: 'principal', id: caller.principalId },
      ];
      const layers: PolicyLayer[] = [];
      for (const { scope, id } of scopes) {
        const [policy] = await tx
          .select()
          .from(schema.policies)
          .where(and(eq(schema.policies.scope, scope), eq(schema.policies.scopeId, id)))
          .orderBy(desc(schema.policies.version))
          .limit(1);
        if (policy) layers.push({ level: scope, scopeId: id, version: policy.version, document: policy.document });
      }
      return { timezone: org?.timezone ?? 'UTC', layers };
    }),
  );
}

/**
 * The key the gateway forwards with for a provider (BYOK): a gateway-managed credential, or,
 * for Gemini and Hugging Face, the connection's own API key or token.
 */
export function upstreamKey(
  db: Database,
  ring: KeyRing,
  cache: GatewayCache,
  orgId: string,
  provider: Provider,
): Promise<string | undefined> {
  return cache.get(`upstream:${orgId}:${provider}`, orgId, () =>
    withOrg(db, orgId, async (tx) => {
      const [managed] = await tx
        .select({ id: schema.credentials.id, secret: schema.credentials.secret })
        .from(schema.credentials)
        .innerJoin(schema.connections, eq(schema.connections.id, schema.credentials.connectionId))
        .where(
          and(
            eq(schema.connections.provider, provider),
            eq(schema.connections.status, 'active'),
            eq(schema.credentials.managedByGateway, true),
            eq(schema.credentials.status, 'active'),
          ),
        )
        .orderBy(desc(schema.credentials.createdAt))
        .limit(1);
      if (managed?.secret != null)
        return openCredentialSecret(ring, { orgId, credentialId: managed.id, sealed: managed.secret });

      if (provider !== 'google' && provider !== 'huggingface') return undefined;
      const [connection] = await tx
        .select({ id: schema.connections.id })
        .from(schema.connections)
        .where(and(eq(schema.connections.provider, provider), eq(schema.connections.status, 'active')))
        .orderBy(desc(schema.connections.createdAt))
        .limit(1);
      if (connection === undefined) return undefined;
      const secret = await readConnectionSecret(tx, ring, { orgId, connectionId: connection.id });
      // A service-account JSON is for key management, not for calling Gemini.
      return secret === undefined || secret.trimStart().startsWith('{') ? undefined : secret;
    }),
  );
}

/** Which providers an org has connected (drives OpenAI-format routing). */
export function connectedProviders(db: Database, cache: GatewayCache, orgId: string): Promise<Set<string>> {
  return cache.get(`providers:${orgId}`, orgId, () =>
    withOrg(db, orgId, async (tx) => {
      const rows = await tx
        .select({ provider: schema.connections.provider })
        .from(schema.connections)
        .where(eq(schema.connections.status, 'active'));
      return new Set(rows.map((row) => row.provider));
    }),
  );
}
