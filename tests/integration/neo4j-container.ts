import { GenericContainer, Wait } from 'testcontainers';

export const neo4jImage = 'neo4j:5.26.33-community';
const boltPort = 7687;

/** Start an isolated database and return the connection environment for child processes. */
export async function startNeo4jContainer() {
  const password = 'coderipple-test-password';
  const container = await new GenericContainer(neo4jImage)
    .withEnvironment({
      NEO4J_AUTH: `neo4j/${password}`,
      NEO4J_server_memory_heap_max__size: '512m',
      NEO4J_server_memory_pagecache_size: '256m',
    })
    .withResourcesQuota({ memory: 1.5, cpu: 2 })
    .withExposedPorts(boltPort)
    .withWaitStrategy(Wait.forAll([Wait.forListeningPorts(), Wait.forLogMessage(/Started\./)]))
    .withStartupTimeout(240_000)
    .start();

  return {
    container,
    env: {
      NEO4J_URI: `bolt://${container.getHost()}:${container.getMappedPort(boltPort)}`,
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: password,
      NEO4J_DATABASE: 'neo4j',
    },
  };
}
