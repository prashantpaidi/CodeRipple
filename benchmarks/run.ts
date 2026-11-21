import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { analyzeRepository } from '../src/cli/analyze.js';
import { loadRepositoryConfig } from '../src/config/repository-config.js';
import { GitCliDiffProvider } from '../src/git/git-diff-provider.js';
import { createRevisionSourceReader } from '../src/git/git-runner.js';
import { buildRevisionGraphs, withRevisionWorkspaces } from '../src/git/revision-graph.js';
import { buildGraph } from '../src/graph/graph-builder.js';
import { mapChangedSymbols } from '../src/impact/changed-symbol-mapper.js';
import { analyzeImpact, analyzeImpactGraphs } from '../src/impact/impact-analysis.js';
import { parseRepository } from '../src/parser/file-parser.js';
import { discoverSourceFiles } from '../src/parser/repository-parser.js';
import { retrieveEvidence } from '../src/retrieval/evidence.js';
import { createNeo4jGraphStore } from '../src/storage/neo4j/neo4j-graph-store.js';
import { neo4jImage, startNeo4jContainer } from '../tests/integration/neo4j-container.js';

const depth = 3;
const target = 'src/module0000.ts::fn0000';
const execFileAsync = promisify(execFile);

function numberOption(value: string, minimum: number, maximum: number): number {
  const numeric = Number(value);
  if (!/^\d+$/.test(value) || numeric < minimum || numeric > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}, got ${value}`);
  }
  return numeric;
}

function makeRepository(directory: string, size: number): { base: string; head: string } {
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'CodeRipple Benchmark',
      GIT_AUTHOR_EMAIL: 'benchmark@coderipple.dev',
      GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'CodeRipple Benchmark',
      GIT_COMMITTER_EMAIL: 'benchmark@coderipple.dev',
      GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z',
    },
  }).trim();
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-qb', 'main', '--template=', '--object-format=sha1');
  fs.mkdirSync(path.join(directory, 'src'));
  const moduleId = (index: number) => String(index).padStart(4, '0');
  function writeModule(index: number, value: number): void {
    const id = moduleId(index);
    const previous = moduleId(index - 1);
    fs.writeFileSync(path.join(directory, 'src', `module${id}.ts`), index === 0
      ? `export function fn${id}(): number { return ${value}; }\n`
      : `import { fn${previous} } from './module${previous}.js';\nexport function fn${id}(): number { return fn${previous}() + ${value}; }\n`);
  }
  for (let i = 0; i < size; i++) writeModule(i, 1);
  const base = commit('baseline');
  const count = Math.min(size, 12);
  for (let i = 0; i < count; i++) writeModule(Math.floor(i * size / count), 2);
  return { base, head: commit('change function bodies') };
}

function distribution(samples: number[]) {
  const ordered = samples.slice().sort((a, b) => a - b);
  function percentile(p: number): number {
    const value = ordered[Math.ceil(ordered.length * p) - 1];
    assert(value !== undefined);
    return Number(value.toFixed(3));
  }
  return {
    samples: ordered.length,
    p50: percentile(0.5),
    ...(ordered.length >= 20 && { p95: percentile(0.95) }),
    ...(ordered.length >= 100 && { p99: percentile(0.99) }),
  };
}

async function measure(samples: number, work: () => unknown): Promise<ReturnType<typeof distribution>> {
  await work(); // Warm up once before sampling.
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await work();
    timings.push(performance.now() - start);
  }
  return distribution(timings);
}

async function run(size: number, runs: number, queries: number, useDatabase: boolean) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-benchmark-'));
  try {
    const { base, head } = makeRepository(directory, size);
    const config = loadRepositoryConfig(directory);
    const parsed = parseRepository(config, discoverSourceFiles(config));
    const repository = { id: `benchmark-${size}`, name: 'benchmark', rootPath: directory, source: 'override' as const };
    const graphs = await buildRevisionGraphs(directory, base, head);
    const files = await new GitCliDiffProvider().diff(directory, base, head);
    const changedSymbols = mapChangedSymbols(files, graphs.baseGraph, graphs.headGraph);
    const graphInput = { repository, baseSha: base, headSha: head, ...graphs, changedSymbols, depth };
    const readSource = await createRevisionSourceReader(directory);
    assert.equal(graphs.headGraph.metadata.filesAnalyzed, size);
    assert.equal(graphs.headGraph.metadata.resolvedCalls, size - 1);
    assert.equal(changedSymbols.length, Math.min(size, 12));
    const retrievalSourceReads = { base: 0, head: 0 };
    const retrieve = async () => {
      retrievalSourceReads.base = 0;
      retrievalSourceReads.head = 0;
      const result = await retrieveEvidence({
        ...graphInput,
        readSource(sha, file) {
          retrievalSourceReads[sha === base ? 'base' : 'head']++;
          return readSource(sha, file);
        },
      }, 'What depends on fn0000?');
      assert.equal(result.evidence[0]?.node.id, target);
    };
    const milliseconds = {
      analysis: await measure(runs, () => analyzeRepository(directory)),
      revisionExtraction: await measure(runs, () => withRevisionWorkspaces(directory, base, head, ({ base, head }) => assert(base && head))),
      graphBuild: await measure(runs, () => buildGraph(config, parsed)),
      impactEngine: await measure(runs, () => analyzeImpactGraphs(graphInput)),
      impactReport: await measure(runs, () => analyzeImpact(directory, { base, head, depth })),
      retrieval: await measure(runs, retrieve),
    };
    const neo4j = useDatabase ? await measureDatabase() : null;
    return {
      files: size, nodes: graphs.headGraph.nodes.length, edges: graphs.headGraph.edges.length,
      base, head, milliseconds, retrievalSourceReads, neo4j, peakNodeRssKiB: process.resourceUsage().maxRSS,
    };

    async function measureDatabase() {
      const store = await createNeo4jGraphStore();
      try {
        const indexing = await measure(runs, () => store.saveGraph(graphs.headGraph, repository));
        assert.equal((await store.getNode(repository.id, target))?.id, target);
        assert.equal((await store.getDependents(repository.id, target, { maxDepth: depth })).nodes.length, Math.min(depth, size - 1));
        return {
          indexing,
          nodeLookup: await measure(queries, () => store.getNode(repository.id, target)),
          dependents: await measure(queries, () => store.getDependents(repository.id, target, { maxDepth: depth })),
        };
      } finally {
        await store.close();
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const { values } = parseArgs({ options: {
  sizes: { type: 'string', default: '12,96,384' },
  runs: { type: 'string', default: '7' },
  queries: { type: 'string', default: '200' },
  neo4j: { type: 'boolean', default: false },
  worker: { type: 'string' },
} });
const sizes = values.sizes.split(',').map((value) => numberOption(value, 2, 3000));
const runs = numberOption(values.runs, 1, 1000);
const queries = numberOption(values.queries, 1, 10000);

if (values.worker) {
  assert.equal(sizes.length, 1);
  const [size] = sizes;
  assert(size !== undefined);
  fs.writeFileSync(values.worker, JSON.stringify(await run(size, runs, queries, values.neo4j)));
} else {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-benchmark-results-'));
  let database: Awaited<ReturnType<typeof startNeo4jContainer>> | undefined;
  try {
    database = values.neo4j ? await startNeo4jContainer() : undefined;
    const results = [];
    for (const size of sizes) {
      if (sizes.length === 1 && !database) {
        results.push(await run(size, runs, queries, false));
        continue;
      }
      const output = path.join(workspace, `sample-${results.length}.json`);
      const args = ['--import', 'tsx', fileURLToPath(import.meta.url), `--worker=${output}`,
        `--sizes=${size}`, `--runs=${runs}`, `--queries=${queries}`];
      if (database) args.push('--neo4j');
      await execFileAsync(process.execPath, args, {
        encoding: 'utf8',
        env: { ...process.env, ...database?.env },
        timeout: 300_000,
      });
      results.push(JSON.parse(fs.readFileSync(output, 'utf8')));
    }
    console.log(JSON.stringify({
      environment: {
        platform: process.platform, arch: process.arch, kernel: os.release(), cpu: os.cpus()[0]?.model,
        logicalCpus: os.availableParallelism(), node: process.version,
        git: execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
        neo4jImage: database ? neo4jImage : null,
      },
      runs, queries, results,
    }, null, 2));
  } finally {
    try {
      await database?.container.stop();
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
}
