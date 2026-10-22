import neo4j, { type Driver, type Record as Neo4jRecord, type Session } from 'neo4j-driver';

import type { CodeGraph, EdgeType, GraphNode } from '../../graph/graph-types.js';
import { compareStrings } from '../../utils/paths.js';
import {
  ConnectionError,
  GraphStoreError,
  PersistenceError,
  errorMessage,
} from '../errors.js';
import {
  type DependencyMatch,
  type DependencyResult,
  type GraphPath,
  type GraphStore,
  type PathOptions,
  type PathResult,
  type QueryOptions,
  type TraversalOptions,
  resolveMaxPaths,
  resolvePathDepth,
  resolveRelationshipTypes,
  resolveTraversalDepth,
} from '../graph-store.js';
import type { RepositoryIdentity } from '../repository-identity.js';
import { createNeo4jDriver, isConnectivityError, verifyConnectivity } from './neo4j-client.js';
import { type Neo4jConfig, loadNeo4jConfig } from './neo4j-config.js';
import {
  extractNodeProperties,
  pathToGraphPath,
  propertiesToGraphNode,
  refOf,
  toInteger,
} from './neo4j-mapper.js';
import { planPersistence } from './neo4j-persistence-plan.js';
import { initializeSchema } from './neo4j-schema.js';

/**
 * Neo4j implementation of {@link GraphStore}.
 *
 * Every method returns CodeRipple types only; Neo4j records, paths, and the
 * driver itself never leave this module. Writes run inside a single managed
 * transaction (atomic replace) and are batched, so the number of database round
 * trips is constant rather than proportional to the graph size.
 */

const DELETE_REPOSITORY_NODES =
  'MATCH (n:CodeEntity {repositoryId: $repositoryId}) DETACH DELETE n';

const UPSERT_REPOSITORY =
  'MERGE (r:Repository {id: $repositoryId}) SET r.name = $name, r.rootPath = $rootPath';

const GET_NODE = 'MATCH (node:CodeEntity {ref: $ref}) RETURN node AS node';

/**
 * `label` and relationship `type` are interpolated from the fixed
 * {@link NODE_LABELS} / `EDGE_TYPES` allowlists — never from user input — while
 * every value travels as a query parameter.
 */
function nodeBatchStatement(label: string): string {
  return [
    'MATCH (r:Repository {id: $repositoryId})',
    'UNWIND $rows AS row',
    'MERGE (c:CodeEntity {ref: row.ref})',
    'SET c += row.props',
    `SET c:${label}`,
    'MERGE (c)-[:BELONGS_TO]->(r)',
    'RETURN count(c) AS written',
  ].join('\n');
}

function edgeBatchStatement(type: EdgeType): string {
  return [
    'UNWIND $rows AS row',
    'MATCH (a:CodeEntity {ref: row.fromRef})',
    'MATCH (b:CodeEntity {ref: row.toRef})',
    `MERGE (a)-[rel:${type}]->(b)`,
    'SET rel.id = row.id',
    'RETURN count(rel) AS written',
  ].join('\n');
}

function directStatement(types: readonly EdgeType[], direction: 'in' | 'out'): string {
  const pattern = `[:${types.join('|')}]`;
  const arrow =
    direction === 'in'
      ? `(anchor)<-${pattern}-(other:CodeEntity {repositoryId: $repositoryId})`
      : `(anchor)-${pattern}->(other:CodeEntity {repositoryId: $repositoryId})`;
  return [
    `MATCH (anchor:CodeEntity {ref: $ref})`,
    `MATCH ${arrow}`,
    'RETURN other AS node',
    'ORDER BY other.id',
  ].join('\n');
}

function traversalStatement(
  types: readonly EdgeType[],
  direction: 'in' | 'out',
  depth: number,
): string {
  const pattern = `[:${types.join('|')}*1..${depth}]`;
  // `depth` is an integer validated to `[1, MAX_TRAVERSAL_DEPTH]`, so embedding
  // it cannot inject arbitrary Cypher (variable-length bounds must be literals).
  const match =
    direction === 'out'
      ? `MATCH path = (anchor:CodeEntity {ref: $ref})-${pattern}->(other:CodeEntity)`
      : `MATCH path = (other:CodeEntity)-${pattern}->(anchor:CodeEntity {ref: $ref})`;
  return [
    match,
    'WHERE other.repositoryId = $repositoryId',
    'WITH other, min(length(path)) AS depth',
    'RETURN other AS node, depth',
    'ORDER BY other.id',
  ].join('\n');
}

