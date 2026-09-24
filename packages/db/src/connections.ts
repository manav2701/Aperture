import { decryptSecret, encryptSecret, rewrapSecret, type KeyRing } from '@aperture/crypto';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx } from './client';
import { connections } from './schema';

/*
 * Stored links to external systems. The secret column holds an envelope bound to
 * "<orgId>|<connectionId>"; only readConnectionSecret decrypts it, for the code that calls the
 * provider. Listing functions never return it.
 */

type ConnectionRow = typeof connections.$inferSelect;
export type ConnectionSummary = Omit<ConnectionRow, 'secret'>;

const secretContext = (orgId: string, connectionId: string) => `${orgId}|${connectionId}`;

function summarize(row: ConnectionRow): ConnectionSummary {
  const { secret, ...summary } = row;
  return summary;
}

export async function createConnection(
  db: DbOrTx,
  ring: KeyRing,
  input: {
    orgId: string;
    provider: string;
    name: string;
    secret: string;
    fingerprint?: string | undefined;
    config?: Record<string, unknown> | undefined;
  },
): Promise<ConnectionSummary> {
  const id = uuidv7();
  const [row] = await db
    .insert(connections)
    .values({
      id,
      orgId: input.orgId,
      provider: input.provider,
      name: input.name,
      fingerprint: input.fingerprint,
      secret: encryptSecret(input.secret, secretContext(input.orgId, id), ring),
      config: input.config ?? {},
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return summarize(row);
}

export async function listConnections(db: DbOrTx, orgId: string): Promise<ConnectionSummary[]> {
  const rows = await db.select().from(connections).where(eq(connections.orgId, orgId));
  return rows.map(summarize);
}

export async function readConnectionSecret(
  db: DbOrTx,
  ring: KeyRing,
  input: { orgId: string; connectionId: string },
): Promise<string | undefined> {
  const [row] = await db
    .select({ secret: connections.secret })
    .from(connections)
    .where(and(eq(connections.id, input.connectionId), eq(connections.orgId, input.orgId)));
  return row ? decryptSecret(row.secret, secretContext(input.orgId, input.connectionId), ring) : undefined;
}

/** After adding a new APERTURE_KEK_V<n>, re-wraps every secret of an org with it. */
export async function rewrapConnectionSecrets(db: DbOrTx, ring: KeyRing, orgId: string): Promise<number> {
  const rows = await db
    .select({ id: connections.id, secret: connections.secret })
    .from(connections)
    .where(eq(connections.orgId, orgId));
  for (const row of rows) {
    await db
      .update(connections)
      .set({ secret: rewrapSecret(row.secret, secretContext(orgId, row.id), ring), updatedAt: new Date() })
      .where(eq(connections.id, row.id));
  }
  return rows.length;
}
