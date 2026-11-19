import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeRepository } from '../src/cli/analyze.js';
import type { CodeGraph } from '../src/graph/graph-types.js';

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

export const fixturesDir = path.join(repoRoot, 'fixtures');

export function runCli(args: readonly string[], env = process.env): { status: number; stdout: string; stderr: string } {
  const cli = path.join(repoRoot, 'src', 'cli', 'index.ts');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-cli-test-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  const descriptors: number[] = [];
  try {
    // Capture Node's output through regular files, including in restricted sandboxes.
    descriptors.push(fs.openSync(stdoutPath, 'w'));
    descriptors.push(fs.openSync(stderrPath, 'w'));
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
      cwd: repoRoot, env, stdio: ['ignore', ...descriptors], timeout: 120_000,
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
