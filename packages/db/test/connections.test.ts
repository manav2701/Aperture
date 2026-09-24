import { randomBytes } from 'node:crypto';
import { keyRingFromEnv } from '@aperture/crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../src/client';
import { createConnection, listConnections, readConnectionSecret, rewrapConnectionSecrets } from '../src/connections';
import { createOrg } from '../src/entities';
import { connections } from '../src/schema';
import { createTestDatabase } from './database';
import { expectDbError } from './fixtures';

const kek = () => randomBytes(32).toString('base64');
const v1 = kek();
const ring = keyRingFromEnv({ APERTURE_KEK_V1: v1 });

let handle: DatabaseHandle;
beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

describe('connections', () => {
  it('stores secrets encrypted and never lists them', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'c' });
    const created = await createConnection(db, ring, {
      orgId: org.id,
      provider: 'openrouter',
      name: 'OpenRouter (management)',
      secret: 'sk-or-v1-management-key',
      fingerprint: 'or-account-1',
    });
    expect(created).not.toHaveProperty('secret');

    const raw = await db.execute<{ secret: unknown }>(sql`select secret from connections where id = ${created.id}`);
    expect(JSON.stringify(raw.rows[0])).not.toContain('sk-or-v1-management-key');

    const listed = await listConnections(db, org.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('secret');
    expect(await readConnectionSecret(db, ring, { orgId: org.id, connectionId: created.id })).toBe(
      'sk-or-v1-management-key',
    );
  });

  it('refuses a secret copied onto another org’s row', async () => {
    const { db } = handle;
    const a = await createOrg(db, { name: 'a' });
    const b = await createOrg(db, { name: 'b' });
    const source = await createConnection(db, ring, { orgId: a.id, provider: 'openai', name: 'A', secret: 'sk-a' });
    const target = await createConnection(db, ring, { orgId: b.id, provider: 'openai', name: 'B', secret: 'sk-b' });
    const [row] = await db
      .select({ secret: connections.secret })
      .from(connections)
      .where(eq(connections.id, source.id));
    await db.update(connections).set({ secret: row?.secret }).where(eq(connections.id, target.id));
    await expect(readConnectionSecret(db, ring, { orgId: b.id, connectionId: target.id })).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it('connects one provider account once per org (C9)', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'dup' });
    const input = { orgId: org.id, provider: 'anthropic', name: 'x', secret: 's', fingerprint: 'org-123' };
    await createConnection(db, ring, input);
    await expectDbError(createConnection(db, ring, input), /connections_fingerprint_unique/);
  });

  it('re-wraps secrets after a key rotation', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'rotate' });
    const created = await createConnection(db, ring, {
      orgId: org.id,
      provider: 'fal',
      name: 'fal',
      secret: 'fal-key',
    });
    const rotated = keyRingFromEnv({ APERTURE_KEK_V1: v1, APERTURE_KEK_V2: kek() });
    expect(await rewrapConnectionSecrets(db, rotated, org.id)).toBe(1);
    const onlyNew = { currentVersion: 2, keys: new Map([[2, rotated.keys.get(2) ?? Buffer.alloc(0)]]) };
    expect(await readConnectionSecret(db, onlyNew, { orgId: org.id, connectionId: created.id })).toBe('fal-key');
  });
});
