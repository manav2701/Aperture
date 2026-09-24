import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Ledger and audit functions accept either and always run inside a (nested) transaction. */
export type DbOrTx = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface ConnectOptions {
  max?: number;
  /**
   * Sees every org's rows (row-level security `app.system`). Only for background jobs, tests,
   * tools, and migrations — never for request handling, which scopes each transaction to one org.
   */
  systemAccess?: boolean;
}

export function connect(connectionString: string, options: ConnectOptions = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    ...(options.systemAccess ? { options: '-c app.system=on' } : {}),
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** The migrations shipped with this package (callers that bundle the code pass their own copy). */
export function defaultMigrationsFolder(): string {
  return fileURLToPath(new URL('../migrations', import.meta.url));
}

/** Applies migrations under a session advisory lock, so concurrent service starts don't race. */
export async function runMigrations(db: Database, migrationsFolder = defaultMigrationsFolder()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('aperture:migrations', 0))`);
    await migrate(tx as unknown as Database, { migrationsFolder });
  });
}

/** Runs `fn` in a transaction that can only see and write the given org's rows. */
export async function withOrg<T>(db: Database, orgId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` with access to every org. For the few request paths that must look across orgs by
 * an unguessable key (the signed-in user's memberships, an invitation token) — keep them narrow.
 */
export async function withSystem<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system', 'on', true)`);
    return fn(tx);
  });
}
