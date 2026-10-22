import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests need a real Neo4j container; run them with
    // `pnpm test:integration` instead of the Docker-free default suite.
    exclude: [...configDefaults.exclude, 'tests/integration/**'],
    environment: 'node',
    globals: false,
  },
});
