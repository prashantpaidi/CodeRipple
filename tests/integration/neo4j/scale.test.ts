import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import { generateCalls, generateFunctionNames, syntheticGraph } from '../../synthetic-graph.js';
import { countCodeEntities, countCodeRelationships, createTestStore, testRepository, withDriver } from '../support.js';

let store: Neo4jGraphStore;
const repo = testRepository('scale');

const names = generateFunctionNames(1000);
const graph = syntheticGraph(names, generateCalls(names, 2000));

beforeAll(async () => {
  store = await createTestStore();
});

afterAll(async () => {
  await store.close();
});

describe('scale sanity check', () => {
  it('persists a 1,000+ node / 2,000+ edge graph without sequential round trips', async () => {
    // Batching (a fixed number of statements regardless of size) is verified by
    // the pure `planPersistence` unit test; this exercises the real database.
    const startedAt = Date.now();
    await store.saveGraph(graph, repo);
    const elapsedMs = Date.now() - startedAt;

    expect(graph.nodes.length).toBeGreaterThanOrEqual(1000);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2000);

    await withDriver(async (driver) => {
      expect(await countCodeEntities(driver, repo.id)).toBe(graph.nodes.length);
      expect(await countCodeRelationships(driver, repo.id)).toBe(graph.edges.length);
    });

    // A generous ceiling that would still catch a pathological per-node write
    // pattern (thousands of sequential round trips).
    expect(elapsedMs).toBeLessThan(60_000);

    expect(await store.getNode(repo.id, 'src/graph-fixture.ts')).not.toBeNull();
    const dependencies = await store.getDependencies(
      repo.id,
      `src/graph-fixture.ts::${names[0] ?? ''}`,
      { maxDepth: 2 },
    );
    expect(dependencies.nodes.length).toBeGreaterThan(0);
  });
});