function pathsStatement(
  types: readonly EdgeType[],
  depth: number,
  maxPaths: number,
): string {
  const pattern = `[:${types.join('|')}*1..${depth}]`;
  return [
    `MATCH path = (a:CodeEntity {ref: $fromRef})-${pattern}->(b:CodeEntity {ref: $toRef})`,
    'WITH path, nodes(path) AS pathNodes, relationships(path) AS pathRelationships',
    'ORDER BY length(path), [n IN pathNodes | n.ref]',
    // Inlined rather than parameterized: `LIMIT` requires an integer, and the
    // driver packs every plain JS `number` parameter as a Cypher float. The
    // value is validated to be a positive integer beforehand.
    `LIMIT ${maxPaths}`,
    // Return the node/relationship lists rather than the driver's `Path` object
    // (which exposes segments), so the mapper stays driver-shape independent.
    'RETURN pathNodes AS nodes, pathRelationships AS relationships',
  ].join('\n');
}

/**
 * Send integral properties as Neo4j integers.
 *
 * The driver encodes a plain JS `number` as a Cypher float, which would store
 * `startLine`/`endLine` as floats; converting keeps them true integers.
 */
function integerProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    result[key] =
      typeof value === 'number' && Number.isInteger(value) ? neo4j.int(value) : value;
  }
  return result;
}

/** Deduplicate matches by node ID, keeping the smallest depth, then sort. */
function normalizeMatches(matches: readonly DependencyMatch[]): DependencyMatch[] {
  const byId = new Map<string, DependencyMatch>();
  for (const match of matches) {
    const existing = byId.get(match.node.id);
    if (existing === undefined || match.depth < existing.depth) {
      byId.set(match.node.id, match);
    }
  }
  return [...byId.values()].sort(
    (a, b) => compareStrings(a.node.id, b.node.id) || a.depth - b.depth,
  );
}

/**
 * Identity of a path for deduplication.
 *
 * Includes the ordered edge IDs as well as the node IDs, so two paths that
 * visit the same nodes but use different relationships (e.g. a `CALLS` hop and
 * an `IMPORTS` hop between the same pair) are preserved rather than collapsed.
 */
function pathKey(path: GraphPath): string {
  const nodePart = path.nodes.map((node) => node.id).join('>');
  const edgePart = path.edges.map((edge) => edge.id).join('>');
  return `${nodePart}|${edgePart}`;
}

