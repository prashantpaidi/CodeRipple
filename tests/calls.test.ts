import { describe, expect, it } from 'vitest';

import type { CodeGraph } from '../src/graph/graph-types.js';
import { analyzeFixture } from './helpers.js';

function callsEdges(graph: CodeGraph): string[] {
  return graph.edges
    .filter((edge) => edge.type === 'CALLS')
    .map((edge) => edge.id);
}

describe('call resolution', () => {
  it('resolves same-file function calls', () => {
    expect(callsEdges(analyzeFixture('calls-project'))).toContain(
      'CALLS:src/math.ts::square->src/math.ts::add',
    );
    expect(callsEdges(analyzeFixture('basic-project'))).toContain(
      'CALLS:src/index.ts::bootstrap->src/index.ts::main',
    );
  });

  it('resolves imported function calls, including namespace imports', () => {
    const graph = analyzeFixture('calls-project');

    expect(callsEdges(graph)).toContain(
      'CALLS:src/calculator.ts::Calculator.addValue->src/math.ts::add',
    );
    expect(callsEdges(graph)).toContain(
      'CALLS:src/calculator.ts::Calculator.squareTotal->src/math.ts::square',
    );
  });

  it('resolves this.method() calls', () => {
    const graph = analyzeFixture('calls-project');

    expect(callsEdges(graph)).toContain(
      'CALLS:src/calculator.ts::Calculator.squareTotal->src/calculator.ts::Calculator.reset',
    );
  });

  it('resolves cross-class calls when the receiver type is known', () => {
    const graph = analyzeFixture('basic-project');

    expect(callsEdges(graph)).toContain(
      'CALLS:src/index.ts::main->src/auth.ts::AuthService.login',
    );
    expect(callsEdges(graph)).toContain(
      'CALLS:src/auth.ts::AuthService.login->src/user.ts::UserRepository.findByEmail',
    );
  });

  it('records unresolved references with typed reasons instead of guessing', () => {
    const graph = analyzeFixture('calls-project');
    const byExpression = new Map(
      graph.unresolvedReferences.map((reference) => [reference.expression, reference]),
    );

    expect(byExpression.get("mailer.send('hello')")).toMatchObject({
      caller: 'src/dynamic.ts::notify',
      reason: 'TARGET_NOT_RESOLVED',
    });
    expect(byExpression.get('handlers[key]()')).toMatchObject({
      caller: 'src/dynamic.ts::dispatch',
      reason: 'DYNAMIC_PROPERTY_ACCESS',
    });
    expect(byExpression.get("readFileSync(path, 'utf8')")).toMatchObject({
      caller: 'src/dynamic.ts::readConfig',
      reason: 'EXTERNAL_DEPENDENCY',
    });
    expect(byExpression.get('someGlobalFunction()')).toMatchObject({
      caller: 'src/dynamic.ts::callUnknown',
      reason: 'TARGET_NOT_RESOLVED',
    });
  });
});
