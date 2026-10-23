export {
  analyzeRepository,
  formatSummary,
  serializeGraph,
} from './cli/analyze.js';
export type { AnalyzeOptions, AnalyzeResult } from './cli/analyze.js';
export { formatDiffReport, formatDiffReportJson } from './cli/diff.js';
export type { ChangedFile, ChangedLineRange, FileChangeType } from './git/types.js';
export { FILE_CHANGE_TYPES } from './git/types.js';
export {
  GitCommandError,
  GitError,
  GitUnavailableError,
  InvalidRefError,
  NotAGitRepositoryError,
  RevisionAnalysisError,
} from './git/errors.js';
export { GitCliDiffProvider } from './git/git-diff-provider.js';
export type { GitDiffProvider } from './git/git-diff-provider.js';
export { parseGitDiff, parseNameStatus, parsePatchRanges } from './git/diff-parser.js';
export type { FileLevelChange, PatchFileRanges } from './git/diff-parser.js';
export { buildRevisionGraphs } from './git/revision-graph.js';
export type { RevisionGraphs } from './git/revision-graph.js';
export { mapChangedSymbols } from './impact/changed-symbol-mapper.js';
export { detectChangedSymbols } from './impact/detect-changed-symbols.js';
export type { DetectChangedSymbolsOptions } from './impact/detect-changed-symbols.js';
export { SYMBOL_CHANGE_TYPES } from './impact/types.js';
export type {
  ChangedSymbol,
  ChangedSymbolReport,
  SymbolChangeType,
} from './impact/types.js';
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
export { createNeo4jGraphStore } from './storage/neo4j/neo4j-graph-store.js';