function normalizePaths(paths: readonly GraphPath[]): GraphPath[] {
  const byKey = new Map<string, GraphPath>();
  for (const path of paths) {
    const key = pathKey(path);
    if (!byKey.has(key)) {
      byKey.set(key, path);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.nodes.length - b.nodes.length || compareStrings(pathKey(a), pathKey(b)),
  );
}

export class Neo4jGraphStore implements GraphStore {
  constructor(
    private readonly driver: Driver,
    private readonly config: Neo4jConfig,
  ) {}

  private openSession(): Session {
    return this.driver.session({ database: this.config.database });
  }

  async saveGraph(graph: CodeGraph, repository: RepositoryIdentity): Promise<void> {
    const plan = planPersistence(graph, repository);
    const session = this.openSession();
    try {
      await session.executeWrite(async (transaction) => {
        await transaction.run(DELETE_REPOSITORY_NODES, { repositoryId: repository.id });
        await transaction.run(UPSERT_REPOSITORY, {
          repositoryId: repository.id,
          name: repository.name,
          rootPath: repository.rootPath,
        });

        for (const batch of plan.nodeBatches) {
          await transaction.run(nodeBatchStatement(batch.label), {
            repositoryId: repository.id,
            rows: batch.rows.map((row) => ({
              ref: row.ref,
              props: integerProperties(row.props),
            })),
          });
        }

        for (const batch of plan.edgeBatches) {
          const result = await transaction.run(edgeBatchStatement(batch.type), {
            rows: batch.rows,
          });
          const written = toInteger(result.records[0]?.get('written'));
          if (written !== batch.rows.length) {
            throw new PersistenceError(
              `expected ${batch.rows.length} ${batch.type} relationships but wrote ${written}` +
                ' (an edge referenced a node that was not persisted)',
            );
          }
        }
      });
    } catch (error) {
      throw this.describeWriteFailure(repository, error);
    } finally {
      await session.close();
    }
  }

  async getNode(repositoryId: string, nodeId: string): Promise<GraphNode | null> {
    return this.withSession('getNode', async (session) => {
      const result = await session.executeRead((transaction) =>
        transaction.run(GET_NODE, { ref: refOf(repositoryId, nodeId) }),
      );
      const record = result.records[0];
      if (record === undefined) {
        return null;
      }
      return propertiesToGraphNode(extractNodeProperties(record.get('node')));
    });
  }

  async getCallers(
    repositoryId: string,
    nodeId: string,
    options?: QueryOptions,
  ): Promise<DependencyResult> {
    return this.directQuery('getCallers', repositoryId, nodeId, options, 'in');
  }

  async getCallees(
    repositoryId: string,
    nodeId: string,
    options?: QueryOptions,
  ): Promise<DependencyResult> {
    return this.directQuery('getCallees', repositoryId, nodeId, options, 'out');
  }

  async getDependencies(
    repositoryId: string,
    nodeId: string,
    options?: TraversalOptions,
  ): Promise<DependencyResult> {
    return this.traversalQuery('getDependencies', repositoryId, nodeId, options, 'out');
  }

  async getDependents(
    repositoryId: string,
    nodeId: string,
    options?: TraversalOptions,
  ): Promise<DependencyResult> {
    return this.traversalQuery('getDependents', repositoryId, nodeId, options, 'in');
  }

  async findPaths(
    repositoryId: string,
    from: string,
    to: string,
    options?: PathOptions,
  ): Promise<PathResult> {
    const types = resolveRelationshipTypes(options);
    const depth = resolvePathDepth(options);
    const maxPaths = resolveMaxPaths(options);

    return this.withSession('findPaths', async (session) => {
      const result = await session.executeRead((transaction) =>
        transaction.run(pathsStatement(types, depth, maxPaths), {
          fromRef: refOf(repositoryId, from),
          toRef: refOf(repositoryId, to),
        }),
      );
      const paths = result.records.map((record) =>
        pathToGraphPath({
          nodes: record.get('nodes'),
          relationships: record.get('relationships'),
        }),
      );
      return { repositoryId, from, to, paths: normalizePaths(paths) };
    });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private directQuery(
    action: string,
    repositoryId: string,
    nodeId: string,
    options: QueryOptions | undefined,
    direction: 'in' | 'out',
  ): Promise<DependencyResult> {
    const types = resolveRelationshipTypes(options);
    return this.withSession(action, async (session) => {
      const result = await session.executeRead((transaction) =>
        transaction.run(directStatement(types, direction), {
          ref: refOf(repositoryId, nodeId),
          repositoryId,
        }),
      );
      const matches = result.records.map((record) => ({
        node: propertiesToGraphNode(extractNodeProperties(record.get('node'))),
        depth: 1,
      }));
      return { repositoryId, root: nodeId, nodes: normalizeMatches(matches) };
    });
  }

  private traversalQuery(
    action: string,
    repositoryId: string,
    nodeId: string,
    options: TraversalOptions | undefined,
    direction: 'in' | 'out',
  ): Promise<DependencyResult> {
    const types = resolveRelationshipTypes(options);
    const depth = resolveTraversalDepth(options);
    return this.withSession(action, async (session) => {
      const result = await session.executeRead((transaction) =>
        transaction.run(traversalStatement(types, direction, depth), {
          ref: refOf(repositoryId, nodeId),
          repositoryId,
        }),
      );
      const matches = result.records.map((record) => this.toMatch(record));
      return { repositoryId, root: nodeId, nodes: normalizeMatches(matches) };
    });
  }

  private toMatch(record: Neo4jRecord): DependencyMatch {
    return {
      node: propertiesToGraphNode(extractNodeProperties(record.get('node'))),
      depth: toInteger(record.get('depth')),
    };
  }

  private async withSession<T>(
    action: string,
    work: (session: Session) => Promise<T>,
  ): Promise<T> {
    const session = this.openSession();
    try {
      return await work(session);
    } catch (error) {
      throw this.describeFailure(action, error);
    } finally {
      await session.close();
    }
  }

  private describeFailure(action: string, error: unknown): GraphStoreError {
    if (error instanceof GraphStoreError) {
      return error;
    }
    if (isConnectivityError(error)) {
      return new ConnectionError(
        `${action} failed: Neo4j is unreachable: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    return new GraphStoreError(`${action} failed: ${errorMessage(error)}`, { cause: error });
  }

  private describeWriteFailure(
    repository: RepositoryIdentity,
    error: unknown,
  ): GraphStoreError {
    if (error instanceof GraphStoreError) {
      return error;
    }
    const context = `Failed to persist CodeRipple graph for repository "${repository.name}" (${repository.id})`;
    if (isConnectivityError(error)) {
      return new ConnectionError(`${context}: database unreachable: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    return new PersistenceError(`${context}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Build a connected, schema-initialized store.
 *
 * Creates the driver once, verifies connectivity eagerly for a clear
 * configuration/connection error, and makes sure constraints exist (idempotent)
 * before any write. The driver is closed if initialization fails.
 */
export async function createNeo4jGraphStore(
  config: Neo4jConfig = loadNeo4jConfig(),
): Promise<Neo4jGraphStore> {
  const driver = createNeo4jDriver(config);
  try {
    await verifyConnectivity(driver);
    await initializeSchema(driver, config);
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw error;
  }
  return new Neo4jGraphStore(driver, config);
}
