import type { Driver } from 'neo4j-driver';

import { createNeo4jDriver } from '../../src/storage/neo4j/neo4j-client.js';
import { type Neo4jConfig, loadNeo4jConfig } from '../../src/storage/neo4j/neo4j-config.js';
import { createNeo4jGraphStore } from '../../src/storage/neo4j/neo4j-graph-store.js';
import type { Neo4jGraphStore } from '../../src/storage/neo4j/neo4j-graph-store.js';
import type { RepositoryIdentity } from '../../src/storage/repository-identity.js';

/**
 * Shared helpers for the Neo4j integration tests.
 *
 * A single container is started by `tests/integration/global-setup.ts`; these
 * helpers connect to it, wait for it to become ready, and expose small raw
 * queries used to assert on persisted counts.
 */

/** Build an isolated repository identity for a test. */
export function testRepository(suffix: string, name = suffix): RepositoryIdentity {
  return { id: `repo_it_${suffix}`, name, rootPath: `/tmp/${suffix}`, source: 'override' };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Poll until the database accepts connections (the container may still be warming up). */
export async function waitForDatabase(config: Neo4jConfig, timeoutMs = 120_000): Promise<void> {
  const driver = createNeo4jDriver(config);
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      try {
        await driver.verifyConnectivity();
        return;
      } catch (error) {
        if (Date.now() >= deadline) {
          throw error;
        }
        await delay(1000);
      }
    }
  } finally {
    await driver.close();
  }
}

/** Create a schema-initialized store connected to the shared container. */
export async function createTestStore(): Promise<Neo4jGraphStore> {
  const config = loadNeo4jConfig();
  await waitForDatabase(config);
  return createNeo4jGraphStore(config);
}

/** Run a callback with a throwaway driver (for assertions the store API does not expose). */
export async function withDriver<T>(work: (driver: Driver) => Promise<T>): Promise<T> {
  const driver = createNeo4jDriver(loadNeo4jConfig());
  try {
    return await work(driver);
  } finally {
    await driver.close();
  }
}

async function scalar(
  driver: Driver,
  cypher: string,
  params: Record<string, unknown>,
): Promise<number> {
  const session = driver.session({ database: process.env.NEO4J_DATABASE ?? 'neo4j' });
  try {
    const result = await session.run(cypher, params);
    const value = result.records[0]?.get('value');
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Expected a numeric result from "${cypher}"`);
    }
    return numeric;
  } finally {
    await session.close();
  }
}

export async function countCodeEntities(driver: Driver, repositoryId: string): Promise<number> {
  return scalar(
    driver,
    'MATCH (n:CodeEntity {repositoryId: $repositoryId}) RETURN count(n) AS value',
    { repositoryId },
  );
}

export async function countCodeRelationships(
  driver: Driver,
  repositoryId: string,
): Promise<number> {
  return scalar(
    driver,
    'MATCH (:CodeEntity {repositoryId: $repositoryId})-[r]->(:CodeEntity) RETURN count(r) AS value',
    { repositoryId },
  );
}

export async function countBelongsTo(driver: Driver, repositoryId: string): Promise<number> {
  return scalar(
    driver,
    'MATCH (:CodeEntity {repositoryId: $repositoryId})-[r:BELONGS_TO]->(:Repository) RETURN count(r) AS value',
    { repositoryId },
  );
}

export async function countRepositories(driver: Driver, repositoryId: string): Promise<number> {
  return scalar(driver, 'MATCH (r:Repository {id: $repositoryId}) RETURN count(r) AS value', {
    repositoryId,
  });
}

/** Run a scalar `... RETURN <n> AS value` query (for assertions the store hides). */
export async function countQuery(
  driver: Driver,
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<number> {
  return scalar(driver, cypher, params);
}

/**
 * Execute a write directly against Neo4j.
 *
 * Used by tests to create states the store itself would never produce, such as
 * a relationship that crosses repository boundaries.
 */
export async function executeWrite(
  driver: Driver,
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  const session = driver.session({ database: process.env.NEO4J_DATABASE ?? 'neo4j' });
  try {
    await session.executeWrite((transaction) => transaction.run(cypher, params));
  } finally {
    await session.close();
  }
}
