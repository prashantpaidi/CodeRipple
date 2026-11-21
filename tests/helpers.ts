import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeRepository } from '../src/cli/analyze.js';
import type { CodeGraph } from '../src/graph/graph-types.js';

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

export const fixturesDir = path.join(repoRoot, 'fixtures');

export function runCli(args: readonly string[], env = process.env, input?: string): { status: number; stdout: string; stderr: string } {
  const cli = path.join(repoRoot, 'src', 'cli', 'index.ts');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-cli-test-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  const descriptors: number[] = [];
  try {
    // Capture Node's output through regular files, including in restricted sandboxes.
    descriptors.push(fs.openSync(stdoutPath, 'w'));
    descriptors.push(fs.openSync(stderrPath, 'w'));
    let stdin: number | 'ignore' = 'ignore';
    if (input !== undefined) {
      const inputPath = path.join(directory, 'stdin');
      fs.writeFileSync(inputPath, input);
      stdin = fs.openSync(inputPath, 'r');
    }
    const stdio = [stdin, ...descriptors];
    if (stdin !== 'ignore') descriptors.push(stdin);
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
      cwd: repoRoot, env, stdio, timeout: 120_000,
    });
    if (result.error) throw result.error;
    return {
      status: result.status ?? 1,
      stdout: fs.readFileSync(stdoutPath, 'utf8'),
      stderr: fs.readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

interface TestRepository {
  path: string;
  write: (file: string, text: string) => void;
  commit: (message: string) => string;
}

/** Run a test with real Git commits independent of the checkout and user config. */
export async function withGitRepository(test: (repository: TestRepository) => unknown, fixtureName?: string): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-test-repo-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'CodeRipple Test', GIT_AUTHOR_EMAIL: 'test@coderipple.dev',
      GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'CodeRipple Test', GIT_COMMITTER_EMAIL: 'test@coderipple.dev',
      GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z',
    },
  }).trim();
  try {
    git('init', '-qb', 'main', '--template=');
    if (fixtureName) fs.cpSync(fixture(fixtureName), directory, { recursive: true });
    await test({
      path: directory,
      write(file, text) {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
      },
      commit(message) {
        git('add', '-A');
        git('commit', '-qm', message);
        return git('rev-parse', 'HEAD');
      },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** Absolute path to a fixture repository. */
export function fixture(name: string): string {
  return path.join(fixturesDir, name);
}

const cache = new Map<string, CodeGraph>();

/** Analyze a fixture once and memoize the resulting graph for the test run. */
export function analyzeFixture(name: string): CodeGraph {
  const cached = cache.get(name);
  if (cached) {
    return cached;
  }
  const graph = analyzeRepository(fixture(name)).graph;
  cache.set(name, graph);
  return graph;
}

/** Find a node by ID, failing loudly when it is absent. */
export function nodeById(graph: CodeGraph, id: string) {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Expected a node with id "${id}"`);
  }
  return node;
}

/** All edge IDs of a given type, sorted. */
export function edgeIdsOfType(graph: CodeGraph, type: CodeGraph['edges'][number]['type']): string[] {
  return graph.edges
    .filter((edge) => edge.type === type)
    .map((edge) => edge.id)
    .sort();
}
