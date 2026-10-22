import { analyzeRepository } from './analyze.js';
import { loadRepositoryConfig } from '../config/repository-config.js';
import type { CodeGraph } from '../graph/graph-types.js';
import type { DiscoveryOptions } from '../parser/repository-parser.js';
import type { GraphStore } from '../storage/graph-store.js';
import {
  type RepositoryIdentity,
  resolveRepositoryIdentity,
} from '../storage/repository-identity.js';

export interface IndexOptions extends DiscoveryOptions {
  /** Explicit repository identity (`--repository-id`); overrides derivation. */
  repositoryId?: string;
}

export interface IndexResult {
  graph: CodeGraph;
  repository: RepositoryIdentity;
}

/**
 * Analyze a repository and persist its graph to the graph store.
 *
 * The analyzer runs first (unchanged, Neo4j-independent); only then is a
 * deterministic repository identity resolved and the graph handed to the store
 * for an atomic replace.
 */
export async function indexRepository(
  inputPath: string,
  store: GraphStore,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const config = loadRepositoryConfig(inputPath);
  const repository = resolveRepositoryIdentity(config.rootDir, {
    ...(options.repositoryId === undefined ? {} : { override: options.repositoryId }),
  });

  const { graph } = analyzeRepository(inputPath, options);
  await store.saveGraph(graph, repository);

  return { graph, repository };
}

function line(label: string, value: string | number): string {
  return `${`${label}:`.padEnd(23)}${value}`;
}

/** Render the human-readable summary printed after indexing. */
export function formatIndexSummary(graph: CodeGraph, repository: RepositoryIdentity): string {
  return [
    'CodeRipple',
    '',
    line('Repository', graph.repository.name),
    line('Repository ID', repository.id),
    line('Files analyzed', graph.metadata.filesAnalyzed),
    line('Nodes indexed', graph.nodes.length),
    line('Edges indexed', graph.edges.length),
    line('Unresolved references', graph.unresolvedReferences.length),
    line('Database', 'Neo4j'),
    line('Status', 'indexed'),
  ].join('\n');
}
