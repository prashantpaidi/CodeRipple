import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../src/storage/errors.js';
import { loadNeo4jConfig } from '../src/storage/neo4j/neo4j-config.js';

describe('loadNeo4jConfig', () => {
  it('names the missing required variables', () => {
    let thrown: unknown;
    try {
      loadNeo4jConfig({});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    const message = thrown instanceof Error ? thrown.message : '';
    expect(message).toContain('NEO4J_URI');
    expect(message).toContain('NEO4J_PASSWORD');
  });

  it('applies default username and database', () => {
    const config = loadNeo4jConfig({
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_PASSWORD: 'secret',
    });

    expect(config).toEqual({
      uri: 'bolt://localhost:7687',
      username: 'neo4j',
      password: 'secret',
      database: 'neo4j',
    });
  });

  it('respects explicit username and database values', () => {
    const config = loadNeo4jConfig({
      NEO4J_URI: 'neo4j+s://example.databases.neo4j.io',
      NEO4J_USERNAME: 'admin',
      NEO4J_PASSWORD: 'secret',
      NEO4J_DATABASE: 'coderipple',
    });

    expect(config.username).toBe('admin');
    expect(config.database).toBe('coderipple');
  });

  it('rejects a URI that is not a bolt/neo4j scheme', () => {
    expect(() =>
      loadNeo4jConfig({ NEO4J_URI: 'http://localhost:7687', NEO4J_PASSWORD: 'secret' }),
    ).toThrow(ConfigurationError);
  });
});
