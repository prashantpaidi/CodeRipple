import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createNeo4jDriver } from '../../../src/storage/neo4j/neo4j-client.js';
import { loadNeo4jConfig } from '../../../src/storage/neo4j/neo4j-config.js';
import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import { initializeSchema } from '../../../src/storage/neo4j/neo4j-schema.js';
import { analyzeFixture } from '../../helpers.js';
import {
  countBelongsTo,
  countCodeEntities,
  countCodeRelationships,
  countRepositories,
  createTestStore,
  testRepository,
  withDriver,
} from '../support.js';

let store: Neo4jGraphStore;
const graphRepo = testRepository('persistence_graph');
const basicRepo = testRepository('persistence_basic');

beforeAll(async () => {
  store = await createTestStore();
  await store.saveGraph(analyzeFixture('graph-project'), graphRepo);
  await store.saveGraph(analyzeFixture('basic-project'), basicRepo);
});

afterAll(async () => {
  await store?.close();
});

describe('connects to Neo4j', () => {
  it('creates the repository record on save', async () => {
    await withDriver(async (driver) => {
      expect(await countRepositories(driver, graphRepo.id)).toBe(1);
    });
  });

  it('initializes the schema idempotently', async () => {
    const config = loadNeo4jConfig();
    const driver = createNeo4jDriver(config);
    try {
      await expect(initializeSchema(driver, config)).resolves.toBeUndefined();
      await expect(initializeSchema(driver, config)).resolves.toBeUndefined();
    } finally {
      await driver.close();
    }
  });
});

describe('persists code entities', () => {
  it('persists FILE nodes', async () => {
    const node = await store.getNode(basicRepo.id, 'src/user.ts');
    expect(node).toMatchObject({ type: 'FILE', name: 'user.ts', path: 'src/user.ts' });
  });

  it('persists CLASS nodes', async () => {
    const node = await store.getNode(basicRepo.id, 'src/user.ts::UserRepository');
    expect(node).toMatchObject({
      type: 'CLASS',
      name: 'UserRepository',
      file: 'src/user.ts',
      startLine: 6,
      endLine: 20,
    });
  });

  it('persists FUNCTION nodes', async () => {
    const node = await store.getNode(basicRepo.id, 'src/index.ts::main');
    expect(node).toMatchObject({ type: 'FUNCTION', name: 'main', file: 'src/index.ts' });
  });

  it('persists METHOD nodes with their parent', async () => {
    const node = await store.getNode(basicRepo.id, 'src/user.ts::UserRepository.findByEmail');
    expect(node).toMatchObject({
      type: 'METHOD',
      name: 'findByEmail',
      parent: 'src/user.ts::UserRepository',
    });
  });

  it('stores exactly the graph nodes/edges and repository membership', async () => {
    const graph = analyzeFixture('graph-project');
    await withDriver(async (driver) => {
      expect(await countCodeEntities(driver, graphRepo.id)).toBe(graph.nodes.length);
      expect(await countCodeRelationships(driver, graphRepo.id)).toBe(graph.edges.length);
      expect(await countBelongsTo(driver, graphRepo.id)).toBe(graph.nodes.length);
    });
  });
});

describe('persists relationships', () => {
  it('persists CONTAINS relationships', async () => {
    const result = await store.getDependencies(basicRepo.id, 'src/user.ts', {
      relationshipTypes: ['CONTAINS'],
      maxDepth: 1,
    });
    const ids = result.nodes.map((match) => match.node.id);

    expect(ids).toContain('src/user.ts::UserRepository');
    expect(ids).toContain('src/user.ts::normalizeEmail');
  });

  it('persists IMPORTS relationships', async () => {
    const result = await store.getDependencies(basicRepo.id, 'src/auth.ts', {
      relationshipTypes: ['IMPORTS'],
      maxDepth: 1,
    });

    expect(result.nodes.map((match) => match.node.id)).toEqual(['src/user.ts']);
  });

  it('persists CALLS relationships', async () => {
    const result = await store.getCallees(graphRepo.id, 'src/service.ts::createUser');

    expect(result.nodes.map((match) => match.node.id)).toEqual(['src/service.ts::validateUser']);
  });
});
