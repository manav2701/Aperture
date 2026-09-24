/**
 * Applies pending migrations to DATABASE_URL.
 *   pnpm db:migrate            (reads DATABASE_URL from the repo's .env if present)
 */
import { connect, runMigrations } from './client';

const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  process.stderr.write('DATABASE_URL is not set\n');
  process.exit(2);
}

const handle = connect(url, { max: 1 });
try {
  await runMigrations(handle.db);
  const applied = await handle.pool.query<{ count: string }>('select count(*) from drizzle.__drizzle_migrations');
  process.stdout.write(`migrations up to date (${applied.rows[0]?.count ?? '0'} applied)\n`);
} catch (error) {
  process.stderr.write(`migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
