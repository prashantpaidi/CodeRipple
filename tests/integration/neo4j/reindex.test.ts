import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GraphStoreError } from '../../../src/storage/errors.js';
import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import type { CodeGraph } from '../../../src/graph/graph-types.js';
import { edgeId } from '../../../src/graph/ids.js';
import { syntheticGraph } from '../../synthetic-graph.js';
import {
  countCodeEntities,
  countCodeRelationships,
  createTestStore,
  testRepository,
  withDriver,
} from '../support.js';

let store: Neo4jGraphStore;
const repo = testRepository('reindex');

const filePath = 'src/graph-fixture.ts';
const fn = (name: string): string => `${filePath}::${name}`;

beforeAll(async () => {
  store = await createTestStore();
});

afterAll(async () => {
  await store?.close();
});

describe('re-indexing semantics', () => {
  it('does not create duplicates when re-indexing an unchanged repository', async () => {
    const graph = syntheticGraph(['a', 'b', 'target'], [
      ['a', 'target'],
      ['b', 'target'],
    ]);

    await store.saveGraph(graph, repo);
    const firstEntities = await withDriver((driver) => countCodeEntities(driver, repo.id));
    const firstRelationships = await withDriver((driver) =>
      countCodeRelationships(driver, repo.id),
    );

    await store.saveGraph(graph, repo);
    const secondEntities = await withDriver((driver) => countCodeEntities(driver, repo.id));
    const secondRelationships = await withDriver((driver) =>
      countCodeRelationships(driver, repo.id),
    );

    expect(firstEntities).toBe(graph.nodes.length);
    expect(secondEntities).toBe(firstEntities);
    expect(secondRelationships).toBe(firstRelationships);
    expect(await store.getNode(repo.id, fn('target'))).not.toBeNull();
  });

  it('removes a stale symbol (and its edges) after deleting it and re-indexing', async () => {
    const versionWithSave = syntheticGraph(['create', 'validate', 'save'], [
      ['create', 'validate'],
      ['validate', 'save'],
    ]);
    await store.saveGraph(versionWithSave, repo);

    const versionWithoutSave = syntheticGraph(['create', 'validate'], [['create', 'validate']]);
    await store.saveGraph(versionWithoutSave, repo);

    expect(await store.getNode(repo.id, fn('save'))).toBeNull();
    expect(await store.getCallees(repo.id, fn('validate'))).toMatchObject({ nodes: [] });

    const entities = await withDriver((driver) => countCodeEntities(driver, repo.id));
    const relationships = await withDriver((driver) => countCodeRelationships(driver, repo.id));
    expect(entities).toBe(versionWithoutSave.nodes.length);
    expect(relationships).toBe(versionWithoutSave.edges.length);
  });

  it('leaves the previous graph intact when a replacement fails', async () => {
    const good = syntheticGraph(['keep'], []);
    await store.saveGraph(good, repo);

    const entitiesBefore = await withDriver((driver) => countCodeEntities(driver, repo.id));
    const relationshipsBefore = await withDriver((driver) =>
      countCodeRelationships(driver, repo.id),
    );

    // An edge whose target was never persisted must abort the whole transaction
    // (the CodeGraph type does not itself enforce referential integrity).
    const broken: CodeGraph = {
      ...good,
      edges: [
        ...good.edges,
        {
          id: edgeId('CALLS', fn('keep'), fn('ghost')),
          type: 'CALLS',
          from: fn('keep'),
          to: fn('ghost'),
        },
      ],
    };

    await expect(store.saveGraph(broken, repo)).rejects.toThrow(GraphStoreError);

    // The old graph is fully intact: not half-replaced.
    expect(await store.getNode(repo.id, fn('keep'))).not.toBeNull();
    expect(await withDriver((driver) => countCodeEntities(driver, repo.id))).toBe(entitiesBefore);
    expect(await withDriver((driver) => countCodeRelationships(driver, repo.id))).toBe(
      relationshipsBefore,
    );

    // A subsequent valid replacement still works.
    await store.saveGraph(good, repo);
    expect(await store.getNode(repo.id, fn('keep'))).not.toBeNull();
  });
});
