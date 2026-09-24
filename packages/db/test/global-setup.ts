import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { connect, runMigrations } from '../src/client';

export const TEMPLATE_DATABASE = 'aperture_template';

/**
 * Starts one real Postgres 17 for the whole run and migrates a template database. Each test
 * file clones the template (see database.ts), so files are isolated and migrations run once.
 */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase(TEMPLATE_DATABASE)
    .withUsername('aperture')
    .withPassword('aperture')
    .withCommand(['postgres', '-c', 'max_connections=300', '-c', 'fsync=off'])
    .start();

  const handle = connect(container.getConnectionUri());
  await runMigrations(handle.db);
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
