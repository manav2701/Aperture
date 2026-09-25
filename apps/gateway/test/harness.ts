import { randomBytes } from 'node:crypto';
import { fakeProvider } from '@aperture/connectors/testing';
import { generateApiKey, hashApiKey, keyRingFromEnv } from '@aperture/crypto';
import {
  connect,
  createConnection,
  eq,
  schema,
  sealCredentialSecret,
  upsertPrices,
  withSystem,
  type DatabaseHandle,
} from '@aperture/db';
import { appRoleUrl, createTestDatabase, seedTree } from '@aperture/db/testing';
import { createLogger } from '@aperture/runtime';
import { buildApp } from '../src/app';
import { GatewayCache } from '../src/context';
import { RequestLimiter } from '../src/limits';

export const PEPPER = 'test-pepper-that-is-at-least-32-characters';
export const UPSTREAM_KEY = 'sk-or-v1-gateway-upstream';

type Routes = Parameters<typeof fakeProvider>[0];

export interface GatewayHarness {
  system: DatabaseHandle & { url: string };
  app: DatabaseHandle;
  close: () => Promise<void>;
}

export async function createGatewayHarness(): Promise<GatewayHarness> {
  const system = await createTestDatabase();
  const app = connect(appRoleUrl(system.url));
  // $0.15 / $0.60 per million tokens, like gpt-4o-mini.
  await withSystem(system.db, (tx) =>
    upsertPrices(tx, [
      {
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        inputPerMTok: 150_000n,
        outputPerMTok: 600_000n,
        cacheReadPerMTok: null,
        cacheWritePerMTok: null,
        source: 'test',
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        inputPerMTok: 3_000_000n,
        outputPerMTok: 15_000_000n,
        cacheReadPerMTok: null,
        cacheWritePerMTok: null,
        source: 'test',
      },
      {
        provider: 'google',
        model: 'gemini-2.5-flash',
        inputPerMTok: 300_000n,
        outputPerMTok: 2_500_000n,
        cacheReadPerMTok: null,
        cacheWritePerMTok: null,
        source: 'test',
      },
    ]),
  );
  return {
    system,
    app,
    close: async () => {
      await app.close();
      await system.close();
    },
  };
}

const ring = keyRingFromEnv({ APERTURE_KEK_V1: randomBytes(32).toString('base64') });

/** An org with OpenRouter, Anthropic and Gemini connected for the gateway, and an agent with a key. */
export async function seedGatewayOrg(h: GatewayHarness, limits: { agent?: string } = {}) {
  const tree = await seedTree(h.system.db, { agent: limits.agent ?? '1' });
  const db = h.system.db;
  for (const provider of ['openrouter', 'anthropic'] as const) {
    const connection = await createConnection(db, ring, {
      orgId: tree.org.id,
      provider,
      name: provider,
      secret: 'admin',
    });
    const credentialId = crypto.randomUUID();
    await db.insert(schema.credentials).values({
      id: credentialId,
      orgId: tree.org.id,
      connectionId: connection.id,
      externalId: `gateway-${provider}`,
      name: 'Aperture gateway',
      managedByGateway: true,
      createdByAperture: true,
      secret: sealCredentialSecret(ring, {
        orgId: tree.org.id,
        credentialId,
        secret: provider === 'openrouter' ? UPSTREAM_KEY : 'sk-ant-gateway',
      }),
    });
  }
  await createConnection(db, ring, {
    orgId: tree.org.id,
    provider: 'google',
    name: 'gemini',
    secret: 'AIza-gemini-key',
  });

  const user = crypto.randomUUID();
  await db.insert(schema.users).values({ id: user, name: 'Owner', email: `${user}@example.com`, emailVerified: true });
  const { key } = generateApiKey('test');
  const [apiKey] = await db
    .insert(schema.apiKeys)
    .values({
      id: crypto.randomUUID(),
      orgId: tree.org.id,
      principalId: tree.agent.id,
      name: 'test',
      prefix: key.slice(0, 12),
      hash: hashApiKey(key, PEPPER),
      createdBy: user,
    })
    .returning();
  return { ...tree, key, apiKeyId: apiKey?.id ?? '' };
}

export function gateway(h: GatewayHarness, routes: Routes) {
  const upstream = fakeProvider(routes);
  const app = buildApp({
    db: h.app.db,
    ring,
    pepper: PEPPER,
    workspaceSecret: PEPPER,
    logger: createLogger({ service: 'gateway-test', level: 'silent' }),
    cache: new GatewayCache(),
    limiter: new RequestLimiter(),
    fetch: upstream.fetch,
  });
  const call = async (path: string, key: string, body: unknown, headers: Record<string, string> = {}) =>
    await app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, upstream, call };
}

export async function ledgerOf(h: GatewayHarness, orgId: string) {
  return h.system.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.orgId, orgId));
}

export async function requestsOf(h: GatewayHarness, orgId: string) {
  return h.system.db.select().from(schema.gatewayRequests).where(eq(schema.gatewayRequests.orgId, orgId));
}

/** An OpenAI-style SSE stream, ending with a usage chunk and [DONE]. */
export function sse(chunks: unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
}
