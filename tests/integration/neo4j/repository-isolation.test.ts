import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refOf } from '../../../src/storage/neo4j/neo4j-mapper.js';
import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import { syntheticGraph } from '../../synthetic-graph.js';
import {
  countCodeEntities,
  countQuery,
  createTestStore,
  executeWrite,
  testRepository,
  withDriver,
} from '../support.js';

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
  await store?.close();
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

/* ------------------------------------------------------------------ *
 * Traversal isolation against deliberately cross-repository data
 * ------------------------------------------------------------------ */

const crossA = testRepository('cross_a');
const crossB = testRepository('cross_b');

const fileOf = (repo: { id: string }, name: string): string =>
  refOf(repo.id, `src/graph-fixture.ts::${name}`);

describe('traversal cannot cross repository boundaries', () => {
  beforeAll(async () => {
    // Within repo A, `start` and `end` are NOT connected by CALLS.
    await store.saveGraph(syntheticGraph(['start', 'end'], []), crossA);
    await store.saveGraph(syntheticGraph(['hop'], []), crossB);

    // Create a chain that only connects A's `start` to A's `end` by routing
    // *through* repository B. This is data the store would never produce, so we
    // write it directly — exactly the case isolation must defend against.
    await withDriver(async (driver) => {
      await executeWrite(
        driver,
        'MATCH (a:CodeEntity {ref: $from}), (b:CodeEntity {ref: $to}) CREATE (a)-[:CALLS]->(b)',
        { from: fileOf(crossA, 'start'), to: fileOf(crossB, 'hop') },
      );
      await executeWrite(
        driver,
        'MATCH (a:CodeEntity {ref: $from}), (b:CodeEntity {ref: $to}) CREATE (a)-[:CALLS]->(b)',
        { from: fileOf(crossB, 'hop'), to: fileOf(crossA, 'end') },
      );
    });
  });

  it('actually created the cross-repository relationships (test premise)', async () => {
    await withDriver(async (driver) => {
      const crossIntoB = await countQuery(
        driver,
        'MATCH (:CodeEntity {ref: $from})-[:CALLS]->(:CodeEntity {ref: $to}) RETURN count(*) AS value',
        { from: fileOf(crossA, 'start'), to: fileOf(crossB, 'hop') },
      );
      const crossIntoA = await countQuery(
        driver,
        'MATCH (:CodeEntity {ref: $from})-[:CALLS]->(:CodeEntity {ref: $to}) RETURN count(*) AS value',
        { from: fileOf(crossB, 'hop'), to: fileOf(crossA, 'end') },
      );
      expect(crossIntoB).toBe(1);
      expect(crossIntoA).toBe(1);
    });
  });

  it('does not reach a same-repository node through another repository', async () => {
    const result = await store.getDependencies(crossA.id, 'src/graph-fixture.ts::start', {
      maxDepth: 2,
    });
    expect(result.nodes).toEqual([]);
  });

  it('does not reach a same-repository node upstream through another repository', async () => {
    const result = await store.getDependents(crossA.id, 'src/graph-fixture.ts::end', {
      maxDepth: 2,
    });
    expect(result.nodes).toEqual([]);
  });

  it('does not return a path that routes through another repository', async () => {
    const result = await store.findPaths(
      crossA.id,
      'src/graph-fixture.ts::start',
      'src/graph-fixture.ts::end',
      { maxDepth: 2 },
    );
    expect(result.paths).toEqual([]);
  });

  it('does not traverse from the other repository into this one either', async () => {
    const result = await store.getDependencies(crossB.id, 'src/graph-fixture.ts::hop', {
      maxDepth: 2,
    });
    expect(result.nodes).toEqual([]);
  });

  it('still returns legitimate same-repository results (the guard is not over-broad)', async () => {
    const result = await store.getDependencies(crossA.id, 'src/graph-fixture.ts', {
      relationshipTypes: ['CONTAINS'],
      maxDepth: 1,
    });
    expect(result.nodes.map((match) => match.node.name).sort()).toEqual(['end', 'start']);
  });
});
