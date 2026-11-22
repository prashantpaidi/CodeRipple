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
  return runCommand(process.execPath, ['--import', 'tsx', cli, ...args], repoRoot, env);
}

export function runCommand(command: string, args: readonly string[], cwd: string, env = process.env, input?: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-command-test-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  const descriptors: number[] = [];
  try {
    // Use regular files for subprocess streams, including in restricted sandboxes.
    let stdin: number | 'ignore' = 'ignore';
    if (input !== undefined) {
      const stdinPath = path.join(directory, 'stdin');
      fs.writeFileSync(stdinPath, input);
      stdin = fs.openSync(stdinPath, 'r');
      descriptors.push(stdin);
    }
    const stdout = fs.openSync(stdoutPath, 'w');
    descriptors.push(stdout);
    const stderr = fs.openSync(stderrPath, 'w');
    descriptors.push(stderr);
    const result = spawnSync(command, args, {
      cwd, env, stdio: [stdin, stdout, stderr], timeout: 120_000,
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
