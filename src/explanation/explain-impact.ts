import { createHash } from 'node:crypto';
import { createRevisionSourceReader, isGitObjectId } from '../git/git-runner.js';
import type { ImpactReport } from '../impact/impact-report.js';
import type { RetrievalInput } from '../retrieval/evidence.js';
import { selectionSchema, type ExplanationContext, type ExplanationProvider, type ImpactConcern } from './provider.js';
import { projectSource, shareableSource } from './source.js';

type ImpactPath = ImpactReport['impactPaths'][number];
type TestRecommendation = ImpactReport['testRecommendations'][number];
type Revision = ImpactPath['revision'];

export interface ExplanationOptions {
  /** Explicit permission to send the filtered context to the configured provider. */
  enabled?: boolean;
  provider?: ExplanationProvider;
  excludePaths?: readonly string[];
  readSource?: RetrievalInput['readSource'];
}

export interface EvidenceReference {
  id: string;
  revision: Revision;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: 'declaration' | 'changed-lines' | 'file-excerpt';
}

export interface ImpactExplanation {
  summary: string;
  potentialImpact: { pathId: string; concern: ImpactConcern; interpretation: string }[];
  whyAffected: { pathId: string; path: ImpactPath; reason: string; evidenceIds: string[] }[];
  recommendedTests: { recommendation: TestRecommendation; evidenceIds: string[] }[];
  uncertainty: string[];
  evidence: EvidenceReference[];
}

export type ExplanationResult =
  | { status: 'disabled' }
  | { status: 'unavailable'; reason: 'provider-not-configured' | 'no-shareable-evidence' | 'provider-failed' | 'invalid-response' | 'evidence-failed' }
  | { status: 'available'; explanation: ImpactExplanation };

const maxPaths = 24;
const maxTests = 24;
const maxFiles = 24;
const maxSourceChars = 250_000;
const maxSnippetChars = 800;
const maxContextChars = 16_000;
const timeoutMs = 20_000;
const staticLimitations = [
  'Static paths describe resolved calls, structural containment or module imports. Runtime execution and reachability are unverified.',
  'Test suggestions come from static call or import evidence. Execution and assertion coverage are unknown.',
];

