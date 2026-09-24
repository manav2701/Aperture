import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Same real Postgres harness as @aperture/db: one container, a migrated template, a clone per file.
    globalSetup: [fileURLToPath(import.meta.resolve('@aperture/db/testing/global-setup'))],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
