import { fileURLToPath } from 'node:url';
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

export function connect(connectionString: string, options: { max?: number } = {}): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
