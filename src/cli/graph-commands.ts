import type { EdgeType } from '../graph/graph-types.js';
import type {
  DependencyResult,
  GraphStore,
  PathResult,
  QueryOptions,
  TraversalOptions,
} from '../storage/graph-store.js';

/** The four dependency-oriented queries the CLI exposes. */
export type DependencyQuery = 'callers' | 'callees' | 'dependencies' | 'dependents';

export interface DependencyQueryOptions {
  /** Hop limit for `dependencies`/`dependents` (ignored for direct queries). */
  depth?: number;
  relationshipTypes?: readonly EdgeType[];
}

function queryOptions(relationshipTypes?: readonly EdgeType[]): QueryOptions {
  return relationshipTypes === undefined ? {} : { relationshipTypes };
}

function traversalOptions(
  depth: number | undefined,
  relationshipTypes: readonly EdgeType[] | undefined,
): TraversalOptions {
  return {
    ...queryOptions(relationshipTypes),
    ...(depth === undefined ? {} : { maxDepth: depth }),
  };
}

/** Dispatch a CLI dependency query to the appropriate {@link GraphStore} method. */
export function runDependencyQuery(
  store: GraphStore,
  query: DependencyQuery,
  repositoryId: string,
  nodeId: string,
  options: DependencyQueryOptions = {},
): Promise<DependencyResult> {
  const { depth, relationshipTypes } = options;
  switch (query) {
    case 'callers':
      return store.getCallers(repositoryId, nodeId, queryOptions(relationshipTypes));
    case 'callees':
      return store.getCallees(repositoryId, nodeId, queryOptions(relationshipTypes));
    case 'dependencies':
      return store.getDependencies(
        repositoryId,
        nodeId,
        traversalOptions(depth, relationshipTypes),
      );
    case 'dependents':
      return store.getDependents(
        repositoryId,
        nodeId,
        traversalOptions(depth, relationshipTypes),
      );
  }
}

const QUERY_LABELS: Record<DependencyQuery, string> = {
  callers: 'Callers',
  callees: 'Callees',
  dependencies: 'Dependencies',
  dependents: 'Dependents',
};

/** Render a dependency result as stable, human-readable text. */
export function formatDependencyResult(
  result: DependencyResult,
  query: DependencyQuery,
): string {
  const label = QUERY_LABELS[query];
  const header = `${label} of ${result.root} in repository ${result.repositoryId}: ${result.nodes.length} result(s)`;
  if (result.nodes.length === 0) {
    return `${header}\nNo ${label.toLowerCase()} found.`;
  }
  const lines = result.nodes.map(
    (match) => `- ${match.node.id} (${match.node.type}, depth ${match.depth})`,
  );
  return [header, ...lines].join('\n');
}

/** Render path results as stable, human-readable text. */
export function formatPathResult(result: PathResult): string {
  const header = `Paths from ${result.from} to ${result.to} in repository ${result.repositoryId}: ${result.paths.length} path(s)`;
  if (result.paths.length === 0) {
    return `${header}\nNo dependency path found.`;
  }
  const lines: string[] = [];
  result.paths.forEach((path, index) => {
    lines.push(`Path ${index + 1} (${path.edges.length} hop(s)):`);
    lines.push(`  ${path.nodes.map((node) => node.id).join(' -> ')}`);
  });
  return [header, ...lines].join('\n');
}
