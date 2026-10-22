import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import { analyzeFixture } from '../../helpers.js';
import { syntheticGraph } from '../../synthetic-graph.js';
import { createTestStore, testRepository } from '../support.js';

let store: Neo4jGraphStore;
const repo = testRepository('queries');
const diamondRepo = testRepository('queries_diamond');

const createUser = 'src/service.ts::createUser';
const validateUser = 'src/service.ts::validateUser';
const saveUser = 'src/service.ts::saveUser';

/** Map node ID -> depth for a dependency result. */
function depthById(result: { nodes: Array<{ node: { id: string }; depth: number }> }) {
  return new Map(result.nodes.map((match) => [match.node.id, match.depth]));
}

beforeAll(async () => {
  store = await createTestStore();
  await store.saveGraph(analyzeFixture('graph-project'), repo);

  // a -> b -> d, a -> c -> d: `d` is reachable by two paths.
  await store.saveGraph(
    syntheticGraph(['a', 'b', 'c', 'd'], [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['c', 'd'],
    ]),
    diamondRepo,
  );
});

afterAll(async () => {
  await store.close();
});

describe('getNode', () => {
  it('returns the correct entity', async () => {
    const node = await store.getNode(repo.id, createUser);
    expect(node).toMatchObject({ type: 'FUNCTION', name: 'createUser', file: 'src/service.ts' });
  });

  it('returns null for an unknown node', async () => {
    expect(await store.getNode(repo.id, 'src/service.ts::nope')).toBeNull();
  });
});

describe('direct callers and callees', () => {
  it('returns only direct callers', async () => {
    const result = await store.getCallers(repo.id, createUser);
    expect(result.nodes.map((match) => match.node.id)).toEqual([
      'src/admin.ts::seedUsers',
      'src/controller.ts::register',
    ]);
    expect(result.nodes.every((match) => match.depth === 1)).toBe(true);
  });

  it('returns only direct callees', async () => {
    const result = await store.getCallees(repo.id, createUser);
    expect(result.nodes.map((match) => match.node.id)).toEqual([validateUser]);
  });
});

describe('bounded traversals', () => {
  it('walks downstream dependencies to the configured depth', async () => {
    const one = depthById(await store.getDependencies(repo.id, createUser, { maxDepth: 1 }));
    const two = depthById(await store.getDependencies(repo.id, createUser, { maxDepth: 2 }));

    expect([...one.keys()]).toEqual([validateUser]);
    expect(one.get(validateUser)).toBe(1);
    expect(two.get(validateUser)).toBe(1);
    expect(two.get(saveUser)).toBe(2);
    expect(two.size).toBe(2);
  });

  it('walks upstream dependents to the configured depth', async () => {
    const one = depthById(await store.getDependents(repo.id, validateUser, { maxDepth: 1 }));
    const two = depthById(await store.getDependents(repo.id, validateUser, { maxDepth: 2 }));

    expect([...one.keys()]).toEqual([createUser]);
    expect(two.get(createUser)).toBe(1);
    expect(two.get('src/controller.ts::register')).toBe(2);
    expect(two.get('src/admin.ts::seedUsers')).toBe(2);
    expect(two.size).toBe(3);
  });

  it('respects maxDepth (a larger depth returns a superset)', async () => {
    const shallow = await store.getDependencies(repo.id, createUser, { maxDepth: 1 });
    const deep = await store.getDependencies(repo.id, createUser, { maxDepth: 2 });

    expect(deep.nodes.length).toBeGreaterThan(shallow.nodes.length);
  });

  it('deduplicates nodes reachable by multiple paths', async () => {
    const result = await store.getDependencies(diamondRepo.id, 'src/graph-fixture.ts::a', {
      maxDepth: 3,
    });
    const names = result.nodes.map((match) => match.node.name);

    expect(names.filter((name) => name === 'd')).toHaveLength(1);
    expect(names.filter((name) => name === 'b')).toHaveLength(1);
    expect(names.filter((name) => name === 'c')).toHaveLength(1);

    const depths = depthById(result);
    expect(depths.get('src/graph-fixture.ts::d')).toBe(2);
  });

  it('returns an empty result for an unknown node', async () => {
    const result = await store.getDependencies(repo.id, 'src/service.ts::ghost');
    expect(result.nodes).toEqual([]);
  });

  it('rejects an out-of-range depth', async () => {
    await expect(store.getDependencies(repo.id, createUser, { maxDepth: 99 })).rejects.toThrow(
      /maxDepth/,
    );
  });
});

describe('path search', () => {
  it('finds the dependency path between two symbols', async () => {
    const result = await store.findPaths(repo.id, 'src/controller.ts::register', saveUser);

    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path?.nodes.map((node) => node.id)).toEqual([
      'src/controller.ts::register',
      createUser,
      validateUser,
      saveUser,
    ]);
    expect(path?.edges.map((edge) => edge.type)).toEqual(['CALLS', 'CALLS', 'CALLS']);
    expect(path?.edges.map((edge) => edge.from)).toEqual([
      'src/controller.ts::register',
      createUser,
      validateUser,
    ]);
  });

  it('returns no paths when the symbols are unconnected', async () => {
    const result = await store.findPaths(repo.id, validateUser, 'src/controller.ts::register');
    expect(result.paths).toEqual([]);
  });
});

describe('deterministic results', () => {
  it('returns identical output across repeated calls', async () => {
    const callersA = await store.getCallers(repo.id, createUser);
    const callersB = await store.getCallers(repo.id, createUser);
    expect(callersA).toEqual(callersB);

    const dependentsA = await store.getDependents(repo.id, validateUser, { maxDepth: 2 });
    const dependentsB = await store.getDependents(repo.id, validateUser, { maxDepth: 2 });
    expect(dependentsA).toEqual(dependentsB);

    const pathsA = await store.findPaths(repo.id, 'src/controller.ts::register', saveUser);
    const pathsB = await store.findPaths(repo.id, 'src/controller.ts::register', saveUser);
    expect(pathsA).toEqual(pathsB);
  });
});
