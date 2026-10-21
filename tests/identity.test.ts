import { describe, expect, it } from 'vitest';

import type { GraphNode } from '../src/graph/graph-types.js';
import { analyzeFixture } from './helpers.js';

function idsOfType(nodes: readonly GraphNode[], type: GraphNode['type']): string[] {
  return nodes
    .filter((node) => node.type === type)
    .map((node) => node.id);
}

describe('symbol identity', () => {
  it('keeps getter/setter pairs as distinct declarations', () => {
    const graph = analyzeFixture('edge-cases-project');
    const ids = idsOfType(graph.nodes, 'METHOD');

    expect(ids).toContain('src/accessors.ts::Temperature.get:value');
    expect(ids).toContain('src/accessors.ts::Temperature.set:value');
    expect(ids).toHaveLength(6);
  });

  it('keeps static and instance members with the same name distinct', () => {
    const ids = idsOfType(analyzeFixture('edge-cases-project').nodes, 'METHOD');

    expect(ids).toContain('src/factory.ts::Factory.build');
    expect(ids).toContain('src/factory.ts::Factory.static:build');
  });

  it('collapses overloads into one logical node spanning every signature', () => {
    const parse = analyzeFixture('edge-cases-project').nodes.find(
      (node) => node.id === 'src/overloads.ts::parse',
    );

    expect(parse).toMatchObject({
      type: 'FUNCTION',
      name: 'parse',
      file: 'src/overloads.ts',
      startLine: 1,
      endLine: 5,
    });
  });

  it('keeps same-named symbols in different files distinct', () => {
    const helperIds = idsOfType(analyzeFixture('edge-cases-project').nodes, 'FUNCTION')
      .filter((id) => id.endsWith('::helper'))
      .sort();

    expect(helperIds).toEqual(['src/callbacks.ts::helper', 'src/nested.ts::helper']);
  });

  it('never produces duplicate node or edge IDs', () => {
    for (const name of ['edge-cases-project', 'calls-project', 'basic-project']) {
      const graph = analyzeFixture(name);
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
      expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
    }
  });
});
