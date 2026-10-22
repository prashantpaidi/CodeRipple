import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import { codeGraphSchema, validateCodeGraph } from '../src/graph/graph-schema.js';
import type { CodeGraph } from '../src/graph/graph-types.js';
import { analyzeFixture } from './helpers.js';

function minimalGraph(): CodeGraph {
  return {
    version: '1',
    repository: { name: 'mini' },
    nodes: [
      { id: 'a.ts', type: 'FILE', name: 'a.ts', path: 'a.ts' },
      {
        id: 'a.ts::f',
        type: 'FUNCTION',
        name: 'f',
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
      },
    ],
    edges: [
      { id: 'CALLS:a.ts->a.ts::f', type: 'CALLS', from: 'a.ts', to: 'a.ts::f' },
    ],
    unresolvedReferences: [],
    metadata: {
      filesAnalyzed: 1,
      classes: 0,
      functions: 1,
      methods: 0,
      resolvedCalls: 1,
      unresolvedCalls: 0,
    },
  };
}

describe('graph integrity validation', () => {
  it('accepts a well-formed graph', () => {
    expect(codeGraphSchema.safeParse(minimalGraph()).success).toBe(true);
    expect(codeGraphSchema.safeParse(analyzeFixture('edge-cases-project')).success).toBe(
      true,
    );
  });

  it('rejects an edge whose endpoints are not nodes', () => {
    const graph = minimalGraph();
    graph.edges.push({
      id: 'CALLS:ghost->a.ts::f',
      type: 'CALLS',
      from: 'a.ts::ghost',
      to: 'a.ts::f',
    });
    // Keep metadata consistent so only the endpoint check can fail the graph.
    graph.metadata.resolvedCalls = 2;

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('rejects duplicate node IDs', () => {
    const graph = minimalGraph();
    graph.nodes.push({
      id: 'a.ts::f',
      type: 'FUNCTION',
      name: 'f',
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
    });
    // Keep metadata consistent so only the duplicate-ID check can fail the graph.
    graph.metadata.functions = 2;

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('rejects a CALLS edge that targets a FILE node', () => {
    const graph = minimalGraph();
    graph.edges[0] = { id: 'CALLS:a.ts::f->a.ts', type: 'CALLS', from: 'a.ts::f', to: 'a.ts' };

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('rejects a METHOD whose parent is not a CLASS', () => {
    const graph = minimalGraph();
    graph.nodes.push({
      id: 'a.ts::C.m',
      type: 'METHOD',
      name: 'm',
      file: 'a.ts',
      parent: 'a.ts::f',
      startLine: 1,
      endLine: 1,
    });
    graph.metadata.methods = 1;

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('rejects a node that references an unknown file', () => {
    const graph = minimalGraph();
    graph.nodes[1] = {
      id: 'a.ts::f',
      type: 'FUNCTION',
      name: 'f',
      file: 'missing.ts',
      startLine: 1,
      endLine: 1,
    };

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('rejects an unresolved reference with an unknown caller', () => {
    const graph = minimalGraph();
    graph.unresolvedReferences.push({
      caller: 'a.ts::ghost',
      expression: 'x()',
      line: 1,
      reason: 'TARGET_NOT_RESOLVED',
    });
    graph.metadata.unresolvedCalls = 1;

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('rejects metadata that disagrees with the graph contents', () => {
    const graph = minimalGraph();
    graph.metadata.functions = 99;

    expect(codeGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('throws a ZodError from validateCodeGraph', () => {
    const graph = minimalGraph();
    graph.metadata.classes = 42;

    expect(() => validateCodeGraph(graph)).toThrow(ZodError);
  });
});
