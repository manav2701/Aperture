import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { connect, runMigrations } from '../src/client';

export const TEMPLATE_DATABASE = 'aperture_template';
export const APP_ROLE = 'aperture_api_test';

/**
 * Starts one real Postgres 17 for the whole run and migrates a template database. Each test
 * file clones the template (see database.ts), so files are isolated and migrations run once.
 */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase(TEMPLATE_DATABASE)
    .withUsername('aperture')
    .withPassword('aperture')
    .withCommand(['postgres', '-c', 'max_connections=300', '-c', 'fsync=off'])
    .start();

  const handle = connect(container.getConnectionUri());
  await runMigrations(handle.db);
  // The container's default user is a superuser, which ignores row-level security. Services run
  // as a non-superuser login role in aperture_app, like this one.
  await handle.pool.query(`create role ${APP_ROLE} login password '${APP_ROLE}' in role aperture_app`);
  await handle.close();

  project.provide('postgresUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}
