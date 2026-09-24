import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { connect, type DatabaseHandle } from '../src/client';
import { TEMPLATE_DATABASE } from './global-setup';

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** A fresh, fully migrated database cloned from the template. */
export async function createTestDatabase(
  options: { maxConnections?: number } = {},
): Promise<DatabaseHandle & { url: string }> {
  const baseUrl = inject('postgresUrl');
  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: withDatabase(baseUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`create database ${name} template ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(baseUrl, name);
  const options_ = options.maxConnections === undefined ? {} : { max: options.maxConnections };
  return { ...connect(url, options_), url };
}
