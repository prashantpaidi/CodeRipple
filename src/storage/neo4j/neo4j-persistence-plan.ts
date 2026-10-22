import {
  EDGE_TYPES,
  NODE_TYPES,
  type CodeGraph,
  type EdgeType,
} from '../../graph/graph-types.js';
import type { RepositoryIdentity } from '../repository-identity.js';
import { NODE_LABELS, graphNodeToProperties, refOf } from './neo4j-mapper.js';

/**
 * Grouping of a graph into a fixed number of batch writes.
 *
 * The plan is a pure function of the graph: one node batch per node type and
 * one edge batch per edge type, regardless of graph size. This is what keeps
 * persistence free of an N+1 write pattern (four node statements plus three
 * edge statements, plus setup, for any repository).
 */

export interface NodeBatchRow {
  ref: string;
  props: Record<string, unknown>;
}

export interface NodeBatch {
  label: string;
  rows: NodeBatchRow[];
}

export interface EdgeBatchRow {
  id: string;
  fromRef: string;
  toRef: string;
}

export interface EdgeBatch {
  type: EdgeType;
  rows: EdgeBatchRow[];
}

export interface PersistencePlan {
  nodeBatches: NodeBatch[];
  edgeBatches: EdgeBatch[];
}

export function planPersistence(
  graph: CodeGraph,
  repository: RepositoryIdentity,
): PersistencePlan {
  const nodeRowsByLabel = new Map<string, NodeBatchRow[]>();
  for (const node of graph.nodes) {
    const label = NODE_LABELS[node.type];
    const rows = nodeRowsByLabel.get(label) ?? [];
    rows.push({
      ref: refOf(repository.id, node.id),
      props: graphNodeToProperties(node, repository.id),
    });
    nodeRowsByLabel.set(label, rows);
  }

  const nodeBatches: NodeBatch[] = [];
  for (const type of NODE_TYPES) {
    const rows = nodeRowsByLabel.get(NODE_LABELS[type]);
    if (rows !== undefined && rows.length > 0) {
      nodeBatches.push({ label: NODE_LABELS[type], rows });
    }
  }

  const edgeRowsByType = new Map<EdgeType, EdgeBatchRow[]>();
  for (const edge of graph.edges) {
    const rows = edgeRowsByType.get(edge.type) ?? [];
    rows.push({
      id: edge.id,
      fromRef: refOf(repository.id, edge.from),
      toRef: refOf(repository.id, edge.to),
    });
    edgeRowsByType.set(edge.type, rows);
  }

  const edgeBatches: EdgeBatch[] = [];
  for (const type of EDGE_TYPES) {
    const rows = edgeRowsByType.get(type);
    if (rows !== undefined && rows.length > 0) {
      edgeBatches.push({ type, rows });
    }
  }

  return { nodeBatches, edgeBatches };
}
