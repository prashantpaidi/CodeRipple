import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration.
 *
 * These tests exercise the Neo4j persistence/query layer against a real Neo4j
 * container (Testcontainers), so they are kept out of the default `pnpm test`
 * run and executed with `pnpm test:integration`.
 *
 * A single container is started by `tests/integration/global-setup.ts` and
 * shared by every test file: `fileParallelism` is disabled and the fork pool is
 * used so the connection settings exported by global setup are visible.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    globalSetup: ['tests/integration/global-setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
