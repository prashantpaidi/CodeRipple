import { GitCliDiffProvider } from '../git/git-diff-provider.js';
import { resolveCommitId } from '../git/git-runner.js';
import { buildRevisionGraphs, type RevisionGraphs } from '../git/revision-graph.js';
import type { CodeGraph, GraphEdge, GraphNode } from '../graph/graph-types.js';
import type { DiscoveryOptions } from '../parser/repository-parser.js';
import { resolveRepositoryIdentity, type RepositoryIdentity } from '../storage/repository-identity.js';
import { compareStrings, isTestFile } from '../utils/paths.js';
import { mapChangedSymbols } from './changed-symbol-mapper.js';
import { impactReportSchema, type ImpactLevel, type ImpactReport } from './impact-report.js';
import type { ChangedSymbol } from './types.js';

export interface ImpactAnalysisOptions {
  base: string;
  head: string;
  depth: number;
  graphOptions?: DiscoveryOptions;
}

export interface ImpactGraphInput {
  repository: RepositoryIdentity;
  baseSha: string;
  headSha: string;
  baseGraph: CodeGraph;
  headGraph: CodeGraph;
  changedSymbols: readonly ChangedSymbol[];
  depth: number;
  graphOptions?: DiscoveryOptions;
  limitations?: readonly string[];
}

const rank: Record<ImpactLevel, number> = { 'directly-changed': 0, 'directly-dependent': 1, 'transitively-dependent': 2, 'potential-module-impact': 3, 'unknown/unresolved': 4 };
const sortKey = (value: unknown): string => JSON.stringify(value);

