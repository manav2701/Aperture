import { defineConfig } from 'vitest/config';

// Property tests run thousands of cases; under parallel CI load they can exceed the 5 s default.
export default defineConfig({ test: { testTimeout: 30_000 } });
