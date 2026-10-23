import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RepositoryIdentity } from '../../../src/storage/repository-identity.js';
import type { Neo4jGraphStore } from '../../../src/storage/neo4j/neo4j-graph-store.js';
import { syntheticGraph } from '../../synthetic-graph.js';
import { createTestStore, testRepository } from '../support.js';

let store: Neo4jGraphStore;

beforeAll(async () => {
  store = await createTestStore();
});

afterAll(async () => {
  await store?.close();
});

describe('repository ID reuse', () => {
  it('replaces the previous graph when the same repository is re-indexed', async () => {
    const repo = testRepository('reuse_same', 'reuse-same');

    await store.saveGraph(syntheticGraph(['keep', 'stale'], [['keep', 'stale']]), repo);
    expect(await store.getNode(repo.id, 'src/graph-fixture.ts::stale')).not.toBeNull();

    // Same ID, same path: this is an ordinary re-index and must replace.
    await store.saveGraph(syntheticGraph(['keep'], []), repo);

    expect(await store.getNode(repo.id, 'src/graph-fixture.ts::stale')).toBeNull();
    expect(await store.getNode(repo.id, 'src/graph-fixture.ts::keep')).not.toBeNull();
  });

  it('refuses to silently replace a different path that reuses an explicit ID', async () => {
    const first: RepositoryIdentity = {
      id: 'repo_it_reuse_guard',
      name: 'guard-a',
      rootPath: '/tmp/guard-a',
      source: 'override',
    };
    await store.saveGraph(syntheticGraph(['a'], []), first);

    const second: RepositoryIdentity = {
      id: 'repo_it_reuse_guard',
      name: 'guard-b',
      rootPath: '/tmp/guard-b',
      source: 'override',
    };

    await expect(store.saveGraph(syntheticGraph(['x'], []), second)).rejects.toThrow(
      /already used by a repository/,
    );

    // The first repository's graph is untouched...
    expect(await store.getNode(first.id, 'src/graph-fixture.ts::a')).not.toBeNull();
    expect(await store.getNode(first.id, 'src/graph-fixture.ts::x')).toBeNull();

    // ...until replacement is explicitly requested.
    await store.saveGraph(syntheticGraph(['x'], []), second, { replaceExisting: true });

    expect(await store.getNode(second.id, 'src/graph-fixture.ts::a')).toBeNull();
    expect(await store.getNode(second.id, 'src/graph-fixture.ts::x')).not.toBeNull();
  });

  it('does not guard derived identities (never treated as suspicious reuse)', async () => {
    // Derived IDs are a function of the path/remote, so a path change (e.g. a
    // git clone at a different location) is not "reuse" and must not be blocked.
    const derived: RepositoryIdentity = {
      id: 'repo_it_derived',
      name: 'derived',
      rootPath: '/tmp/derived',
      source: 'path',
    };
    await store.saveGraph(syntheticGraph(['a'], []), derived);

    const elsewhere: RepositoryIdentity = { ...derived, rootPath: '/tmp/derived-elsewhere' };

    await expect(
      store.saveGraph(syntheticGraph(['b'], []), elsewhere),
    ).resolves.toBeUndefined();
    expect(await store.getNode(elsewhere.id, 'src/graph-fixture.ts::b')).not.toBeNull();
  });
});
