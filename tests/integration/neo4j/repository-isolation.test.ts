import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import { syntheticGraph } from '../../synthetic-graph.js';
import { countCodeEntities, createTestStore, testRepository, withDriver } from '../support.js';

let store: Neo4jGraphStore;

const repoA = testRepository('isolation_a');
const repoB = testRepository('isolation_b');

// Both repositories use the identical internal node IDs (`src/graph-fixture.ts`
// and `...::target`); only the repository identity differs.
const graphA = syntheticGraph(['a', 'target'], [['a', 'target']]);
const graphB = syntheticGraph(['b', 'target'], [['b', 'target']]);

const target = 'src/graph-fixture.ts::target';

beforeAll(async () => {
  store = await createTestStore();
  await store.saveGraph(graphA, repoA);
  await store.saveGraph(graphB, repoB);
});

afterAll(async () => {
  await store.close();
});

describe('repository isolation', () => {
  it('keeps identical node IDs isolated per repository', async () => {
    const nodeA = await store.getNode(repoA.id, target);
    const nodeB = await store.getNode(repoB.id, target);

    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA?.id).toBe(target);
    expect(nodeB?.id).toBe(target);
  });

  it('does not leak relationships across repositories', async () => {
    const callersA = await store.getCallers(repoA.id, target);
    const callersB = await store.getCallers(repoB.id, target);

    expect(callersA.nodes.map((match) => match.node.name)).toEqual(['a']);
    expect(callersB.nodes.map((match) => match.node.name)).toEqual(['b']);
  });

  it('stores each repository graph independently', async () => {
    await withDriver(async (driver) => {
      expect(await countCodeEntities(driver, repoA.id)).toBe(graphA.nodes.length);
      expect(await countCodeEntities(driver, repoB.id)).toBe(graphB.nodes.length);
    });
  });
});

describe('unknown identifiers', () => {
  it('returns null/empty for an unknown repository', async () => {
    expect(await store.getNode('repo_it_does_not_exist', target)).toBeNull();
    expect((await store.getCallers('repo_it_does_not_exist', target)).nodes).toEqual([]);
    expect((await store.getDependencies('repo_it_does_not_exist', target)).nodes).toEqual([]);
  });

  it('returns null/empty for an unknown node in a known repository', async () => {
    expect(await store.getNode(repoA.id, 'src/graph-fixture.ts::missing')).toBeNull();
    expect((await store.getCallers(repoA.id, 'src/graph-fixture.ts::missing')).nodes).toEqual([]);
    expect((await store.getCallees(repoA.id, 'src/graph-fixture.ts::missing')).nodes).toEqual([]);
  });
});
