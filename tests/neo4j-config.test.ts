import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../src/storage/errors.js';
import { loadEnvFileIfPresent, loadNeo4jConfig } from '../src/storage/neo4j/neo4j-config.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-env-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  let dir = tempDirs.pop();
  while (dir !== undefined) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = tempDirs.pop();
  }
  delete process.env.CODERIPPLE_ENV_TEST;
});

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

describe('loadEnvFileIfPresent', () => {
  it('does nothing when the file is absent', () => {
    expect(() => loadEnvFileIfPresent(path.join(makeTempDir(), 'missing.env'))).not.toThrow();
  });

  it('loads a valid environment file', () => {
    const filePath = path.join(makeTempDir(), '.env');
    fs.writeFileSync(filePath, '# comment\nCODERIPPLE_ENV_TEST=loaded\n');

    loadEnvFileIfPresent(filePath);

    expect(process.env.CODERIPPLE_ENV_TEST).toBe('loaded');
  });

  it('rejects a malformed environment file instead of silently ignoring it', () => {
    const filePath = path.join(makeTempDir(), '.env');
    fs.writeFileSync(filePath, 'GOOD=1\nthis is not valid\nALSO_GOOD=2\n');

    expect(() => loadEnvFileIfPresent(filePath)).toThrow(ConfigurationError);
    expect(() => loadEnvFileIfPresent(filePath)).toThrow(/line\(s\) 2/);
  });
});
