import { describe, expect, it } from 'vitest';
import type { CodeGraph, GraphEdge, GraphNode } from '../src/graph/graph-types.js';
import { analyzeImpactGraphs } from '../src/impact/impact-analysis.js';
import { impactReportSchema } from '../src/impact/impact-report.js';
import type { ChangedSymbol } from '../src/impact/types.js';

const repository = { id: 'repo-one', name: 'one', rootPath: '/one', source: 'path' as const };
const file: GraphNode = { id: 'a.ts', type: 'FILE', name: 'a.ts', path: 'a.ts' };
const fn = (id: string): GraphNode => ({ id, type: 'FUNCTION', name: id, file: 'a.ts', startLine: 1, endLine: 2 });
const edge = (type: GraphEdge['type'], from: string, to: string): GraphEdge => ({ id: `${type}:${from}:${to}`, type, from, to });
const graph = (extra: Partial<CodeGraph> = {}): CodeGraph => ({ version: '1', repository: { name: 'one' }, nodes: [file, fn('register'), fn('createUser'), fn('validateUser')], edges: [edge('CONTAINS', 'a.ts', 'register'), edge('CONTAINS', 'a.ts', 'createUser'), edge('CONTAINS', 'a.ts', 'validateUser'), edge('CALLS', 'register', 'createUser'), edge('CALLS', 'createUser', 'validateUser')], unresolvedReferences: [], metadata: { filesAnalyzed: 1, classes: 0, functions: 3, methods: 0, resolvedCalls: 2, unresolvedCalls: 0 }, ...extra });
const change = (nodeId: string, changeType: ChangedSymbol['changeType'] = 'MODIFIED'): ChangedSymbol => ({ nodeId, nodeType: 'FUNCTION', changeType, filePath: 'a.ts', changedRanges: [{ startLine: 1, endLine: 1 }] });
const run = (overrides: Partial<Parameters<typeof analyzeImpactGraphs>[0]> = {}) => analyzeImpactGraphs({ repository, baseSha: 'base-sha', headSha: 'head-sha', baseGraph: graph(), headGraph: graph(), changedSymbols: [change('validateUser')], depth: 3, ...overrides });

describe('impact analysis', () => {
  it('finds callers with real directed paths and bounded depth', () => {
    const report = run();
    expect(impactReportSchema.parse(report)).toEqual(report);
    expect(report.impactPaths).toContainEqual(expect.objectContaining({ nodeIds: ['register', 'createUser', 'validateUser'], level: 'transitively-dependent', revision: { side: 'head', sha: 'head-sha' }, edges: [edge('CALLS', 'register', 'createUser'), edge('CALLS', 'createUser', 'validateUser')] }));
    expect(run({ depth: 1 }).affectedSymbols.map((item) => item.node.id)).not.toContain('register');
  });
  it('uses the head for additions and modifications and base for deletions', () => {
    const headGraph = graph({ edges: [edge('CALLS', 'register', 'validateUser')] });
    for (const kind of ['ADDED', 'MODIFIED'] as const) {
      const result = run({ headGraph, changedSymbols: [change('validateUser', kind)] });
      expect(result.affectedSymbols.map((x) => x.node.id)).toContain('register');
      expect(result.affectedSymbols.map((x) => x.node.id)).not.toContain('createUser');
      expect(result.impactPaths.every((x) => x.revision.side === 'head')).toBe(true);
    }
    const result = run({ headGraph, changedSymbols: [change('validateUser', 'DELETED')] });
    expect(result.affectedSymbols.map((x) => x.node.id)).toContain('createUser');
    expect(result.impactPaths.every((x) => x.revision.side === 'base')).toBe(true);
  });
  it('deduplicates overlapping changes, terminates cycles, and sorts deterministically', () => {
    const g = graph();
    g.edges.push(edge('CALLS', 'validateUser', 'register'));
    const a = run({ headGraph: g, changedSymbols: [change('validateUser'), change('createUser')] });
    const b = run({ headGraph: { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() }, changedSymbols: [change('createUser'), change('validateUser')] });
    expect(a).toEqual(b);
    expect(a.affectedSymbols).toHaveLength(3);
    expect(a.impactPaths.every((p) => new Set(p.nodeIds).size === p.nodeIds.length)).toBe(true);
  });
  it('keeps imports potential and unresolved references separate', () => {
    const g = graph();
    g.nodes.push({ id: 'b.ts', type: 'FILE', name: 'b.ts', path: 'b.ts' });
    g.edges.push(edge('IMPORTS', 'b.ts', 'a.ts'));
    g.unresolvedReferences.push({ caller: 'register', expression: 'unknown()', line: 1, reason: 'TARGET_NOT_RESOLVED' });
    const result = run({ headGraph: g });
    expect(result.affectedFiles).toContainEqual(expect.objectContaining({ node: expect.objectContaining({ id: 'b.ts' }), level: 'potential-module-impact' }));
    expect(result.unresolvedReferences).toHaveLength(1);
  });
  it('reports unknown nodes and handles empty changes and repository isolation', () => {
    const unknown = run({ changedSymbols: [change('missing')] });
    expect(unknown.limitations.join()).toContain('missing');
    expect(unknown.affectedSymbols).toEqual([]);
    expect(run({ changedSymbols: [] }).impactPaths).toEqual([]);
    expect(run({ repository: { ...repository, id: 'other' } }).repository.id).toBe('other');
  });
  it('reports dangling edges without inventing a dependent', () => {
    const g = graph();
    g.edges.push(edge('CALLS', 'unknown', 'validateUser'));
    const result = run({ headGraph: g });
    expect(result.limitations.join()).toContain('unknown endpoint');
    expect(result.affectedSymbols.map((item) => item.node.id)).not.toContain('unknown');
  });
  it('adds a method’s class as structural context', () => {
    const g = graph();
    g.nodes.push({ id: 'C', type: 'CLASS', name: 'C', file: 'a.ts', startLine: 1, endLine: 4 }, { id: 'C.m', type: 'METHOD', name: 'm', file: 'a.ts', parent: 'C', startLine: 2, endLine: 3 });
    g.edges.push(edge('CONTAINS', 'a.ts', 'C'), edge('CONTAINS', 'C', 'C.m'), edge('CALLS', 'C.m', 'validateUser'));
    const result = run({ headGraph: g });
    expect(result.impactPaths).toContainEqual(expect.objectContaining({ nodeIds: ['C', 'C.m', 'validateUser'], edges: [edge('CONTAINS', 'C', 'C.m'), edge('CALLS', 'C.m', 'validateUser')] }));
  });
});

describe('risk indicators', () => {
  it('measures call depth and elevates deleted symbols', () => {
    const report = run({ changedSymbols: [change('validateUser', 'DELETED')] });
    expect(report.risk.category).toBe('HIGH');
    expect(report.risk.indicators).toMatchObject({ dependentCount: 2, minDepth: 1, maxDepth: 2, changeTypes: ['DELETED'] });
  });
  it('reports uncertainty and no invented API entries', () => {
    const result = run({ depth: 0 });
    expect(result.risk.category).toBe('MEDIUM');
    expect(result.risk.indicators).toMatchObject({ dependentCount: 0, minDepth: null, maxDepth: null, apiEntryPoints: [] });
    expect(run({ changedSymbols: [] }).risk.category).toBe('LOW');
  });
});