/** Analyze already-built graphs without a database or Git dependency. */
export function analyzeImpactGraphs(input: ImpactGraphInput): ImpactReport {
  if (!Number.isSafeInteger(input.depth) || input.depth < 0) throw new RangeError('Traversal depth must be a nonnegative safe integer');
  const graphOptions = { ignoredDirectories: [...new Set(input.graphOptions?.ignoredDirectories ?? [])].sort(compareStrings), respectGitignore: input.graphOptions?.respectGitignore ?? true };
  const affected = new Map<string, ImpactReport['affectedSymbols'][number]>();
  const paths = new Map<string, ImpactReport['impactPaths'][number]>();
  const unresolved = new Map<string, ImpactReport['unresolvedReferences'][number]>();
  const limitations = new Set(input.limitations ?? []);
  const changed = [...new Map(input.changedSymbols.map((symbol) => [sortKey(symbol), symbol])).values()]
    .sort((a, b) => compareStrings(sortKey(a), sortKey(b)));
  const recommendations = new Map<string, ImpactReport['testRecommendations'][number]>();
  const withoutTests: ImpactReport['changesWithoutDetectedTests'] = [];
  const usedSides = new Set<'base' | 'head'>();

  for (const change of changed) {
    const side: 'base' | 'head' = change.changeType === 'DELETED' ? 'base' : 'head';
    usedSides.add(side);
    const graph: CodeGraph = side === 'base' ? input.baseGraph : input.headGraph;
    const revision = { side, sha: side === 'base' ? input.baseSha : input.headSha };
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const root = nodes.get(change.nodeId);
    if (!root || root.type !== change.nodeType) {
      limitations.add(`Changed symbol ${change.nodeId} is missing or has a different type in the ${side} graph.`);
      withoutTests.push({ changedSymbolId: change.nodeId, revision });
      continue;
    }
    const incoming = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
        limitations.add(`Edge ${edge.id} in the ${side} graph has an unknown endpoint.`);
        continue;
      }
      const list = incoming.get(edge.to) ?? [];
      list.push(edge);
      incoming.set(edge.to, list);
    }
    for (const list of incoming.values()) list.sort((a, b) => compareStrings(sortKey(a), sortKey(b)));
    const add = (node: GraphNode, level: ImpactLevel, nodeIds: string[], edges: GraphEdge[]): void => {
      const key = `${side}\0${node.id}`;
      const previous = affected.get(key);
      if (!previous || rank[level] < rank[previous.level]) affected.set(key, { node, revision, level });
      const path = { revision, changedSymbolId: change.nodeId, nodeIds, edges, level };
      paths.set(sortKey(path), path);
    };
    add(root, 'directly-changed', [root.id], []);
    const queue: { id: string; nodeIds: string[]; edges: GraphEdge[] }[] = [{ id: root.id, nodeIds: [root.id], edges: [] }];
    const visited = new Set([root.id]);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (!current || current.edges.length >= input.depth) continue;
      for (const edge of incoming.get(current.id) ?? []) {
        if (edge.type !== 'CALLS' || visited.has(edge.from)) continue;
        const node = nodes.get(edge.from);
        if (!node) continue;
        visited.add(node.id);
        const nodeIds = [node.id, ...current.nodeIds];
        const edges = [edge, ...current.edges];
        add(node, edges.length === 1 ? 'directly-dependent' : 'transitively-dependent', nodeIds, edges);
        queue.push({ id: node.id, nodeIds, edges });
      }
    }
    // A path through calls is stronger evidence than a file import, but neither
    // establishes that a test executes or asserts the changed behavior.
    const localRecommendations = new Map<string, ImpactReport['testRecommendations'][number]>();
    const recommend = (testFile: string, confidence: 'static-call' | 'module-import', nodeIds: string[], edges: GraphEdge[]): void => {
      const candidate = { changedSymbolId: change.nodeId, revision, testFile, confidence,
        reason: confidence === 'static-call' ? 'A statically resolved call path connects this test file to the change.' : 'This test file imports a module containing changed or impacted code.', nodeIds, edges };
      const previous = localRecommendations.get(testFile);
      if (!previous || (previous.confidence === 'module-import' && confidence === 'static-call') ||
          (previous.confidence === confidence && (edges.length < previous.edges.length || (edges.length === previous.edges.length && compareStrings(sortKey(candidate), sortKey(previous)) < 0)))) {
        localRecommendations.set(testFile, candidate);
      }
    };
    for (const item of queue) {
      const node = nodes.get(item.id);
      if (!node) continue;
      const fileId = node.type === 'FILE' ? node.id : node.file;
      const fileNode = nodes.get(fileId);
      if (!fileNode || fileNode.type !== 'FILE') continue;
      const structural: GraphEdge[] = [];
      let current = node.id;
      const seen = new Set([current]);
      while (current !== fileId) {
        const parent = (incoming.get(current) ?? []).find((candidate) => candidate.type === 'CONTAINS' && !seen.has(candidate.from));
        if (!parent) break;
        structural.unshift(parent);
        current = parent.from;
        seen.add(current);
      }
      if (current !== fileId) continue;
      const fileEdges = [...structural, ...item.edges];
      if (isTestFile(fileNode.path) && item.edges.length > 0) {
        recommend(fileNode.path, 'static-call', [fileId, ...fileEdges.map((edge) => edge.to)], fileEdges);
      }
      if (isTestFile(fileNode.path) || input.depth === 0) continue;
      for (const edge of incoming.get(fileId) ?? []) {
        const importer = nodes.get(edge.from);
        if (edge.type !== 'IMPORTS' || !importer || importer.type !== 'FILE' || !isTestFile(importer.path)) continue;
        const edges = [edge, ...fileEdges];
        recommend(importer.path, 'module-import', [importer.id, ...edges.map((part) => part.to)], edges);
      }
    }
    if (localRecommendations.size === 0) withoutTests.push({ changedSymbolId: change.nodeId, revision });
    for (const recommendation of localRecommendations.values()) recommendations.set(sortKey(recommendation), recommendation);
    // Containment adds structural context, never a dependency hop.
    for (const item of [...queue]) {
      let current = item.id;
      let nodeIds = item.nodeIds;
      let edges = item.edges;
      const seen = new Set(nodeIds);
      while (true) {
        const edge = (incoming.get(current) ?? []).find((candidate) => candidate.type === 'CONTAINS' && !seen.has(candidate.from));
        if (!edge) break;
        const node = nodes.get(edge.from);
        if (!node) break;
        seen.add(node.id);
        nodeIds = [node.id, ...nodeIds];
        edges = [edge, ...edges];
        add(node, item.edges.length === 0 ? 'directly-changed' : item.edges.length === 1 ? 'directly-dependent' : 'transitively-dependent', nodeIds, edges);
        current = node.id;
      }
    }
    // Imports indicate only potential impact at module level, not symbol calls.
    const file = root.type === 'FILE' ? root.id : root.file;
    for (const edge of incoming.get(file) ?? []) {
      if (edge.type !== 'IMPORTS' || input.depth === 0) continue;
      const node = nodes.get(edge.from);
      if (!node || node.type !== 'FILE') continue;
      const structural: GraphEdge[] = [];
      let current = root.id;
      const seen = new Set([current]);
      while (current !== file) {
        const parent = (incoming.get(current) ?? []).find((candidate) => candidate.type === 'CONTAINS' && !seen.has(candidate.from));
        if (!parent) break;
        structural.unshift(parent);
        current = parent.from;
        seen.add(current);
      }
      if (current !== file) { limitations.add(`No containment path to file ${file} for ${root.id} in the ${side} graph.`); continue; }
      const edges = [edge, ...structural];
      add(node, 'potential-module-impact', [node.id, ...edges.map((e) => e.to)], edges);
    }
  }
  for (const side of usedSides) {
    const graph = side === 'base' ? input.baseGraph : input.headGraph;
    const revision = { side, sha: side === 'base' ? input.baseSha : input.headSha };
    for (const reference of graph.unresolvedReferences) {
      const item = { revision, reference };
      unresolved.set(sortKey(item), item);
    }
  }
  const ordered = <T>(items: Iterable<T>): T[] => [...items].sort((a, b) => compareStrings(sortKey(a), sortKey(b)));
  const allAffected = ordered(affected.values());
  return impactReportSchema.parse({ schemaVersion: '1', repository: input.repository, baseSha: input.baseSha, headSha: input.headSha,
    changedSymbols: changed, affectedSymbols: allAffected.filter((entry) => entry.node.type !== 'FILE'), affectedFiles: allAffected.filter((entry) => entry.node.type === 'FILE'),
    impactPaths: ordered(paths.values()), testRecommendations: ordered(recommendations.values()), changesWithoutDetectedTests: ordered(withoutTests), traversal: { depth: input.depth, graphOptions }, unresolvedReferences: ordered(unresolved.values()), limitations: [...limitations].sort(compareStrings) });
}

