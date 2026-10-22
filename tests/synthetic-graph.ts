import path from 'node:path';

import { edgeId } from '../src/graph/ids.js';
import {
  GRAPH_VERSION,
  type CodeGraph,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
} from '../src/graph/graph-types.js';

/**
 * Deterministic synthetic graphs for storage/query tests.
 *
 * Building graphs directly lets tests exercise persistence, re-indexing,
 * isolation, and scale without depending on analyzer fixtures.
 */

export interface SyntheticGraphOptions {
  /** Repository-relative path of the single FILE node. */
  file?: string;
  /** Value stored in `repository.name`. */
  repositoryName?: string;
}

export function syntheticGraph(
  functions: readonly string[],
  calls: readonly (readonly [string, string])[],
  options: SyntheticGraphOptions = {},
): CodeGraph {
  const filePath = options.file ?? 'src/graph-fixture.ts';
  const functionId = (name: string): string => `${filePath}::${name}`;

  const nodes: GraphNode[] = [
    {
      id: filePath,
      type: 'FILE',
      name: path.posix.basename(filePath),
      path: filePath,
    },
  ];

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (type: EdgeType, from: string, to: string): void => {
    const key = `${type}\u0000${from}\u0000${to}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push({ id: edgeId(type, from, to), type, from, to });
  };

  for (const name of functions) {
    nodes.push({
      id: functionId(name),
      type: 'FUNCTION',
      name,
      file: filePath,
      startLine: 1,
      endLine: 1,
    });
    addEdge('CONTAINS', filePath, functionId(name));
  }

  for (const [from, to] of calls) {
    addEdge('CALLS', functionId(from), functionId(to));
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const calls2 = edges.filter((edge) => edge.type === 'CALLS').length;

  return {
    version: GRAPH_VERSION,
    repository: { name: options.repositoryName ?? 'synthetic' },
    nodes,
    edges,
    unresolvedReferences: [],
    metadata: {
      filesAnalyzed: 1,
      classes: 0,
      functions: functions.length,
      methods: 0,
      resolvedCalls: calls2,
      unresolvedCalls: 0,
    },
  };
}

/** A graph shaped `a -> target`, `b -> target` (two callers of one node). */
export function twoCallersGraph(): CodeGraph {
  return syntheticGraph(['a', 'b', 'target'], [
    ['a', 'target'],
    ['b', 'target'],
  ]);
}

export function generateFunctionNames(count: number, prefix = 'fn'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

function pick<T>(items: readonly T[], index: number): T {
  const size = items.length;
  const value = items[((index % size) + size) % size];
  if (value === undefined) {
    throw new Error('Cannot pick from an empty collection');
  }
  return value;
}

/**
 * Generate `count` distinct call pairs over the given function names.
 *
 * Enumerates ordered pairs `(from, to)` with `from !== to` in a fixed order, so
 * the result is deterministic, duplicate-free, and guaranteed to yield `count`
 * pairs whenever `count <= n * (n - 1)`.
 */
export function generateCalls(
  names: readonly string[],
  count: number,
): Array<readonly [string, string]> {
  const size = names.length;
  if (size < 2) {
    return [];
  }

  const pairs: Array<readonly [string, string]> = [];
  const total = size * (size - 1);
  for (let position = 0; position < total && pairs.length < count; position += 1) {
    const fromIndex = Math.floor(position / (size - 1));
    let toIndex = position % (size - 1);
    if (toIndex >= fromIndex) {
      toIndex += 1;
    }
    pairs.push([pick(names, fromIndex), pick(names, toIndex)]);
  }
  return pairs;
}
