import { describe, expect, it } from 'vitest';

import { analyzeFixture } from './helpers.js';

describe('module-level calls', () => {
  it('attributes top-level calls to the FILE node', () => {
    const callIds = analyzeFixture('module-project')
      .edges.filter((edge) => edge.type === 'CALLS')
      .map((edge) => edge.id);

    expect(callIds).toContain('CALLS:src/main.ts->src/main.ts::run');
    expect(callIds).toContain('CALLS:src/main.ts->src/startup.ts::initialize');
  });

  it('records unresolved module-level calls against the FILE node', () => {
    const reference = analyzeFixture('module-project').unresolvedReferences.find(
      (candidate) => candidate.expression === "console.log('ready')",
    );

    expect(reference).toMatchObject({
      caller: 'src/main.ts',
      reason: 'EXTERNAL_DEPENDENCY',
    });
  });
});
