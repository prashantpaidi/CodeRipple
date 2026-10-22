import { edgeId } from '../../graph/ids.js';
import { graphNodeSchema } from '../../graph/graph-schema.js';
import {
  EDGE_TYPES,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
} from '../../graph/graph-types.js';
import { GraphStoreError } from '../errors.js';
import type { GraphPath } from '../graph-store.js';

/**
 * Pure conversions between CodeRipple types and Neo4j property maps.
 *
 * Keeping these functions free of the driver's node/relationship classes means
 * the mapping is unit-testable without a database and Neo4j objects never
 * escape the persistence layer.
 */

/** Namespaced identity of a node: unique across every repository. */
export function refOf(repositoryId: string, nodeId: string): string {
  return `${repositoryId}::${nodeId}`;
}

/** Neo4j label added alongside `:CodeEntity` for each CodeRipple node type. */
export const NODE_LABELS: Record<GraphNode['type'], string> = {
  FILE: 'File',
  CLASS: 'Class',
  FUNCTION: 'Function',
  METHOD: 'Method',
};

const EDGE_TYPE_SET = new Set<string>(EDGE_TYPES);

/** True when a relationship type from Neo4j is a known CodeRipple edge type. */
export function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === 'string' && EDGE_TYPE_SET.has(value);
}

/** Flatten a CodeRipple node into the property map stored on its Neo4j node. */
export function graphNodeToProperties(
  node: GraphNode,
  repositoryId: string,
): Record<string, unknown> {
  const common = {
    ref: refOf(repositoryId, node.id),
    id: node.id,
    repositoryId,
    type: node.type,
    name: node.name,
  };

  switch (node.type) {
    case 'FILE':
      return { ...common, path: node.path };
    case 'CLASS':
    case 'FUNCTION':
      return {
        ...common,
        file: node.file,
        startLine: node.startLine,
        endLine: node.endLine,
      };
    case 'METHOD':
      return {
        ...common,
        file: node.file,
        parent: node.parent,
        startLine: node.startLine,
        endLine: node.endLine,
      };
  }
}

/**
 * Rebuild a CodeRipple node from an already-extracted property map.
 *
 * Validated with the analyzer's own `graphNodeSchema` so a corrupt database
 * record fails loudly instead of producing a malformed domain object.
 */
export function propertiesToGraphNode(properties: Record<string, unknown>): GraphNode {
  const { id, type, name } = properties;

  let candidate: unknown;
  switch (type) {
    case 'FILE':
      candidate = { id, type: 'FILE', name, path: properties.path };
      break;
    case 'CLASS':
      candidate = {
        id,
        type: 'CLASS',
        name,
        file: properties.file,
        startLine: properties.startLine,
        endLine: properties.endLine,
      };
      break;
    case 'FUNCTION':
      candidate = {
        id,
        type: 'FUNCTION',
        name,
        file: properties.file,
        startLine: properties.startLine,
        endLine: properties.endLine,
      };
      break;
    case 'METHOD':
      candidate = {
        id,
        type: 'METHOD',
        name,
        file: properties.file,
        parent: properties.parent,
        startLine: properties.startLine,
        endLine: properties.endLine,
      };
      break;
    default:
      throw new GraphStoreError(
        `Unknown CodeRipple node type "${String(type)}" in Neo4j record`,
      );
  }

  const result = graphNodeSchema.safeParse(candidate);
  if (!result.success) {
    throw new GraphStoreError(
      `Corrupt node record "${String(id)}" in Neo4j: ${result.error.message}`,
      { cause: result.error },
    );
  }
  return result.data;
}

/** Rebuild a CodeRipple edge, falling back to the deterministic ID builder. */
export function relationshipToGraphEdge(
  type: EdgeType,
  from: string,
  to: string,
  properties: Record<string, unknown>,
): GraphEdge {
  const storedId = properties.id;
  const id = typeof storedId === 'string' && storedId !== '' ? storedId : edgeId(type, from, to);
  return { id, type, from, to };
}

/** Extract the property map from a driver node record without leaking the type. */
export function extractNodeProperties(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    const properties = (value as { properties?: unknown }).properties;
    if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
      return properties as Record<string, unknown>;
    }
  }
  throw new GraphStoreError('Expected a Neo4j node record');
}

interface DriverNodeLike {
  properties: Record<string, unknown>;
}

interface DriverRelationshipLike {
  type: string;
  properties: Record<string, unknown>;
}

interface DriverPathLike {
  nodes: DriverNodeLike[];
  relationships: DriverRelationshipLike[];
}

function isDriverNodeLike(value: unknown): value is DriverNodeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { properties?: unknown }).properties === 'object' &&
    (value as { properties?: unknown }).properties !== null
  );
}

function isDriverRelationshipLike(value: unknown): value is DriverRelationshipLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { properties?: unknown }).properties === 'object' &&
    (value as { properties?: unknown }).properties !== null
  );
}

function isDriverPathLike(value: unknown): value is DriverPathLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { nodes?: unknown; relationships?: unknown };
  return (
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isDriverNodeLike) &&
    Array.isArray(candidate.relationships) &&
    candidate.relationships.every(isDriverRelationshipLike)
  );
}

/**
 * Convert a Neo4j path into a CodeRipple {@link GraphPath}.
 *
 * For a directed match, `relationships(p)[i]` connects `nodes(p)[i]` to
 * `nodes(p)[i + 1]`, so endpoints are taken from the node sequence rather than
 * from the relationships' internal identifiers.
 */
export function pathToGraphPath(value: unknown): GraphPath {
  if (!isDriverPathLike(value)) {
    throw new GraphStoreError('Expected a Neo4j path record');
  }

  const nodes = value.nodes.map((node) => propertiesToGraphNode(node.properties));
  const edges: GraphEdge[] = [];

  for (let index = 0; index < value.relationships.length; index += 1) {
    const relationship = value.relationships[index];
    const from = nodes[index];
    const to = nodes[index + 1];
    if (relationship === undefined || from === undefined || to === undefined) {
      throw new GraphStoreError('Malformed Neo4j path: nodes and relationships disagree');
    }
    if (!isEdgeType(relationship.type)) {
      throw new GraphStoreError(
        `Unexpected relationship type "${relationship.type}" in Neo4j path`,
      );
    }
    edges.push(
      relationshipToGraphEdge(relationship.type, from.id, to.id, relationship.properties),
    );
  }

  return { nodes, edges };
}

/** Coerce a value from Neo4j into an integer, failing loudly otherwise. */
export function toInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  throw new GraphStoreError(`Expected an integer from Neo4j, received ${String(value)}`);
}
