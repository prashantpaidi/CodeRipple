/**
 * Canonical graph model for CodeRipple's static analysis output.
 *
 * The model is intentionally small and explicit. Every node kind and every
 * edge kind is enumerated here so that downstream consumers (and the Zod
 * schema in `graph-schema.ts`) have a single source of truth.
 */

export const NODE_TYPES = ['FILE', 'CLASS', 'FUNCTION', 'METHOD'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = ['CONTAINS', 'IMPORTS', 'CALLS'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Typed reason codes for references CodeRipple could not safely resolve.
 *
 * We never invent an edge from a guess. When resolution is uncertain we emit
 * one of these codes instead.
 */
export const UNRESOLVED_REASONS = [
  /** The callee exists syntactically but its target could not be determined. */
  'TARGET_NOT_RESOLVED',
  /** The callee is a computed/dynamic member access (e.g. `obj[key]()`). */
  'DYNAMIC_PROPERTY_ACCESS',
  /** The callee resolves to a declaration outside the analyzed repository. */
  'EXTERNAL_DEPENDENCY',
  /** More than one in-repository declaration could be the target. */
  'AMBIGUOUS_SYMBOL',
] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

export interface FileNode {
  id: string;
  type: 'FILE';
  name: string;
  path: string;
}

export interface ClassNode {
  id: string;
  type: 'CLASS';
  name: string;
  file: string;
  startLine: number;
  endLine: number;
}

export interface FunctionNode {
  id: string;
  type: 'FUNCTION';
  name: string;
  file: string;
  startLine: number;
  endLine: number;
}

export interface MethodNode {
  id: string;
  type: 'METHOD';
  name: string;
  file: string;
  parent: string;
  startLine: number;
  endLine: number;
}

export type GraphNode = FileNode | ClassNode | FunctionNode | MethodNode;

export interface GraphEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
}

export interface UnresolvedReference {
  caller: string;
  expression: string;
  line: number;
  reason: UnresolvedReason;
}

export interface GraphMetadata {
  filesAnalyzed: number;
  classes: number;
  functions: number;
  methods: number;
  resolvedCalls: number;
  unresolvedCalls: number;
}

export interface CodeGraph {
  version: '1';
  repository: {
    name: string;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedReferences: UnresolvedReference[];
  metadata: GraphMetadata;
}

export const GRAPH_VERSION = '1' as const;
