import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeRepository } from '../src/cli/analyze.js';
import type { CodeGraph } from '../src/graph/graph-types.js';

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

export const fixturesDir = path.join(repoRoot, 'fixtures');

/** Absolute path to a fixture repository. */
export function fixture(name: string): string {
  return path.join(fixturesDir, name);
}

const cache = new Map<string, CodeGraph>();

/** Analyze a fixture once and memoize the resulting graph for the test run. */
export function analyzeFixture(name: string): CodeGraph {
  const cached = cache.get(name);
  if (cached) {
    return cached;
  }
  const graph = analyzeRepository(fixture(name)).graph;
  cache.set(name, graph);
  return graph;
}

/** Find a node by ID, failing loudly when it is absent. */
export function nodeById(graph: CodeGraph, id: string) {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Expected a node with id "${id}"`);
  }
  return node;
}

/** All edge IDs of a given type, sorted. */
export function edgeIdsOfType(graph: CodeGraph, type: CodeGraph['edges'][number]['type']): string[] {
  return graph.edges
    .filter((edge) => edge.type === type)
    .map((edge) => edge.id)
    .sort();
}
