import fs from 'node:fs';
import path from 'node:path';

import { loadRepositoryConfig } from '../config/repository-config.js';
import { buildGraph, countImportEdges } from '../graph/graph-builder.js';
import type { CodeGraph } from '../graph/graph-types.js';
import { parseRepository } from '../parser/file-parser.js';
import { discoverSourceFiles, type DiscoveryOptions } from '../parser/repository-parser.js';

export interface AnalyzeOptions extends DiscoveryOptions {
  /** Optional file path to write the graph JSON to. */
  output?: string;
}

export interface AnalyzeResult {
  graph: CodeGraph;
  /** Absolute path the graph was written to, or `null` when not writing. */
  outputPath: string | null;
}

/**
 * Analyze a repository on disk and produce its code graph.
 *
 * This is the programmatic entry point shared by the CLI and the tests.
 */
export function analyzeRepository(
  inputPath: string,
  options: AnalyzeOptions = {},
): AnalyzeResult {
  const config = loadRepositoryConfig(inputPath);
  const files = discoverSourceFiles(config, options);
  const parsed = parseRepository(config, files);
  const graph = buildGraph(config, parsed);

  let outputPath: string | null = null;
  if (options.output !== undefined) {
    if (options.output === '') {
      throw new Error('Output path must not be empty');
    }
    outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serializeGraph(graph), 'utf8');
  }

  return { graph, outputPath };
}

/** Serialize a graph to deterministic, pretty-printed JSON with a trailing newline. */
export function serializeGraph(graph: CodeGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function line(label: string, value: string | number): string {
  return `${`${label}:`.padEnd(20)}${value}`;
}

/** Render the human-readable CLI summary for an analysis run. */
export function formatSummary(graph: CodeGraph, outputPath: string | null): string {
  const { metadata } = graph;
  const rows = [
    'CodeRipple',
    '',
    `Repository: ${graph.repository.name}`,
    '',
    line('Files analyzed', metadata.filesAnalyzed),
    line('Classes', metadata.classes),
    line('Functions', metadata.functions),
    line('Methods', metadata.methods),
    '',
    line('Import relationships', countImportEdges(graph)),
    line('Calls resolved', metadata.resolvedCalls),
    line('Calls unresolved', metadata.unresolvedCalls),
  ];

  if (outputPath) {
    rows.push('', 'Output:', outputPath);
  }

  return rows.join('\n');
}
