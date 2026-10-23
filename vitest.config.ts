import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests need a real Neo4j container; run them with
    // `pnpm test:integration` instead of the Docker-free default suite.
    exclude: [...configDefaults.exclude, 'tests/integration/**'],
    environment: 'node',
    globals: false,
    // Some tests launch the CLI as a subprocess through tsx; on a cold cache
    // that startup can exceed Vitest's 5s default. This raises the ceiling only.
    testTimeout: 30_000,
  },
});
