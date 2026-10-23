#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { EDGE_TYPES, type EdgeType } from '../graph/graph-types.js';
import { errorMessage } from '../storage/errors.js';
import { createNeo4jGraphStore } from '../storage/neo4j/neo4j-graph-store.js';
import { loadEnvFileIfPresent } from '../storage/neo4j/neo4j-config.js';
import { detectChangedSymbols } from '../impact/detect-changed-symbols.js';
import { analyzeRepository, formatSummary } from './analyze.js';
import { formatDiffReport, formatDiffReportJson } from './diff.js';
import {
  type DependencyQuery,
  formatDependencyResult,
  formatPathResult,
  runDependencyQuery,
} from './graph-commands.js';
import { formatIndexSummary, indexRepository } from './index-repository.js';

const USAGE = `CodeRipple — trace the impact of every code change.

Usage:
  coderipple analyze <repository-path> [options]
  coderipple index <repository-path> [options]
  coderipple graph <callers|callees|dependencies|dependents> <repository-id> <node-id> [options]
  coderipple graph paths <repository-id> <from-node-id> <to-node-id> [options]
  coderipple diff <repository-path> --base <ref> --head <ref> [options]

Analyze options:
  -o, --output <file>   Write the code graph JSON to <file>.
      --no-gitignore    Do not honor the repository root .gitignore.

Index options:
      --repository-id <id>  Pin the repository identity (default: derived from
                            the git origin remote, else the absolute path).
      --force               Replace a graph already stored under the given
                            --repository-id from a different path.
      --no-gitignore        Do not honor the repository root .gitignore.

Graph options:
      --depth <n>           Maximum hops for dependencies/dependents/paths.
      --max-paths <n>       Maximum paths to return (paths query only).
      --relationships <a,b> Relationship types to traverse (default: CALLS).

Diff options:
      --base <ref>          Base revision to compare from (required).
      --head <ref>          Head revision to compare to (required).
      --json                Emit deterministic JSON instead of text.

  -h, --help            Show this help.

Examples:
  coderipple analyze ./fixtures/basic-project
  coderipple index ./fixtures/basic-project
  coderipple graph callers repo_ab12cd34ef56ab78 src/controller.ts::register
  coderipple graph dependencies repo_ab12cd34ef56ab78 src/service.ts::createUser --depth 3
  coderipple diff . --base main --head HEAD`;

class UsageError extends Error {}

const EDGE_TYPE_SET = new Set<string>(EDGE_TYPES);

function isEdgeType(value: string): value is EdgeType {
  return EDGE_TYPE_SET.has(value);
}

const DEPENDENCY_QUERIES: readonly DependencyQuery[] = [
  'callers',
  'callees',
  'dependencies',
  'dependents',
];

function isDependencyQuery(value: string): value is DependencyQuery {
  return (DEPENDENCY_QUERIES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Argument parsing
 * ------------------------------------------------------------------ */

interface AnalyzeArgs {
  repository: string;
  output?: string;
  respectGitignore: boolean;
}

interface IndexArgs {
  repository: string;
  repositoryId?: string;
  force: boolean;
  respectGitignore: boolean;
}

interface GraphArgs {
  repositoryId: string;
  nodeId: string;
  depth?: number;
  relationshipTypes?: readonly EdgeType[];
}

interface PathArgs {
  repositoryId: string;
  from: string;
  to: string;
  depth?: number;
  maxPaths?: number;
  relationshipTypes?: readonly EdgeType[];
}

interface DiffArgs {
  repository: string;
  base: string;
  head: string;
  json: boolean;
}

function nextValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new UsageError(`Missing value for ${option}`);
  }
  return value;
}

