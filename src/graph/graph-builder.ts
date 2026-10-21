import type { Node } from 'ts-morph';

import type { RepositoryConfig } from '../config/repository-config.js';
import type { ParsedRepository } from '../parser/file-parser.js';
import { resolveCalls } from '../parser/call-resolver.js';
import { resolveImports } from '../parser/import-resolver.js';
import { extractSymbols } from '../parser/symbol-extractor.js';
import { compareStrings, toPosixPath } from '../utils/paths.js';
import { validateCodeGraph } from './graph-schema.js';
import {
  GRAPH_VERSION,
  type CodeGraph,
  type GraphEdge,
  type GraphNode,
  type UnresolvedReference,
} from './graph-types.js';

/** Count nodes of a given type. */
function countNodes(nodes: readonly GraphNode[], type: GraphNode['type']): number {
  return nodes.reduce((total, node) => (node.type === type ? total + 1 : total), 0);
}

/** Count edges of a given type. */
function countEdges(edges: readonly GraphEdge[], type: GraphEdge['type']): number {
  return edges.reduce((total, edge) => (edge.type === type ? total + 1 : total), 0);
}

function compareUnresolved(a: UnresolvedReference, b: UnresolvedReference): number {
  return (
    compareStrings(a.caller, b.caller) ||
    a.line - b.line ||
    compareStrings(a.expression, b.expression) ||
    compareStrings(a.reason, b.reason)
  );
}

/**
 * Assemble the full code graph for a parsed repository.
 *
 * The build runs in ordered phases so that cross-file resolution sees every
 * declaration: extract symbols for all files, resolve imports, then resolve
 * calls against the global declaration table. Output collections are sorted
 * and validated before being returned.
 */
export function buildGraph(
  config: RepositoryConfig,
  parsed: ParsedRepository,
): CodeGraph {
  const entries = [...parsed.sourceFiles.entries()].sort((a, b) =>
    compareStrings(a[0], b[0]),
  );

  const analyzedByAbsolutePath = new Map<string, string>();
  for (const [relativePath, sourceFile] of entries) {
    analyzedByAbsolutePath.set(toPosixPath(sourceFile.getFilePath()), relativePath);
  }

  const nodeById = new Map<string, GraphNode>();
  const edgeById = new Map<string, GraphEdge>();
  const declarationToNodeId = new Map<Node, string>();

  for (const [relativePath, sourceFile] of entries) {
    const symbols = extractSymbols(sourceFile, relativePath);
    for (const node of symbols.nodes) {
      if (!nodeById.has(node.id)) {
        nodeById.set(node.id, node);
      }
    }
    for (const edge of symbols.edges) {
      if (!edgeById.has(edge.id)) {
        edgeById.set(edge.id, edge);
      }
    }
    for (const [declaration, id] of symbols.declarationToNodeId) {
      declarationToNodeId.set(declaration, id);
    }
  }

  for (const [relativePath, sourceFile] of entries) {
    for (const edge of resolveImports(sourceFile, relativePath, analyzedByAbsolutePath)) {
      if (!edgeById.has(edge.id)) {
        edgeById.set(edge.id, edge);
      }
    }
  }

  const unresolvedReferences: UnresolvedReference[] = [];
  for (const [, sourceFile] of entries) {
    const { edges, unresolved } = resolveCalls(sourceFile, { declarationToNodeId });
    for (const edge of edges) {
      if (!edgeById.has(edge.id)) {
        edgeById.set(edge.id, edge);
      }
    }
    unresolvedReferences.push(...unresolved);
  }

  const nodes = [...nodeById.values()].sort((a, b) => compareStrings(a.id, b.id));
  const edges = [...edgeById.values()].sort((a, b) => compareStrings(a.id, b.id));
  unresolvedReferences.sort(compareUnresolved);

  return validateCodeGraph({
    version: GRAPH_VERSION,
    repository: { name: config.name },
    nodes,
    edges,
    unresolvedReferences,
    metadata: {
      filesAnalyzed: countNodes(nodes, 'FILE'),
      classes: countNodes(nodes, 'CLASS'),
      functions: countNodes(nodes, 'FUNCTION'),
      methods: countNodes(nodes, 'METHOD'),
      resolvedCalls: countEdges(edges, 'CALLS'),
      unresolvedCalls: unresolvedReferences.length,
    },
  });
}

/** Count import edges, used by the CLI summary. */
export function countImportEdges(graph: CodeGraph): number {
  return countEdges(graph.edges, 'IMPORTS');
}
