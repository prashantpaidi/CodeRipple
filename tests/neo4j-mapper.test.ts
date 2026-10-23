import { describe, expect, it } from 'vitest';

import { GraphStoreError } from '../src/storage/errors.js';
import {
  extractNodeProperties,
  graphNodeToProperties,
  isEdgeType,
  pathToGraphPath,
  propertiesToGraphNode,
  refOf,
  relationshipToGraphEdge,
  toInteger,
} from '../src/storage/neo4j/neo4j-mapper.js';
import type { GraphNode } from '../src/graph/graph-types.js';

const repositoryId = 'repo_test';

const fileNode: GraphNode = { id: 'src/a.ts', type: 'FILE', name: 'a.ts', path: 'src/a.ts' };
const classNode: GraphNode = {
  id: 'src/a.ts::C',
  type: 'CLASS',
  name: 'C',
  file: 'src/a.ts',
  startLine: 1,
  endLine: 5,
};
const functionNode: GraphNode = {
  id: 'src/a.ts::f',
  type: 'FUNCTION',
  name: 'f',
  file: 'src/a.ts',
  startLine: 7,
  endLine: 9,
};
const secondFunctionNode: GraphNode = {
  id: 'src/a.ts::g',
  type: 'FUNCTION',
  name: 'g',
  file: 'src/a.ts',
  startLine: 11,
  endLine: 13,
};
const methodNode: GraphNode = {
  id: 'src/a.ts::C.m',
  type: 'METHOD',
  name: 'm',
  file: 'src/a.ts',
  parent: 'src/a.ts::C',
  startLine: 2,
  endLine: 4,
};

describe('node mapping', () => {
  it('round-trips every node type', () => {
    for (const node of [fileNode, classNode, functionNode, methodNode]) {
      const properties = graphNodeToProperties(node, repositoryId);

      expect(properties.ref).toBe(refOf(repositoryId, node.id));
      expect(properties.repositoryId).toBe(repositoryId);
      expect(properties.type).toBe(node.type);
      expect(propertiesToGraphNode(properties)).toEqual(node);
    }
  });

  it('namespaces node IDs with the repository identity', () => {
    expect(refOf('repo_a', 'src/x.ts')).toBe('repo_a::src/x.ts');
    expect(refOf('repo_b', 'src/x.ts')).not.toBe(refOf('repo_a', 'src/x.ts'));
  });

  it('keeps refs injective when a component itself contains the separator', () => {
    // Without escaping, both of these would render as `a::b::c`.
    expect(refOf('a', 'b::c')).not.toBe(refOf('a::b', 'c'));
    expect(refOf('a', 'b%c')).not.toBe(refOf('a', 'b%3A%3Ac'));
  });

  it('rejects an unknown node type', () => {
    expect(() => propertiesToGraphNode({ id: 'x', type: 'WEIRD', name: 'x' })).toThrow(
      GraphStoreError,
    );
  });

  it('rejects a corrupt record instead of yielding a malformed node', () => {
    expect(() => propertiesToGraphNode({ type: 'FILE', name: 'a', path: 'a' })).toThrow(
      GraphStoreError,
    );
  });

  it('extracts properties from a driver node record, rejecting garbage', () => {
    const properties = { id: 'x', type: 'FILE', name: 'a', path: 'a' };
    expect(extractNodeProperties({ properties })).toEqual(properties);
    expect(() => extractNodeProperties({})).toThrow(GraphStoreError);
    expect(() => extractNodeProperties(null)).toThrow(GraphStoreError);
  });
});

describe('edge and path mapping', () => {
  it('recognizes CodeRipple edge types only', () => {
    expect(isEdgeType('CALLS')).toBe(true);
    expect(isEdgeType('CONTAINS')).toBe(true);
    expect(isEdgeType('IMPORTS')).toBe(true);
    expect(isEdgeType('CALLERS')).toBe(false);
    expect(isEdgeType(42)).toBe(false);
  });

  it('prefers the stored edge id and otherwise rebuilds it', () => {
    expect(relationshipToGraphEdge('CALLS', 'a', 'b', { id: 'CALLS:a->b' })).toEqual({
      id: 'CALLS:a->b',
      type: 'CALLS',
      from: 'a',
      to: 'b',
    });
    expect(relationshipToGraphEdge('CALLS', 'a', 'b', {})).toEqual({
      id: 'CALLS:a->b',
      type: 'CALLS',
      from: 'a',
      to: 'b',
    });
  });

  it('maps a driver path into CodeRipple nodes and edges', () => {
    const path = {
      nodes: [
        { properties: graphNodeToProperties(functionNode, repositoryId) },
        { properties: graphNodeToProperties(secondFunctionNode, repositoryId) },
      ],
      relationships: [{ type: 'CALLS', properties: { id: 'CALLS:src/a.ts::f->src/a.ts::g' } }],
    };

    const graphPath = pathToGraphPath(path);

    expect(graphPath.nodes.map((node) => node.id)).toEqual(['src/a.ts::f', 'src/a.ts::g']);
    expect(graphPath.edges).toEqual([
      { id: 'CALLS:src/a.ts::f->src/a.ts::g', type: 'CALLS', from: 'src/a.ts::f', to: 'src/a.ts::g' },
    ]);
  });

  it('rejects a path whose relationship type is unknown', () => {
    expect(() =>
      pathToGraphPath({
        nodes: [
          { properties: graphNodeToProperties(functionNode, repositoryId) },
          { properties: graphNodeToProperties(secondFunctionNode, repositoryId) },
        ],
        relationships: [{ type: 'OWNS', properties: {} }],
      }),
    ).toThrow(GraphStoreError);
  });

  it('rejects a value that is not a path', () => {
    expect(() => pathToGraphPath({ nodes: [] })).toThrow(GraphStoreError);
  });

  it('rejects a path whose nodes and relationships disagree', () => {
    expect(() =>
      pathToGraphPath({
        nodes: [
          { properties: graphNodeToProperties(functionNode, repositoryId) },
          { properties: graphNodeToProperties(secondFunctionNode, repositoryId) },
        ],
        relationships: [
          { type: 'CALLS', properties: {} },
          { type: 'CALLS', properties: {} },
        ],
      }),
    ).toThrow(/nodes and relationships disagree|nodes but/);
  });

  it('coerces integer values and rejects non-integers', () => {
    expect(toInteger(3)).toBe(3);
    expect(() => toInteger('3')).toThrow(GraphStoreError);
    expect(() => toInteger(undefined)).toThrow(GraphStoreError);
  });

  it('accepts the driver lossless Integer shape as well as plain numbers', () => {
    expect(toInteger({ toNumber: () => 7 })).toBe(7);
    expect(() => toInteger({ toNumber: () => 1.5 })).toThrow(GraphStoreError);
  });
});