/** Freeze refs once, then diff and analyze the same two immutable revisions. */
export async function analyzeImpact(repositoryPath: string, options: ImpactAnalysisOptions): Promise<ImpactReport> {
  if (!Number.isSafeInteger(options.depth) || options.depth < 0) throw new RangeError('Traversal depth must be a nonnegative safe integer');
  const baseSha = await resolveCommitId(repositoryPath, options.base, 'base');
  const headSha = await resolveCommitId(repositoryPath, options.head, 'head');
  const files = await new GitCliDiffProvider().diff(repositoryPath, baseSha, headSha);
  const graphs: RevisionGraphs = await buildRevisionGraphs(repositoryPath, baseSha, headSha, options.graphOptions);
  const changedSymbols = mapChangedSymbols(files, graphs.baseGraph, graphs.headGraph);
  const limitations = files.filter((file) => !changedSymbols.some((symbol) => symbol.filePath === file.oldPath || symbol.filePath === file.newPath)).map((file) => `No changed symbol mapped for ${file.newPath ?? file.oldPath ?? 'unknown file'} (for example, binary, unsupported, or range-free changes).`);
  return analyzeImpactGraphs({ repository: resolveRepositoryIdentity(repositoryPath), baseSha, headSha, ...graphs, changedSymbols, depth: options.depth, graphOptions: options.graphOptions, limitations });
}
