import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: [fileURLToPath(import.meta.resolve('@aperture/db/testing/global-setup'))],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
