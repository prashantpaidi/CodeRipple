import { describe, expect, it } from 'vitest';

import { generateCalls, syntheticGraph } from './synthetic-graph.js';

describe('synthetic graph helpers', () => {
  it('rejects duplicate function names that would create duplicate node IDs', () => {
    expect(() => syntheticGraph(['a', 'a'], [])).toThrow(/Duplicate function name/);
  });

  it('rejects duplicate names in generateCalls', () => {
    expect(() => generateCalls(['a', 'a'], 1)).toThrow(/unique/);
  });

  it('produces distinct, non-self call pairs', () => {
    const names = ['a', 'b', 'c'];
    const pairs = generateCalls(names, 6);
    const keys = new Set(pairs.map(([from, to]) => `${from}->${to}`));

    expect(pairs).toHaveLength(6);
    expect(keys.size).toBe(pairs.length);
    expect(pairs.every(([from, to]) => from !== to)).toBe(true);
  });
});
