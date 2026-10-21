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