function parsePositiveInt(value: string, option: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`Invalid ${option} value: ${value}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1) {
    throw new UsageError(`Invalid ${option} value: ${value}`);
  }
  return parsed;
}

function parseRelationships(value: string): EdgeType[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    throw new UsageError('Missing value for --relationships');
  }
  const types: EdgeType[] = [];
  for (const part of parts) {
    if (!isEdgeType(part)) {
      throw new UsageError(
        `Unknown relationship type: ${part} (expected ${EDGE_TYPES.join(', ')})`,
      );
    }
    types.push(part);
  }
  return types;
}

function parseAnalyzeArgs(args: readonly string[]): AnalyzeArgs {
  let repository: string | undefined;
  let output: string | undefined;
  let respectGitignore = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      output = nextValue(args, index, arg);
      index += 1;
    } else if (arg === '--no-gitignore') {
      respectGitignore = false;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (repository === undefined) {
      repository = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (repository === undefined) {
    throw new UsageError('Missing required <repository-path> argument');
  }

  return output === undefined
    ? { repository, respectGitignore }
    : { repository, output, respectGitignore };
}

function parseIndexArgs(args: readonly string[]): IndexArgs {
  let repository: string | undefined;
  let repositoryId: string | undefined;
  let force = false;
  let respectGitignore = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--repository-id') {
      repositoryId = nextValue(args, index, arg);
      index += 1;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--no-gitignore') {
      respectGitignore = false;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (repository === undefined) {
      repository = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (repository === undefined) {
    throw new UsageError('Missing required <repository-path> argument');
  }

  return {
    repository,
    force,
    respectGitignore,
    ...(repositoryId === undefined ? {} : { repositoryId }),
  };
}

function parseGraphArgs(
  args: readonly string[],
  query: DependencyQuery,
  allowDepth: boolean,
): GraphArgs {
  let repositoryId: string | undefined;
  let nodeId: string | undefined;
  let depth: number | undefined;
  let relationshipTypes: readonly EdgeType[] | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--depth') {
      if (!allowDepth) {
        throw new UsageError(`--depth is not supported for ${query}`);
      }
      depth = parsePositiveInt(nextValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--relationships') {
      relationshipTypes = parseRelationships(nextValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (repositoryId === undefined) {
      repositoryId = arg;
    } else if (nodeId === undefined) {
      nodeId = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (repositoryId === undefined) {
    throw new UsageError('Missing required <repository-id> argument');
  }
  if (nodeId === undefined) {
    throw new UsageError('Missing required <node-id> argument');
  }

  return {
    repositoryId,
    nodeId,
    ...(depth === undefined ? {} : { depth }),
    ...(relationshipTypes === undefined ? {} : { relationshipTypes }),
  };
}

function parsePathArgs(args: readonly string[]): PathArgs {
  let repositoryId: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let depth: number | undefined;
  let maxPaths: number | undefined;
  let relationshipTypes: readonly EdgeType[] | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--depth') {
      depth = parsePositiveInt(nextValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--max-paths') {
      maxPaths = parsePositiveInt(nextValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--relationships') {
      relationshipTypes = parseRelationships(nextValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (repositoryId === undefined) {
      repositoryId = arg;
    } else if (from === undefined) {
      from = arg;
    } else if (to === undefined) {
      to = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (repositoryId === undefined) {
    throw new UsageError('Missing required <repository-id> argument');
  }
  if (from === undefined) {
    throw new UsageError('Missing required <from-node-id> argument');
  }
  if (to === undefined) {
    throw new UsageError('Missing required <to-node-id> argument');
  }

  return {
    repositoryId,
    from,
    to,
    ...(depth === undefined ? {} : { depth }),
    ...(maxPaths === undefined ? {} : { maxPaths }),
    ...(relationshipTypes === undefined ? {} : { relationshipTypes }),
  };
}

function parseDiffArgs(args: readonly string[]): DiffArgs {
  let repository: string | undefined;
  let base: string | undefined;
  let head: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--base') {
      base = nextValue(args, index, arg);
      index += 1;
    } else if (arg === '--head') {
      head = nextValue(args, index, arg);
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (repository === undefined) {
      repository = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (repository === undefined) {
    throw new UsageError('Missing required <repository-path> argument');
  }
  if (base === undefined) {
    throw new UsageError('Missing required --base <ref> option');
  }
  if (head === undefined) {
    throw new UsageError('Missing required --head <ref> option');
  }

  return { repository, base, head, json };
}

/* ------------------------------------------------------------------ *
 * Output helpers
 * ------------------------------------------------------------------ */

function displayPath(absolute: string): string {
  const relative = path.relative(process.cwd(), absolute);
  return relative === '' || relative.startsWith('..') ? absolute : relative;
}

function writeUsage(stream: NodeJS.WriteStream, message?: string): void {
  if (message === undefined) {
    stream.write(`${USAGE}\n`);
  } else {
    stream.write(`${message}\n\n${USAGE}\n`);
  }
}

function wantsHelp(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function parseOrUsage<T>(parse: () => T): T | number {
  try {
    return parse();
  } catch (error) {
    if (error instanceof UsageError) {
      writeUsage(process.stderr, error.message);
      return 1;
    }
    throw error;
  }
}

function runAnalyze(args: readonly string[]): number {
  if (wantsHelp(args)) {
    writeUsage(process.stdout);
    return 0;
  }

  const parsed = parseOrUsage(() => parseAnalyzeArgs(args));
  if (typeof parsed === 'number') {
    return parsed;
  }

  try {
    const result = analyzeRepository(parsed.repository, {
      respectGitignore: parsed.respectGitignore,
      ...(parsed.output === undefined ? {} : { output: parsed.output }),
    });
    process.stdout.write(
      `${formatSummary(result.graph, result.outputPath ? displayPath(result.outputPath) : null)}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`Analysis failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

async function runIndex(args: readonly string[]): Promise<number> {
  if (wantsHelp(args)) {
    writeUsage(process.stdout);
    return 0;
  }

  const parsed = parseOrUsage(() => parseIndexArgs(args));
  if (typeof parsed === 'number') {
    return parsed;
  }

  let store: Awaited<ReturnType<typeof createNeo4jGraphStore>> | undefined;
  try {
    loadEnvFileIfPresent();
    store = await createNeo4jGraphStore();
    const { graph, repository } = await indexRepository(parsed.repository, store, {
      respectGitignore: parsed.respectGitignore,
      force: parsed.force,
      ...(parsed.repositoryId === undefined ? {} : { repositoryId: parsed.repositoryId }),
    });
    process.stdout.write(`${formatIndexSummary(graph, repository)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Indexing failed: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (store !== undefined) {
      await store.close();
    }
  }
}

