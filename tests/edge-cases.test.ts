import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CodeGraph } from '../src/graph/graph-types.js';
import { analyzeImpact } from '../src/impact/impact-analysis.js';
import { analyzeFixture, withGitRepository } from './helpers.js';

function callsEdges(graph: CodeGraph): string[] {
  return graph.edges.filter((edge) => edge.type === 'CALLS').map((edge) => edge.id);
}

function importEdges(graph: CodeGraph): string[] {
  return graph.edges.filter((edge) => edge.type === 'IMPORTS').map((edge) => edge.id);
}

describe('adversarial resolution cases', () => {
  it('resolves inherited method calls to the declaring class', () => {
    expect(callsEdges(analyzeFixture('edge-cases-project'))).toContain(
      'CALLS:src/inheritance.ts::Derived.shout->src/inheritance.ts::Base.greet',
    );
  });

  it('attributes calls made inside callbacks to the enclosing function', () => {
    expect(callsEdges(analyzeFixture('edge-cases-project'))).toContain(
      'CALLS:src/callbacks.ts::useCallback->src/callbacks.ts::helper',
    );
  });

  it('does not model nested functions and records calls to them as unresolved', () => {
    const graph = analyzeFixture('edge-cases-project');

    expect(graph.nodes.map((node) => node.id)).not.toContain('src/nested.ts::inner');
    expect(graph.unresolvedReferences).toContainEqual({
      caller: 'src/nested.ts::outer',
      expression: 'inner()',
      line: 5,
      reason: 'TARGET_NOT_RESOLVED',
    });
    expect(callsEdges(graph)).toContain(
      'CALLS:src/nested.ts::outer->src/nested.ts::helper',
    );
  });

  it('records re-exports as file-level IMPORTS edges', () => {
    const ids = importEdges(analyzeFixture('edge-cases-project'));

    expect(ids).toContain('IMPORTS:src/reexport.ts->src/overloads.ts');
    expect(ids).toContain('IMPORTS:src/reexport.ts->src/accessors.ts');
  });

  it('resolves optional-chained and static calls with statically known receivers', () => {
    const ids = callsEdges(analyzeFixture('edge-cases-project'));

    expect(ids).toContain('CALLS:src/optional.ts::maybe->src/factory.ts::Factory.build');
    expect(ids).toContain(
      'CALLS:src/optional.ts::always->src/factory.ts::Factory.static:build',
    );
  });

  it('keeps same-named package symbols distinct and records incomplete and dynamic dependencies', () => {
    const graph = analyzeFixture('reliability-project');
    expect(graph.nodes.filter((node) => node.name === 'validate').map((node) => node.id))
      .toEqual(['packages/api/service.ts::validate', 'packages/worker/service.ts::validate']);
    expect(callsEdges(graph)).toEqual([
      'CALLS:packages/api/handler.test.ts::checkRequest->packages/api/handler.ts::handleRequest',
      'CALLS:packages/api/handler.ts::handleRequest->packages/api/service.ts::validate',
    ]);
    expect(graph.unresolvedReferences).toContainEqual({
      caller: 'packages/worker/load.ts::loadWorker', expression: 'import(modulePath)', line: 2, reason: 'DYNAMIC_IMPORT',
    });
    expect(graph.metadata.syntaxDiagnostics).toEqual([expect.objectContaining({
      file: 'packages/worker/incomplete.ts', code: expect.any(Number),
    })]);
  });

  it('scopes revision analysis to a monorepo package and surfaces parse limitations at the root', () => withGitRepository(async (repo) => {
    const base = repo.commit('baseline');
    repo.write('packages/api/service.ts', "export function validate() { return 'new api'; }\n");
    repo.write('packages/worker/service.ts', "export function validate() { return 'new worker'; }\n");
    const head = repo.commit('change both packages');
    const options = { base, head, depth: 3 };
    const report = await analyzeImpact(path.join(repo.path, 'packages/api'), options);
    expect(report.changedSymbols.map((symbol) => symbol.nodeId)).toEqual(['service.ts::validate']);
    expect(report.testRecommendations.map((test) => test.testFile)).toEqual(['handler.test.ts']);
    expect(report.limitations).toEqual([]);
    const root = await analyzeImpact(repo.path, options);
    expect(root.limitations).toEqual([
      expect.stringMatching(/^Incomplete syntax in base packages\/worker\/incomplete\.ts:/),
      expect.stringMatching(/^Incomplete syntax in head packages\/worker\/incomplete\.ts:/),
    ]);
  }, 'reliability-project'));
});
