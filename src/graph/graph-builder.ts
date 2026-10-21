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
  const edgeByKey = new Map<string, GraphEdge>();
  const declarationToNodeId = new Map<Node, string>();

  // Edges are deduplicated by their (type, from, to) tuple rather than by the
  // rendered ID, so two genuinely distinct relationships can never collapse
  // into one another.
  const edgeKey = (edge: GraphEdge): string =>
    `${edge.type}\u0000${edge.from}\u0000${edge.to}`;
  const addEdge = (edge: GraphEdge): void => {
    const key = edgeKey(edge);
    if (!edgeByKey.has(key)) {
      edgeByKey.set(key, edge);
    }
  };

  for (const [relativePath, sourceFile] of entries) {
    const symbols = extractSymbols(sourceFile, relativePath);
    for (const node of symbols.nodes) {
      if (!nodeById.has(node.id)) {
        nodeById.set(node.id, node);
      }
    }
    for (const edge of symbols.edges) {
      addEdge(edge);
    }
    for (const [declaration, id] of symbols.declarationToNodeId) {
      declarationToNodeId.set(declaration, id);
    }
  }

  for (const [relativePath, sourceFile] of entries) {
    for (const edge of resolveImports(sourceFile, relativePath, analyzedByAbsolutePath)) {
      addEdge(edge);
    }
  }

  const unresolvedReferences: UnresolvedReference[] = [];
  for (const [relativePath, sourceFile] of entries) {
    const { edges, unresolved } = resolveCalls(sourceFile, relativePath, {
      declarationToNodeId,
    });
    for (const edge of edges) {
      addEdge(edge);
    }
    unresolvedReferences.push(...unresolved);
  }

  const nodes = [...nodeById.values()].sort((a, b) => compareStrings(a.id, b.id));
  const edges = [...edgeByKey.values()].sort((a, b) => compareStrings(a.id, b.id));
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
