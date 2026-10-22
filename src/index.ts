export {
  analyzeRepository,
  formatSummary,
  serializeGraph,
} from './cli/analyze.js';
export type { AnalyzeOptions, AnalyzeResult } from './cli/analyze.js';
export { loadRepositoryConfig } from './config/repository-config.js';
export type { RepositoryConfig } from './config/repository-config.js';
export { buildGraph } from './graph/graph-builder.js';
export { codeGraphSchema, validateCodeGraph } from './graph/graph-schema.js';
export type {
  CodeGraph,
  EdgeType,
  GraphEdge,
  GraphMetadata,
  GraphNode,
  NodeType,
  UnresolvedReason,
  UnresolvedReference,
} from './graph/graph-types.js';
export { parseRepository } from './parser/file-parser.js';
export {
  discoverSourceFiles,
  loadGitignoreMatcher,
} from './parser/repository-parser.js';
export type { DiscoveredFile, DiscoveryOptions } from './parser/repository-parser.js';

export {
  ConfigurationError,
  ConnectionError,
  GraphStoreError,
  InvalidArgumentError,
  PersistenceError,
} from './storage/errors.js';
export {
  DEFAULT_MAX_PATHS,
  DEFAULT_PATH_DEPTH,
  DEFAULT_TRAVERSAL_DEPTH,
  MAX_TRAVERSAL_DEPTH,
} from './storage/graph-store.js';
export type {
  DependencyMatch,
  DependencyResult,
  GraphPath,
  GraphStore,
  PathOptions,
  PathResult,
  QueryOptions,
  TraversalOptions,
} from './storage/graph-store.js';
export {
  normalizeGitRemote,
  resolveRepositoryIdentity,
} from './storage/repository-identity.js';
export type {
  RepositoryIdentity,
  RepositoryIdentityOptions,
  RepositoryIdentitySource,
} from './storage/repository-identity.js';
export { loadEnvFileIfPresent, loadNeo4jConfig } from './storage/neo4j/neo4j-config.js';
export type { Neo4jConfig } from './storage/neo4j/neo4j-config.js';
export { createNeo4jGraphStore, Neo4jGraphStore } from './storage/neo4j/neo4j-graph-store.js';
export { initializeSchema } from './storage/neo4j/neo4j-schema.js';

