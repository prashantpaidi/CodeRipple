import { describe, expect, it } from 'vitest';

import { planPersistence } from '../src/storage/neo4j/neo4j-persistence-plan.js';
import type { RepositoryIdentity } from '../src/storage/repository-identity.js';
import { generateCalls, generateFunctionNames, syntheticGraph } from './synthetic-graph.js';

const repository: RepositoryIdentity = {
  id: 'repo_scale_test',
  name: 'scale',
  rootPath: '/tmp/scale',
  source: 'override',
};

describe('planPersistence', () => {
  it('groups nodes by type and edges by type', () => {
    const graph = syntheticGraph(['a', 'b', 'target'], [
      ['a', 'target'],
      ['b', 'target'],
    ]);
    const plan = planPersistence(graph, repository);

    expect(plan.nodeBatches.map((batch) => batch.label)).toEqual(['File', 'Function']);
    expect(plan.edgeBatches.map((batch) => batch.type)).toEqual(['CONTAINS', 'CALLS']);
  });

  it('namespaces every node ref with the repository identity', () => {
    const plan = planPersistence(syntheticGraph(['a'], []), repository);
    const rows = plan.nodeBatches.flatMap((batch) => batch.rows);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.ref.startsWith(`${repository.id}::`)).toBe(true);
    }
  });

  it('keeps the number of write batches constant as the graph grows', () => {
    const names = generateFunctionNames(999);
    const calls = generateCalls(names, 2000);
    const graph = syntheticGraph(names, calls);
    const plan = planPersistence(graph, repository);

    const nodeRows = plan.nodeBatches.flatMap((batch) => batch.rows);
    const edgeRows = plan.edgeBatches.flatMap((batch) => batch.rows);

    // 1 FILE + 999 FUNCTION nodes.
    expect(nodeRows).toHaveLength(1000);
    expect(nodeRows.filter((row) => row.props.type === 'FUNCTION')).toHaveLength(999);

    // 999 CONTAINS edges + 2000 CALLS edges.
    expect(calls).toHaveLength(2000);
    expect(edgeRows).toHaveLength(999 + 2000);

    // The whole graph is written with at most 4 node batches and 3 edge
    // batches — never one round trip per node/edge (no N+1).
    expect(plan.nodeBatches.length).toBeLessThanOrEqual(4);
    expect(plan.edgeBatches.length).toBeLessThanOrEqual(3);
    expect(plan.nodeBatches.length + plan.edgeBatches.length).toBeLessThanOrEqual(7);

    // Same batch count for a tiny graph: the plan is size-independent.
    const small = planPersistence(syntheticGraph(['a', 'b'], [['a', 'b']]), repository);
    expect(small.nodeBatches).toHaveLength(plan.nodeBatches.length);
    expect(small.edgeBatches).toHaveLength(plan.edgeBatches.length);
  });
});
