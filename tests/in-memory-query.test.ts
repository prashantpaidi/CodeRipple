import { describe, expect, it } from 'vitest';
import { traverseGraph } from '../src/graph/in-memory-query.js';
import type { CodeGraph } from '../src/graph/graph-types.js';

const graph: CodeGraph = {
  version: '1', repository: { name: 'test' },
  nodes: ['a', 'b', 'c'].map((id) => ({ id, type: 'FILE' as const, name: id, path: id })),
  edges: [
    { id: '1', type: 'CALLS', from: 'a', to: 'b' },
    { id: '2', type: 'CALLS', from: 'b', to: 'c' },
    { id: '3', type: 'CALLS', from: 'c', to: 'a' },
    { id: '4', type: 'IMPORTS', from: 'a', to: 'c' },
  ],
  unresolvedReferences: [],
  metadata: { filesAnalyzed: 3, classes: 0, functions: 0, methods: 0, resolvedCalls: 3, unresolvedCalls: 0 },
};

describe('in-memory graph traversal', () => {
  it('walks resolved calls in either direction without looping on cycles', () => {
    expect(traverseGraph(graph, 'a', { direction: 'outgoing', depth: 5, limit: 10 }).nodes.map((x) => [x.node.id, x.depth])).toEqual([['b', 1], ['c', 2]]);
    expect(traverseGraph(graph, 'a', { direction: 'incoming', depth: 1, limit: 10 }).nodes.map((x) => x.node.id)).toEqual(['c']);
  });
  it('reports truncation and supports explicit relationship types', () => {
    expect(traverseGraph(graph, 'a', { direction: 'outgoing', depth: 5, limit: 1 }).truncated).toBe(true);
    expect(traverseGraph(graph, 'a', { direction: 'outgoing', depth: 1, limit: 1, types: ['IMPORTS'] })).toMatchObject({ nodes: [{ node: { id: 'c' } }], truncated: false });
  });
  it('rejects unknown roots and unbounded requests', () => {
    expect(() => traverseGraph(graph, 'missing', { direction: 'incoming', depth: 1, limit: 1 })).toThrow('Node not found');
    expect(() => traverseGraph(graph, 'a', { direction: 'incoming', depth: 6, limit: 1 })).toThrow('depth');
    expect(() => traverseGraph(graph, 'a', { direction: 'incoming', depth: 1, limit: 1001 })).toThrow('limit');
  });
});