async function runDependencyQueryCommand(
  query: DependencyQuery,
  args: readonly string[],
): Promise<number> {
  if (wantsHelp(args)) {
    writeUsage(process.stdout);
    return 0;
  }

  const allowDepth = query === 'dependencies' || query === 'dependents';
  const parsed = parseOrUsage(() => parseGraphArgs(args, query, allowDepth));
  if (typeof parsed === 'number') {
    return parsed;
  }

  let store: Awaited<ReturnType<typeof createNeo4jGraphStore>> | undefined;
  try {
    loadEnvFileIfPresent();
    store = await createNeo4jGraphStore();
    const result = await runDependencyQuery(store, query, parsed.repositoryId, parsed.nodeId, {
      ...(parsed.depth === undefined ? {} : { depth: parsed.depth }),
      ...(parsed.relationshipTypes === undefined
        ? {}
        : { relationshipTypes: parsed.relationshipTypes }),
    });
    process.stdout.write(`${formatDependencyResult(result, query)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Graph query failed: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (store !== undefined) {
      await store.close();
    }
  }
}

async function runPathsCommand(args: readonly string[]): Promise<number> {
  if (wantsHelp(args)) {
    writeUsage(process.stdout);
    return 0;
  }

  const parsed = parseOrUsage(() => parsePathArgs(args));
  if (typeof parsed === 'number') {
    return parsed;
  }

  let store: Awaited<ReturnType<typeof createNeo4jGraphStore>> | undefined;
  try {
    loadEnvFileIfPresent();
    store = await createNeo4jGraphStore();
    const result = await store.findPaths(parsed.repositoryId, parsed.from, parsed.to, {
      ...(parsed.depth === undefined ? {} : { maxDepth: parsed.depth }),
      ...(parsed.maxPaths === undefined ? {} : { maxPaths: parsed.maxPaths }),
      ...(parsed.relationshipTypes === undefined
        ? {}
        : { relationshipTypes: parsed.relationshipTypes }),
    });
    process.stdout.write(`${formatPathResult(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Graph query failed: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (store !== undefined) {
      await store.close();
    }
  }
}

async function runDiff(args: readonly string[]): Promise<number> {
  if (wantsHelp(args)) {
    writeUsage(process.stdout);
    return 0;
  }

  const parsed = parseOrUsage(() => parseDiffArgs(args));
  if (typeof parsed === 'number') {
    return parsed;
  }

  try {
    const report = await detectChangedSymbols(parsed.repository, {
      base: parsed.base,
      head: parsed.head,
    });
    const output = parsed.json
      ? formatDiffReportJson(report)
      : `${formatDiffReport(report)}\n`;
    process.stdout.write(output);
    return 0;
  } catch (error) {
    process.stderr.write(`Change detection failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

async function runGraph(args: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (subcommand === undefined) {
    writeUsage(process.stderr, 'Missing graph subcommand');
    return 1;
  }
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    writeUsage(process.stdout);
    return 0;
  }
  if (subcommand === 'paths') {
    return runPathsCommand(rest);
  }
  if (isDependencyQuery(subcommand)) {
    return runDependencyQueryCommand(subcommand, rest);
  }

  writeUsage(process.stderr, `Unknown graph command: ${subcommand}`);
  return 1;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    writeUsage(process.stdout);
    return command === undefined ? 1 : 0;
  }

  if (command === 'analyze') {
    return runAnalyze(rest);
  }
  if (command === 'index') {
    return runIndex(rest);
  }
  if (command === 'graph') {
    return runGraph(rest);
  }
  if (command === 'diff') {
    return runDiff(rest);
  }

  writeUsage(process.stderr, `Unknown command: ${command}`);
  return 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
