import type { CodeGraph, EdgeType, GraphEdge, GraphNode } from './graph-types.js';
import { compareStrings } from '../utils/paths.js';

/** A bounded traversal result; truncation means further matches may exist. */
export interface GraphQueryResult {
  nodes: { node: GraphNode; depth: number }[];
  truncated: boolean;
}

/** Traverse resolved edges in a graph without requiring a graph database. */
export function traverseGraph(
  graph: CodeGraph,
  root: string,
  options: { direction: 'incoming' | 'outgoing'; depth: number; limit: number; types?: readonly EdgeType[] },
): GraphQueryResult {
  if (!Number.isSafeInteger(options.depth) || options.depth < 1 || options.depth > 5) throw new RangeError('depth must be between 1 and 5');
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new RangeError('limit must be between 1 and 1000');
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodes.has(root)) throw new Error(`Node not found: ${root}`);
  const types = new Set(options.types ?? ['CALLS']);
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (!types.has(edge.type) || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const key = options.direction === 'outgoing' ? edge.from : edge.to;
    const list = adjacency.get(key) ?? [];
    list.push(edge);
    adjacency.set(key, list);
  }
  for (const list of adjacency.values()) list.sort((a, b) => compareStrings(a.id, b.id));
  const visited = new Set([root]);
  const queue = [{ id: root, depth: 0 }];
  const matches: GraphQueryResult['nodes'] = [];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (!current || current.depth === options.depth) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      const id = options.direction === 'outgoing' ? edge.to : edge.from;
      if (visited.has(id)) continue;
      if (matches.length === options.limit) return { nodes: matches, truncated: true };
      visited.add(id);
      const node = nodes.get(id);
      if (!node) continue;
      const depth = current.depth + 1;
      matches.push({ node, depth });
      queue.push({ id, depth });
    }
  }
  return { nodes: matches, truncated: false };
}