function opaqueId(kind: string, value: unknown): string {
  return `${kind}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
}

function nodeKey(revision: Revision, id: string): string {
  return JSON.stringify([revision.side, revision.sha, id]);
}

function shareableSha(sha: string): string {
  return isGitObjectId(sha) ? sha : opaqueId('revision', sha);
}

function shareableRevision({ side, sha }: Revision): Revision {
  return { side, sha: shareableSha(sha) };
}

function pathPriority(path: ImpactPath): number {
  if (path.edges[0]?.type === 'CALLS') return 0;
  if (path.edges[0]?.type === 'IMPORTS') return 1;
  return 2;
}

async function collectEvidence(report: ImpactReport, options: ExplanationOptions) {
  const canShare = shareableSource(options.excludePaths ?? []);
  const changed = new Map(report.changedSymbols.map((node) => [
    nodeKey(node.changeType === 'DELETED' ? { side: 'base', sha: report.baseSha } : { side: 'head', sha: report.headSha }, node.nodeId), node,
  ]));
  const affected = new Map([...report.affectedSymbols, ...report.affectedFiles].map(({ node, revision }) => [nodeKey(revision, node.id), node]));
  const references = new Map<string, EvidenceReference>();
  const context: ExplanationContext = {
    baseSha: shareableSha(report.baseSha), headSha: shareableSha(report.headSha), risk: report.risk.category,
    paths: [], tests: [], evidence: [],
    limitations: [...staticLimitations],
  };
  if (report.limitations.length) context.limitations.push(`Static analysis reported ${report.limitations.length} limitations.`);
  if (report.unresolvedReferences.length) context.limitations.push(`Static analysis recorded ${report.unresolvedReferences.length} unresolved references.`);
  if (report.changesWithoutDetectedTests.length) context.limitations.push(`No static test relationship was detected for ${report.changesWithoutDetectedTests.length} changes.`);
  const limitations = new Set<string>();
  const sourceCache = new Map<string, string[] | undefined>();
  let revisionReader: Promise<RetrievalInput['readSource']> | undefined;
  let remaining = maxContextChars;
  const byNode = new Map<string, string | undefined>();
  const paths = new Map<string, ImpactPath>();
  const tests: ImpactExplanation['recommendedTests'] = [];

  const fileFor = (revision: Revision, id: string, test?: TestRecommendation): string | undefined => {
    const key = nodeKey(revision, id);
    const node = affected.get(key);
    return (node?.type === 'FILE' ? node.path : node?.file) ?? changed.get(key)?.filePath ??
      (test?.nodeIds[0] === id ? test.testFile : undefined);
  };

  async function readLines(revision: Revision, filePath: string): Promise<string[] | undefined> {
    const key = JSON.stringify([revision.sha, filePath]);
    if (sourceCache.has(key)) return sourceCache.get(key);
    if (sourceCache.size >= maxFiles || remaining === 0) {
      limitations.add('Source snippets were limited by the explanation context budget.');
      return undefined;
    }
    let lines: string[] | undefined;
    try {
      const reader = options.readSource ?? await (revisionReader ??= createRevisionSourceReader(report.repository.rootPath));
      const source = await reader(revision.sha, filePath);
      if (source.length <= maxSourceChars && !source.includes('\0')) lines = projectSource(filePath, source);
    } catch {
      // Source errors can contain local paths or credential values.
    }
    if (!lines) limitations.add('Some source snippets were unavailable.');
    sourceCache.set(key, lines);
    return lines;
  }

  async function cite(revision: Revision, id: string, filePath: string): Promise<string | undefined> {
    const key = nodeKey(revision, id);
    if (byNode.has(key)) return byNode.get(key);
    const node = affected.get(key);
    const declaration = node?.type === 'FILE' ? undefined : node;
    const range = declaration ?? changed.get(key)?.changedRanges[0];
    const lines = await readLines(revision, filePath);
    if (!range && !lines) {
      byNode.set(key, undefined);
      return undefined;
    }
    const startLine = range?.startLine ?? 1;
    const endLine = range?.endLine ?? Math.min(lines?.length ?? 1, 40);
    const kind = declaration ? 'declaration' : range ? 'changed-lines' : 'file-excerpt';
    let snippet: string | undefined;
    let truncated = false;
    if (lines && startLine <= endLine && endLine <= lines.length) {
      const projected = lines.slice(startLine - 1, endLine).join('\n');
      snippet = projected.slice(0, Math.min(maxSnippetChars, remaining));
      remaining -= snippet.length;
      truncated = snippet.length < projected.length;
      if (truncated) limitations.add('Some source snippets were truncated.');
    } else if (lines) {
      limitations.add('Some source ranges were unavailable at the reported revision.');
    }
    const evidenceId = opaqueId('evidence', [key, filePath, startLine, endLine]);
    byNode.set(key, evidenceId);
    references.set(evidenceId, { id: evidenceId, revision, filePath, startLine, endLine, kind });
    context.evidence.push({
      id: evidenceId, fileId: opaqueId('file', filePath), nodeId: opaqueId('node', id),
      revision: shareableRevision(revision), startLine, endLine, kind, truncated, ...(snippet?.trim() ? { snippet } : {}),
    });
    return evidenceId;
  }

  async function citeChain(chain: ImpactPath | TestRecommendation, test?: TestRecommendation): Promise<string[] | undefined> {
    if (chain.nodeIds.length > 20) {
      limitations.add('Some paths exceeded the explanation context budget.');
      return undefined;
    }
    const files = chain.nodeIds.map((id) => fileFor(chain.revision, id, test));
    if (files.some((file) => !file || !canShare(file)) || (test && !canShare(test.testFile))) {
      limitations.add('Some paths or tests contained excluded or unavailable files.');
      return undefined;
    }
    const citations: string[] = [];
    for (const [index, id] of chain.nodeIds.entries()) {
      const file = files[index];
      const citation = file && await cite(chain.revision, id, file);
      if (citation) citations.push(citation);
    }
    return citations.length ? citations : undefined;
  }

  const candidates = report.impactPaths.filter((path) => path.edges[0]?.type !== 'CONTAINS')
    .sort((a, b) => pathPriority(a) - pathPriority(b));
  for (const path of candidates) {
    if (paths.size >= maxPaths) { limitations.add('Some paths were outside the explanation context budget.'); break; }
    const change = changed.get(nodeKey(path.revision, path.changedSymbolId));
    if (!change) continue;
    const evidenceIds = await citeChain(path);
    if (!evidenceIds) continue;
    const id = opaqueId('path', [path.revision, path.nodeIds, path.edges.map((edge) => edge.id)]);
    paths.set(id, path);
    context.paths.push({ id, revision: shareableRevision(path.revision), changeType: change.changeType, level: path.level,
      nodes: path.nodeIds.map((node) => opaqueId('node', node)), edges: path.edges.map((edge) => edge.type), evidenceIds });
  }

  const changesInContext = new Set([...paths.values()].map((path) => nodeKey(path.revision, path.changedSymbolId)));
  for (const recommendation of report.testRecommendations) {
    if (!changesInContext.has(nodeKey(recommendation.revision, recommendation.changedSymbolId))) continue;
    if (tests.length >= maxTests) { limitations.add('Some test suggestions were outside the explanation context budget.'); break; }
    const evidenceIds = await citeChain(recommendation, recommendation);
    if (!evidenceIds) continue;
    tests.push({ recommendation, evidenceIds });
    context.tests.push({ revision: shareableRevision(recommendation.revision), changedNode: opaqueId('node', recommendation.changedSymbolId),
      fileId: opaqueId('file', recommendation.testFile), confidence: recommendation.confidence,
      nodes: recommendation.nodeIds.map((node) => opaqueId('node', node)), edges: recommendation.edges.map((edge) => edge.type), evidenceIds });
  }
  context.limitations.push(...limitations);
  return { context, paths, references, tests };
}

const reviewInterpretations: Record<ImpactConcern, string> = {
  behavior: 'Observable behavior may change. Check the behavior along this path.',
  inputs: 'The change may affect which inputs are accepted. Check representative inputs and boundary cases.',
  outputs: 'The change may affect the result observed along this path. Check the expected outputs.',
  errors: 'The change may alter when errors occur or propagate. Check failure cases along this path.',
  'module-contract': 'A change to the module’s interface could affect its importer. Check compatibility with the interface it uses.',
};

function explainPath(path: ImpactPath): string {
  if (path.edges[0]?.type === 'CALLS') return 'A statically resolved call path leads from this dependent to the changed symbol.';
  if (path.edges[0]?.type === 'IMPORTS') return 'The file imports the module containing the changed symbol. This indicates potential module impact.';
  return 'The changed lines map directly to this symbol.';
}

/** Add an optional explanation after deterministic analysis has produced a canonical report. */
export async function explainImpactReport(report: ImpactReport, options: ExplanationOptions = {}): Promise<ExplanationResult> {
  if (options.enabled !== true) return { status: 'disabled' };
  const provider = options.provider;
  if (!provider) return { status: 'unavailable', reason: 'provider-not-configured' };
  let evidence: Awaited<ReturnType<typeof collectEvidence>>;
  try {
    evidence = await collectEvidence(report, options);
  } catch {
    return { status: 'unavailable', reason: 'evidence-failed' };
  }
  const { context, paths, references, tests } = evidence;
  if (!paths.size) return { status: 'unavailable', reason: 'no-shareable-evidence' };

  let selection: ReturnType<typeof selectionSchema.safeParse>;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('Explanation deadline exceeded')); }, timeoutMs);
      }),
      // Provider code cannot mutate the report or the evidence used to render results.
      provider.explain(structuredClone(context), controller.signal),
    ]);
    selection = selectionSchema.safeParse(result);
  } catch {
    return { status: 'unavailable', reason: 'provider-failed' };
  } finally {
    clearTimeout(timeout);
  }
  if (!selection.success) return { status: 'unavailable', reason: 'invalid-response' };

  const whyAffected: ImpactExplanation['whyAffected'] = [];
  const potentialImpact: ImpactExplanation['potentialImpact'] = [];
  const seenPaths = new Set<string>();
  const selectedChanges = new Set<string>();
  for (const { pathId, concern: selectedConcern } of selection.data.focus) {
    const path = paths.get(pathId);
    const candidate = context.paths.find((entry) => entry.id === pathId);
    if (!path || !candidate || seenPaths.has(pathId)) return { status: 'unavailable', reason: 'invalid-response' };
    seenPaths.add(pathId);
    selectedChanges.add(nodeKey(path.revision, path.changedSymbolId));
    whyAffected.push({ pathId, path, reason: explainPath(path), evidenceIds: candidate.evidenceIds });
    const concern = path.level === 'potential-module-impact' ? 'module-contract' :
      selectedConcern === 'module-contract' ? 'behavior' : selectedConcern;
    potentialImpact.push({ pathId, concern, interpretation: reviewInterpretations[concern] });
  }
  const recommendedTests = tests.filter(({ recommendation }) => selectedChanges.has(nodeKey(recommendation.revision, recommendation.changedSymbolId)));
  const usedEvidence = new Set([...whyAffected, ...recommendedTests].flatMap((item) => item.evidenceIds));
  const count = whyAffected.length;
  const summary = `The model highlighted ${count} of ${paths.size} supplied impact paths for review. The static risk estimate is ${report.risk.category}.`;
  return { status: 'available', explanation: {
    summary, potentialImpact, whyAffected, recommendedTests,
    uncertainty: [...context.limitations, ...report.limitations],
    evidence: [...references.values()].filter(({ id }) => usedEvidence.has(id)),
  } };
}
