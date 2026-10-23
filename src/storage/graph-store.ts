import {
  EDGE_TYPES,
  type CodeGraph,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
} from '../graph/graph-types.js';
import { InvalidArgumentError } from './errors.js';
import type { RepositoryIdentity } from './repository-identity.js';

/**
 * Storage/query boundary between CodeRipple's analyzer and any graph database.
 *
 * Everything crossing this interface is a CodeRipple type: implementations map
 * their native records (Neo4j nodes/relationships/paths) internally and must
 * never leak them. The analyzer itself has no knowledge of this interface, so
 * it stays usable without a database.
 */

/** Depth used by default for dependency/dependent traversals (direct only). */
export const DEFAULT_TRAVERSAL_DEPTH = 1;
/** Upper bound on traversal depth, to prevent runaway graph walks. */
export const MAX_TRAVERSAL_DEPTH = 5;
/** Depth used by default for path searches (bounded, but enough to be useful). */
export const DEFAULT_PATH_DEPTH = MAX_TRAVERSAL_DEPTH;
/** Number of paths returned by default from a path search. */
export const DEFAULT_MAX_PATHS = 5;

export interface QueryOptions {
  /** Relationship types to traverse. Defaults to `['CALLS']`. */
  relationshipTypes?: readonly EdgeType[];
}

export interface TraversalOptions extends QueryOptions {
  /** Maximum number of hops. Defaults to {@link DEFAULT_TRAVERSAL_DEPTH}. */
  maxDepth?: number;
}

export interface PathOptions extends TraversalOptions {
  /** Maximum number of paths to return. Defaults to {@link DEFAULT_MAX_PATHS}. */
  maxPaths?: number;
}

export interface SaveGraphOptions {
  /**
   * Allow replacing an existing graph already stored under the same repository
   * ID from a *different* path.
   *
   * Only relevant for explicitly assigned IDs (`--repository-id`): a derived ID
   * is a function of the path/remote, so it can never be "reused" for a
   * different repository. Defaults to `false`, which makes an accidental
   * `--repository-id` collision fail loudly instead of silently replacing the
   * previously indexed graph.
   */
  replaceExisting?: boolean;
}

/** A node discovered by a dependency/dependent traversal, with its distance. */
export interface DependencyMatch {
  node: GraphNode;
  /** Number of traversed relationship hops from the queried node (>= 1). */
  depth: number;
}

export interface DependencyResult {
  repositoryId: string;
  /** The CodeRipple node ID the traversal started from. */
  root: string;
  /** Deterministically ordered, deduplicated matches. */
  nodes: DependencyMatch[];
}

/** A single dependency path, expressed purely in CodeRipple types. */
export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathResult {
  repositoryId: string;
  from: string;
  to: string;
  /** Deterministically ordered paths (shortest first). */
  paths: GraphPath[];
}

export interface GraphStore {
  /**
   * Atomically replace the stored graph for a repository.
   *
   * The replacement is namespaced by `repository.id`; see
   * {@link SaveGraphOptions} for the explicit-ID reuse guard.
   */
  saveGraph(
    graph: CodeGraph,
    repository: RepositoryIdentity,
    options?: SaveGraphOptions,
  ): Promise<void>;

  /** Fetch a single node by repository + CodeRipple node ID. */
  getNode(repositoryId: string, nodeId: string): Promise<GraphNode | null>;

  /** Direct callers: nodes with a `CALLS` edge into `nodeId`. */
  getCallers(
    repositoryId: string,
    nodeId: string,
    options?: QueryOptions,
  ): Promise<DependencyResult>;

  /** Direct callees: nodes targeted by a `CALLS` edge from `nodeId`. */
  getCallees(
    repositoryId: string,
    nodeId: string,
    options?: QueryOptions,
  ): Promise<DependencyResult>;

  /** Downstream traversal: everything `nodeId` depends on, within `maxDepth`. */
  getDependencies(
    repositoryId: string,
    nodeId: string,
    options?: TraversalOptions,
  ): Promise<DependencyResult>;

  /** Upstream traversal: everything that depends on `nodeId`, within `maxDepth`. */
  getDependents(
    repositoryId: string,
    nodeId: string,
    options?: TraversalOptions,
  ): Promise<DependencyResult>;

  /** Bounded, deterministically ordered dependency paths between two nodes. */
  findPaths(
    repositoryId: string,
    from: string,
    to: string,
    options?: PathOptions,
  ): Promise<PathResult>;

  /** Release the underlying driver and any pooled connections. */
  close(): Promise<void>;
}

const EDGE_TYPE_SET = new Set<string>(EDGE_TYPES);

/**
 * Validate and normalize the requested relationship types.
 *
 * Relationship types cannot be Cypher parameters, so they are always
 * intersected with the fixed {@link EDGE_TYPES} allowlist here and never taken
 * verbatim from user input.
 */
export function resolveRelationshipTypes(options?: QueryOptions): EdgeType[] {
  const requested = options?.relationshipTypes;
  if (requested === undefined || requested.length === 0) {
    return ['CALLS'];
  }

  const unique = new Set<EdgeType>();
  for (const type of requested) {
    if (!EDGE_TYPE_SET.has(type)) {
      throw new InvalidArgumentError(
        `Unknown relationship type "${String(type)}"; expected one of ${EDGE_TYPES.join(', ')}`,
      );
    }
    unique.add(type);
  }

  return [...unique].sort();
}

function assertDepth(depth: number): number {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_TRAVERSAL_DEPTH) {
    throw new InvalidArgumentError(
      `maxDepth must be an integer between 1 and ${MAX_TRAVERSAL_DEPTH} (got ${String(depth)})`,
    );
  }
  return depth;
}

/** Resolve the hop limit for a dependency/dependent traversal. */
export function resolveTraversalDepth(options?: TraversalOptions): number {
  return assertDepth(options?.maxDepth ?? DEFAULT_TRAVERSAL_DEPTH);
}

/** Resolve the hop limit for a path search. */
export function resolvePathDepth(options?: PathOptions): number {
  return assertDepth(options?.maxDepth ?? DEFAULT_PATH_DEPTH);
}

/** Resolve the maximum number of paths to return. */
export function resolveMaxPaths(options?: PathOptions): number {
  const maxPaths = options?.maxPaths ?? DEFAULT_MAX_PATHS;
  // `Number.isSafeInteger` (not `isInteger`): unsafe values such as `1e21` would
  // be interpolated into `LIMIT` as `1e+21` and produce invalid Cypher.
  if (!Number.isSafeInteger(maxPaths) || maxPaths < 1) {
    throw new InvalidArgumentError(
      `maxPaths must be a positive safe integer (got ${String(maxPaths)})`,
    );
  }
  return maxPaths;
}
