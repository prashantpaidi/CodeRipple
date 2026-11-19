import { buildRevisionGraphs } from '../git/revision-graph.js';
import { createRevisionSourceReader, resolveCommitId } from '../git/git-runner.js';
import { GitCliDiffProvider } from '../git/git-diff-provider.js';
import type { CodeGraph, GraphEdge, GraphNode, UnresolvedReference } from '../graph/graph-types.js';
import { mapChangedSymbols } from '../impact/changed-symbol-mapper.js';
import type { ChangedSymbol } from '../impact/types.js';
import { resolveRepositoryIdentity, type RepositoryIdentity } from '../storage/repository-identity.js';
import { compareStrings } from '../utils/paths.js';

/** Implementations must return one finite, consistently sized vector per input. */
export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
export interface RetrievalInput {
  repository: RepositoryIdentity;
  baseSha: string;
  headSha: string;
  baseGraph: CodeGraph;
  headGraph: CodeGraph;
  changedSymbols: readonly ChangedSymbol[];
  /** Read repository-relative text at the supplied immutable commit. */
  readSource: (sha: string, path: string) => Promise<string>;
}
export interface RetrievalOptions {
  depth?: number;
  maxResults?: number;
  maxContextChars?: number;
  maxSnippetChars?: number;
  embeddings?: EmbeddingProvider;
}
export interface EvidenceItem {
  repositoryId: string;
  revision: { side: 'base' | 'head'; sha: string };
  node: GraphNode;
  surroundingSymbols: GraphNode[];
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  truncated: boolean;
  reasons: ('lexical' | 'semantic' | 'dependent')[];
}
export interface EvidencePackage {
  question: string;
  repository: RepositoryIdentity;
  baseSha: string;
  headSha: string;
  evidence: EvidenceItem[];
  relationships: { revision: EvidenceItem['revision']; edge: GraphEdge }[];
  unresolvedReferences: { revision: EvidenceItem['revision']; reference: UnresolvedReference }[];
  limitations: string[];
}

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9_$./-]+/g) ?? [];
const stop = new Set(['what', 'which', 'who', 'where', 'how', 'does', 'do', 'the', 'a', 'an', 'on', 'of', 'in', 'to', 'and', 'depends', 'depend', 'dependent', 'dependencies', 'callers', 'calls', 'for', 'is']);
const key = (side: string, id: string): string => `${side}\0${id}`;
const compare = (a: string, b: string): number => compareStrings(a, b);
function limit(value: number | undefined, fallback: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new RangeError(`Retrieval limit must be an integer between 0 and ${max}`);
  return n;
}
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) throw new Error('Invalid embedding vectors');
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0; const y = b[i] ?? 0; dot += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** Build a bounded, source-grounded package before passing context to any model. */
export async function retrieveEvidence(input: RetrievalInput, question: string, options: RetrievalOptions = {}): Promise<EvidencePackage> {
  const depth = limit(options.depth, 3, 10);
  const maxResults = limit(options.maxResults, 30, 500);
  const maxContext = limit(options.maxContextChars, 24000, 200000);
  const maxSnippet = limit(options.maxSnippetChars, 2000, 20000);
  const limitations = new Set<string>();
  const deleted = new Set(input.changedSymbols.filter((s) => s.changeType === 'DELETED').map((s) => s.nodeId));
  const revisions = [ { side: 'head' as const, sha: input.headSha, graph: input.headGraph }, { side: 'base' as const, sha: input.baseSha, graph: input.baseGraph } ];
  type Candidate = { revision: typeof revisions[number]; node: GraphNode; path: string; text: string; start: number; end: number; snippet: string; truncated: boolean; lexical: number; semantic: number };
  const candidates: Candidate[] = [];
  const cache = new Map<string, Promise<string>>();
  const terms = words(question).filter((word) => !stop.has(word));
  for (const revision of revisions) {
    const files = new Map(revision.graph.nodes.filter((n) => n.type === 'FILE').map((n) => [n.id, n.path]));
    for (const node of [...revision.graph.nodes].sort((a, b) => compare(a.id, b.id))) {
      // Base candidates are rooted only at deleted symbols; their callers are added by traversal below.
      if (revision.side === 'base' && !deleted.has(node.id) && !revision.graph.edges.some((e) => e.type === 'CALLS' && e.from === node.id)) continue;
      const path = node.type === 'FILE' ? node.path : files.get(node.file);
      if (!path) { limitations.add(`Missing file for ${node.id} in ${revision.side} graph.`); continue; }
      const cacheKey = key(revision.sha, path);
      let source = cache.get(cacheKey);
      if (!source) { source = input.readSource(revision.sha, path); cache.set(cacheKey, source); }
      let content: string;
      try { content = await source; } catch { limitations.add(`Source unavailable: ${revision.sha}:${path}`); continue; }
      const lines = content.split(/\r?\n/);
      const start = node.type === 'FILE' ? 1 : node.startLine;
      const end = node.type === 'FILE' ? Math.min(lines.length, 40) : node.endLine;
      if (start < 1 || end < start || end > lines.length) { limitations.add(`Invalid source range for ${node.id} at ${revision.sha}.`); continue; }
      const full = lines.slice(start - 1, end).join('\n');
      const snippet = full.slice(0, maxSnippet);
      const haystack = `${node.name} ${path} ${full}`.toLowerCase();
      const lexical = terms.reduce((sum, term) => sum + (node.name.toLowerCase() === term ? 12 : node.name.toLowerCase().includes(term) ? 6 : path.toLowerCase().includes(term) ? 4 : haystack.includes(term) ? 1 : 0), 0);
      candidates.push({ revision, node, path, text: `${node.name}\n${path}\n${snippet}`, start, end, snippet, truncated: snippet.length < full.length, lexical, semantic: 0 });
    }
  }
  if (options.embeddings && candidates.length) {
    const vectors = await options.embeddings.embed([question, ...candidates.map((c) => c.text)]);
    if (vectors.length !== candidates.length + 1 || !vectors[0]) throw new Error('Embedding provider returned the wrong number of vectors');
    candidates.forEach((c, i) => { c.semantic = cosine(vectors[0] ?? [], vectors[i + 1] ?? []); });
  }
  const byKey = new Map(candidates.map((c) => [key(c.revision.side, c.node.id), c]));
  // Only deleted symbols may seed base searches. Graph traversal may then recover base callers.
  const seeds = candidates.filter((c) => (c.revision.side === 'head' || deleted.has(c.node.id)) && (c.lexical > 0 || c.semantic > 0))
    .sort((a, b) => b.lexical - a.lexical || b.semantic - a.semantic || compare(key(a.revision.side, a.node.id), key(b.revision.side, b.node.id)));
  const selected = new Map<string, { candidate: Candidate; reasons: EvidenceItem['reasons'] }>();
  const queue: { candidate: Candidate; distance: number }[] = [];
  // The highest-ranked seeds enter first; traversed dependents are prioritized over weaker matches.
  for (const seed of seeds) {
    const id = key(seed.revision.side, seed.node.id);
    if (selected.has(id)) continue;
    if (selected.size >= maxResults) { limitations.add('Retrieval result limit reached.'); break; }
    selected.set(id, { candidate: seed, reasons: [...(seed.lexical > 0 ? ['lexical' as const] : []), ...(seed.semantic > 0 ? ['semantic' as const] : [])] });
    queue.push({ candidate: seed, distance: 0 });
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]; if (!item || item.distance >= depth) continue;
      const edges = item.candidate.revision.graph.edges.filter((e) => e.type === 'CALLS' && e.to === item.candidate.node.id).sort((a, b) => compare(a.id, b.id));
      for (const edge of edges) {
        const nextKey = key(item.candidate.revision.side, edge.from);
        const next = byKey.get(nextKey);
        if (!next || selected.has(nextKey)) continue;
        if (selected.size >= maxResults) { limitations.add('Retrieval result limit reached.'); continue; }
        selected.set(nextKey, { candidate: next, reasons: ['dependent'] });
        queue.push({ candidate: next, distance: item.distance + 1 });
      }
    }
    queue.length = 0;
  }
  let remaining = maxContext;
  const evidence: EvidenceItem[] = [];
  for (const { candidate: c, reasons } of selected.values()) {
    const snippet = c.snippet.slice(0, remaining); remaining -= snippet.length;
    if (snippet.length < c.snippet.length) limitations.add('Context character limit reached.');
    const surroundingSymbols: GraphNode[] = [];
    const seen = new Set([c.node.id]);
    let current = c.node.id;
    while (surroundingSymbols.length < 10) {
      const parent = c.revision.graph.edges.filter((e) => e.type === 'CONTAINS' && e.to === current && !seen.has(e.from)).sort((a, b) => compare(a.id, b.id))[0];
      const node = parent && c.revision.graph.nodes.find((n) => n.id === parent.from);
      if (!node) break;
      seen.add(node.id); current = node.id; surroundingSymbols.push(node);
    }
    evidence.push({ repositoryId: input.repository.id, revision: { side: c.revision.side, sha: c.revision.sha }, node: c.node, surroundingSymbols, path: c.path, startLine: c.start, endLine: c.end, snippet, truncated: c.truncated || snippet.length < c.snippet.length, reasons });
  }
  const relationships = revisions.flatMap((revision) => revision.graph.edges.filter((edge) => selected.has(key(revision.side, edge.from)) && selected.has(key(revision.side, edge.to))).map((edge) => ({ revision: { side: revision.side, sha: revision.sha }, edge })))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const unresolvedReferences = revisions.flatMap((revision) => revision.graph.unresolvedReferences.filter((ref) => selected.has(key(revision.side, ref.caller))).map((reference) => ({ revision: { side: revision.side, sha: revision.sha }, reference })))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const uniqueRelationships = [...new Map(relationships.map((item) => [JSON.stringify(item), item])).values()];
  const uniqueUnresolved = [...new Map(unresolvedReferences.map((item) => [JSON.stringify(item), item])).values()];
  const maxRelationships = maxResults * 10;
  if (uniqueRelationships.length > maxRelationships || uniqueUnresolved.length > maxRelationships) limitations.add('Relationship or unresolved reference limit reached.');
  return { question, repository: input.repository, baseSha: input.baseSha, headSha: input.headSha, evidence, relationships: uniqueRelationships.slice(0, maxRelationships), unresolvedReferences: uniqueUnresolved.slice(0, maxRelationships), limitations: [...limitations].sort(compare) };
}

/** Resolve refs once and read evidence only from those commit objects, never the worktree. */
export async function retrieveRevisionEvidence(repositoryPath: string, base: string, head: string, question: string, options: RetrievalOptions = {}): Promise<EvidencePackage> {
  const baseSha = await resolveCommitId(repositoryPath, base, 'base');
  const headSha = await resolveCommitId(repositoryPath, head, 'head');
  const graphs = await buildRevisionGraphs(repositoryPath, baseSha, headSha);
  const files = await new GitCliDiffProvider().diff(repositoryPath, baseSha, headSha);
  const readSource = await createRevisionSourceReader(repositoryPath);
  return retrieveEvidence({ repository: resolveRepositoryIdentity(repositoryPath), baseSha, headSha, ...graphs, changedSymbols: mapChangedSymbols(files, graphs.baseGraph, graphs.headGraph),
    readSource }, question, options);
}
