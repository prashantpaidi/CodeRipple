import type { ChangedFile, ChangedLineRange } from '../git/types.js';
import type { CodeGraph, GraphNode } from '../graph/graph-types.js';
import { compareStrings } from '../utils/paths.js';
import type { ChangedSymbol, SymbolChangeType } from './types.js';

interface GraphIndex {
  nodesById: Map<string, GraphNode>;
  nodesByFile: Map<string, GraphNode[]>;
}

interface AccumulatedSymbol {
  node: GraphNode;
  ranges: ChangedLineRange[];
}

function indexGraph(graph: CodeGraph): GraphIndex {
  const nodesById = new Map<string, GraphNode>();
  const nodesByFile = new Map<string, GraphNode[]>();

  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
    if (node.type === 'FILE') {
      continue;
    }
    const existing = nodesByFile.get(node.file);
    if (existing === undefined) {
      nodesByFile.set(node.file, [node]);
    } else {
      existing.push(node);
    }
  }

  return { nodesById, nodesByFile };
}

function overlaps(node: GraphNode, range: ChangedLineRange): boolean {
  if (node.type === 'FILE') {
    return false;
  }
  return node.startLine <= range.endLine && range.startLine <= node.endLine;
}

/**
 * Deterministic most-specific-symbol rule.
 *
 * Among the CLASS/FUNCTION/METHOD nodes overlapping `range`, an outer node is
 * discarded when a node it contains also overlaps: CLASSES yield to their own
 * METHODs; if nothing more specific overlaps, the FILE node is the fallback.
 * FUNCTION nodes never nest, so they are always candidates.
 */
function mostSpecificNodesOverlapping(
  index: GraphIndex,
  filePath: string,
  range: ChangedLineRange,
): GraphNode[] {
  const candidates = (index.nodesByFile.get(filePath) ?? []).filter((node) =>
    overlaps(node, range),
  );

  const parentsWithOverlappingMethod = new Set<string>();
  for (const node of candidates) {
    if (node.type === 'METHOD') {
      parentsWithOverlappingMethod.add(node.parent);
    }
  }

  const specific = candidates.filter(
    (node) => node.type !== 'CLASS' || !parentsWithOverlappingMethod.has(node.id),
  );
  if (specific.length > 0) {
    return specific;
  }

  const fileNode = index.nodesById.get(filePath);
  return fileNode !== undefined && fileNode.type === 'FILE' ? [fileNode] : [];
}

function collectSymbols(
  index: GraphIndex,
  filePath: string,
  ranges: readonly ChangedLineRange[],
): Map<string, AccumulatedSymbol> {
  const collected = new Map<string, AccumulatedSymbol>();

  for (const range of ranges) {
    for (const node of mostSpecificNodesOverlapping(index, filePath, range)) {
      const existing = collected.get(node.id);
      if (existing === undefined) {
        collected.set(node.id, { node, ranges: [range] });
      } else {
        existing.ranges.push(range);
      }
    }
  }

  return collected;
}

function dedupeRanges(ranges: readonly ChangedLineRange[]): ChangedLineRange[] {
  const seen = new Set<string>();
  const unique: ChangedLineRange[] = [];
  for (const range of ranges) {
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(range);
  }
  unique.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return unique;
}

const CHANGE_RANK: Record<SymbolChangeType, number> = {
  MODIFIED: 0,
  ADDED: 1,
  DELETED: 2,
};

function classify(inBase: boolean, inHead: boolean): SymbolChangeType {
  if (inBase && inHead) {
    return 'MODIFIED';
  }
  return inHead ? 'ADDED' : 'DELETED';
}

function pathOf(node: GraphNode): string {
  return node.type === 'FILE' ? node.path : node.file;
}

/**
 * Map changed files onto the CodeRipple symbols they affect.
 *
 * Ranges are resolved per side: `oldRanges` against the base graph, `newRanges`
 * against the head graph. A candidate symbol's change kind is then decided by
 * the deterministic node IDs — present in both graphs means MODIFIED, head-only
 * means ADDED, base-only means DELETED — so a modification is never misreported
 * as a delete plus an add. Results are deduplicated by node ID, and each symbol
 * aggregates all of its contributing ranges. Deletions therefore come from the
 * base graph, additions and modifications from the head graph.
 */
export function mapChangedSymbols(
  changedFiles: readonly ChangedFile[],
  baseGraph: CodeGraph,
  headGraph: CodeGraph,
): ChangedSymbol[] {
  const base = indexGraph(baseGraph);
  const head = indexGraph(headGraph);
  const byId = new Map<string, ChangedSymbol>();

  for (const file of changedFiles) {
    const headSymbols =
      file.newPath === undefined
        ? new Map<string, AccumulatedSymbol>()
        : collectSymbols(head, file.newPath, file.newRanges);
    const baseSymbols =
      file.oldPath === undefined
        ? new Map<string, AccumulatedSymbol>()
        : collectSymbols(base, file.oldPath, file.oldRanges);

    const candidateIds = new Set<string>([...headSymbols.keys(), ...baseSymbols.keys()]);
    for (const id of candidateIds) {
      const changeType = classify(base.nodesById.has(id), head.nodesById.has(id));
      const headEntry = headSymbols.get(id);
      const baseEntry = baseSymbols.get(id);
      const source = changeType === 'DELETED' ? baseEntry : headEntry ?? baseEntry;
      const node =
        source?.node ??
        (changeType === 'DELETED' ? base.nodesById.get(id) : head.nodesById.get(id));
      if (node === undefined) {
        continue;
      }

      byId.set(id, {
        nodeId: node.id,
        nodeType: node.type,
        changeType,
        filePath: pathOf(node),
        changedRanges: dedupeRanges(source?.ranges ?? []),
      });
    }
  }

  const symbols = [...byId.values()];
  symbols.sort(
    (a, b) =>
      CHANGE_RANK[a.changeType] - CHANGE_RANK[b.changeType] || compareStrings(a.nodeId, b.nodeId),
  );
  return symbols;
}
