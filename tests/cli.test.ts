import { describe, expect, it } from 'vitest';

import { fixture, repoRoot, runCli } from './helpers.js';

describe('CLI argument handling', () => {
  it('prints usage when no command is given', () => {
    const result = runCli([]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Usage:');
  });

  it('fails when the repository path is missing', () => {
    const result = runCli(['analyze']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing required <repository-path>');
  });

  it('does not consume another option as the output value', () => {
    const result = runCli(['analyze', fixture('basic-project'), '--output', '--no-gitignore']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing value for --output');
  });

  it('rejects an empty output path instead of silently doing nothing', () => {
    const result = runCli(['analyze', fixture('basic-project'), '--output', '']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Output path must not be empty');
  });

  it('reports an informative error for an unknown command', () => {
    const result = runCli(['inspect']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown command');
  });
});

describe('CLI diff command argument handling', () => {
  it('requires a repository path', () => {
    const result = runCli(['diff']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing required <repository-path>');
  });

  it('requires --base and --head', () => {
    const missingBase = runCli(['diff', '.']);
    expect(missingBase.status).toBe(1);
    expect(missingBase.stderr).toContain('Missing required --base <ref>');

    const missingHead = runCli(['diff', '.', '--base', 'main']);
    expect(missingHead.status).toBe(1);
    expect(missingHead.stderr).toContain('Missing required --head <ref>');
  });

  it('documents the diff options in help output', () => {
    const result = runCli(['diff', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Diff options:');
    expect(result.stdout).toContain('--base <ref>');
  });
});

describe('CLI impact command', () => {
  it('returns usage errors for invalid options', () => {
    expect(runCli(['impact', '.', '--base', 'HEAD', '--head', 'HEAD', '--format', 'xml']).status).toBe(1);
    expect(runCli(['impact', '.', '--base', 'HEAD', '--head', 'HEAD', '--depth', '-1']).status).toBe(1);
  });
  it('returns stable complete JSON and successful exit for equal revisions', () => {
    const args = ['impact', fixture('basic-project'), '--base', 'HEAD', '--head', 'HEAD', '--format', 'json'];
    const first = runCli(args);
    const second = runCli(args);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(JSON.parse(first.stdout)).toMatchObject({ schemaVersion: '1', changedSymbols: [], impactPaths: [], risk: { category: 'LOW', indicators: { dependentCount: 0 } } });
  }, 120_000);
  it('returns a helpful error for invalid revisions', () => {
    const result = runCli(['impact', repoRoot, '--base', 'no-such-revision-coderipple', '--head', 'HEAD']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Impact analysis failed');
  });
  it('keeps the canonical JSON report and succeeds when an opted-in provider has no key', () => {
    const args = ['impact', fixture('basic-project'), '--base', 'HEAD', '--head', 'HEAD', '--format', 'json'];
    const env = { ...process.env, OPENAI_API_KEY: '', CODERIPPLE_OPENAI_MODEL: 'mock-model' };
    const plain = runCli(args, env);
    const optedIn = runCli([...args, '--explain', '--explain-exclude', 'private/'], env);
    expect(plain.status).toBe(0);
    expect(optedIn.status).toBe(0);
    expect(JSON.parse(optedIn.stdout)).toEqual({
      report: JSON.parse(plain.stdout),
      explanation: { status: 'unavailable', reason: 'provider-not-configured' },
    });
  }, 120_000);
});
