import { describe, expect, it } from 'vitest';

import type { CodeGraph } from '../src/graph/graph-types.js';
import { analyzeFixture } from './helpers.js';

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
});
