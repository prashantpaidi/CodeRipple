import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeRepository, serializeGraph } from '../src/cli/analyze.js';
import { codeGraphSchema, validateCodeGraph } from '../src/graph/graph-schema.js';
import { analyzeFixture, fixture, repoRoot } from './helpers.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  let dir = tempDirs.pop();
  while (dir !== undefined) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = tempDirs.pop();
  }
});

describe('graph construction', () => {
  it('uses deterministic, path-based node IDs', () => {
    const ids = analyzeFixture('basic-project').nodes.map((node) => node.id);

    expect(ids).toContain('src/user.ts::UserRepository.findByEmail');
    expect(ids).toContain('src/index.ts::bootstrap');
    for (const id of ids) {
      expect(id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(id.startsWith('node_')).toBe(false);
    }

    const again = analyzeRepository(fixture('basic-project')).graph;
    expect(again.nodes.map((node) => node.id)).toEqual(ids);
  });

  it('produces byte-identical output across runs', () => {
    const first = serializeGraph(analyzeRepository(fixture('basic-project')).graph);
    const second = serializeGraph(analyzeRepository(fixture('basic-project')).graph);

    expect(first).toBe(second);
  });

  it('sorts nodes, edges, and unresolved references deterministically', () => {
    const graph = analyzeFixture('basic-project');

    const nodeIds = graph.nodes.map((node) => node.id);
    expect(nodeIds).toEqual([...nodeIds].sort());

    const edgeIds = graph.edges.map((edge) => edge.id);
    expect(edgeIds).toEqual([...edgeIds].sort());

    const callers = graph.unresolvedReferences.map((reference) => reference.caller);
    expect(callers).toEqual([...callers].sort());
  });

  it('keeps metadata consistent with the graph contents', () => {
    const graph = analyzeFixture('basic-project');
    const count = (type: string) =>
      graph.nodes.filter((node) => node.type === type).length;

    expect(graph.metadata.filesAnalyzed).toBe(count('FILE'));
    expect(graph.metadata.classes).toBe(count('CLASS'));
    expect(graph.metadata.functions).toBe(count('FUNCTION'));
    expect(graph.metadata.methods).toBe(count('METHOD'));
    expect(graph.metadata.resolvedCalls).toBe(
      graph.edges.filter((edge) => edge.type === 'CALLS').length,
    );
    expect(graph.metadata.unresolvedCalls).toBe(graph.unresolvedReferences.length);
  });
});

describe('graph validation', () => {
  it('produces a graph that passes Zod validation', () => {
    const result = codeGraphSchema.safeParse(analyzeFixture('calls-project'));
    expect(result.success).toBe(true);
  });

  it('rejects a malformed graph', () => {
    const result = codeGraphSchema.safeParse({
      version: '2',
      repository: { name: 'broken' },
      nodes: [],
      edges: [],
      unresolvedReferences: [],
      metadata: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('analyze output', () => {
  it('writes the graph JSON to the requested --output path', () => {
    const outputPath = path.join(makeTempDir(), 'coderipple.json');
    const result = analyzeRepository(fixture('basic-project'), { output: outputPath });

    expect(result.outputPath).toBe(outputPath);
    const written: unknown = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(written).toEqual(result.graph);
  });

  it('runs end to end through the CLI and writes the same graph', () => {
    const outputPath = path.join(makeTempDir(), 'cli.json');
    const cliPath = path.join(repoRoot, 'src', 'cli', 'index.ts');

    // Launch through the Node binary with the tsx loader rather than a `.bin`
    // shim, which is portable across platforms.
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', cliPath, 'analyze', fixture('basic-project'), '--output', outputPath],
      { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 },
    );

    expect(stdout).toContain('CodeRipple');
    expect(stdout).toContain('Files analyzed');

    const written = validateCodeGraph(
      JSON.parse(fs.readFileSync(outputPath, 'utf8')) as unknown,
    );
    expect(written).toEqual(analyzeRepository(fixture('basic-project')).graph);
  });
});
