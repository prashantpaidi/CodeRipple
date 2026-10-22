import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/**
 * Vitest global setup: start one Neo4j container for the whole integration run
 * and export its connection details as environment variables for the test
 * processes. The container is stopped in `teardown`.
 */

const BOLT_PORT = 7687;
const PASSWORD = 'coderipple-test-password';

let container: StartedTestContainer | undefined;

export async function setup(): Promise<void> {
  container = await new GenericContainer('neo4j:5-community')
    .withEnvironment({
      NEO4J_AUTH: `neo4j/${PASSWORD}`,
      NEO4J_server_memory_heap_max__size: '512m',
      NEO4J_server_memory_pagecache_size: '256m',
    })
    .withExposedPorts(BOLT_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(240_000)
    .start();

  process.env.NEO4J_URI = `bolt://${container.getHost()}:${container.getMappedPort(BOLT_PORT)}`;
  process.env.NEO4J_USERNAME = 'neo4j';
  process.env.NEO4J_PASSWORD = PASSWORD;
  process.env.NEO4J_DATABASE = 'neo4j';
}

export async function teardown(): Promise<void> {
  await container?.stop();
  container = undefined;
}
