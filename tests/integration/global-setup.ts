import type { StartedTestContainer } from 'testcontainers';
import { startNeo4jContainer } from './neo4j-container.js';

/**
 * Vitest global setup: start one Neo4j container for the whole integration run
 * and export its connection details as environment variables for the test
 * processes. The container is stopped in `teardown`.
 */

let container: StartedTestContainer | undefined;

export async function setup(): Promise<void> {
  const database = await startNeo4jContainer();
  container = database.container;
  Object.assign(process.env, database.env);
}

export async function teardown(): Promise<void> {
  await container?.stop();
  container = undefined;
}
