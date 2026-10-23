import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixture, repoRoot } from './helpers.js';

const CLI_PATH = path.join(repoRoot, 'src', 'cli', 'index.ts');

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[]): CliRun {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', CLI_PATH, ...args],
      { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

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
