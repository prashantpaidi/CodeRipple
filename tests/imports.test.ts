import { describe, expect, it } from 'vitest';

import { analyzeFixture } from './helpers.js';

describe('import resolution', () => {
  it('resolves relative imports into IMPORTS edges', () => {
    const graph = analyzeFixture('basic-project');
    const importIds = graph.edges
      .filter((edge) => edge.type === 'IMPORTS')
      .map((edge) => edge.id);

    expect(importIds).toContain('IMPORTS:src/auth.ts->src/user.ts');
    expect(importIds).toContain('IMPORTS:src/index.ts->src/auth.ts');
    expect(importIds).toContain('IMPORTS:src/index.ts->src/user.ts');
  });

  it('resolves tsconfig path aliases', () => {
    const graph = analyzeFixture('imports-project');
    const importIds = graph.edges
      .filter((edge) => edge.type === 'IMPORTS')
      .map((edge) => edge.id);

    // `@/lib/math` in src/index.ts resolves through the `@/*` -> `src/*` alias.
    expect(importIds).toContain('IMPORTS:src/index.ts->src/lib/math.ts');
    // Relative import of the same module collapses to a single edge.
    expect(importIds).toContain('IMPORTS:src/index.ts->src/helpers/format.ts');
    expect(importIds.filter((id) => id.endsWith('->src/lib/math.ts'))).toHaveLength(1);
  });

  it('does not create nodes for external npm packages', () => {
    const graph = analyzeFixture('calls-project');
    const fileIds = graph.nodes
      .filter((node) => node.type === 'FILE')
      .map((node) => node.id)
      .sort();

    // `node:fs` is imported by src/dynamic.ts but must not appear as a node.
    expect(fileIds).toEqual([
      'src/calculator.ts',
      'src/dynamic.ts',
      'src/main.ts',
      'src/math.ts',
    ]);
  });
});
