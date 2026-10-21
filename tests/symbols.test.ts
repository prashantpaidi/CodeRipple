import { describe, expect, it } from 'vitest';

import type { GraphNode } from '../src/graph/graph-types.js';
import { analyzeFixture, nodeById } from './helpers.js';

function idsOfType(nodes: readonly GraphNode[], type: GraphNode['type']): string[] {
  return nodes
    .filter((node) => node.type === type)
    .map((node) => node.id)
    .sort();
}

describe('symbol extraction', () => {
  it('extracts top-level functions only', () => {
    const graph = analyzeFixture('calls-project');

    expect(idsOfType(graph.nodes, 'FUNCTION')).toEqual([
      'src/dynamic.ts::callUnknown',
      'src/dynamic.ts::dispatch',
      'src/dynamic.ts::notify',
      'src/dynamic.ts::readConfig',
      'src/main.ts::compute',
      'src/math.ts::add',
      'src/math.ts::square',
    ]);
  });

  it('extracts a function-valued const as a FUNCTION node', () => {
    const graph = analyzeFixture('basic-project');

    expect(idsOfType(graph.nodes, 'FUNCTION')).toEqual([
      'src/index.ts::bootstrap',
      'src/index.ts::createService',
      'src/index.ts::main',
      'src/user.ts::normalizeEmail',
    ]);
  });

  it('extracts classes with accurate line ranges', () => {
    const graph = analyzeFixture('basic-project');
    const node = nodeById(graph, 'src/user.ts::UserRepository');

    expect(node.type).toBe('CLASS');
    if (node.type !== 'CLASS') {
      throw new Error('expected a class node');
    }
    expect(node.name).toBe('UserRepository');
    expect(node.file).toBe('src/user.ts');
    expect(node.startLine).toBe(6);
    expect(node.endLine).toBe(20);
  });

  it('extracts methods, constructors, accessors, and static members', () => {
    const graph = analyzeFixture('classes-project');

    expect(idsOfType(graph.nodes, 'METHOD')).toEqual([
      'src/shapes.ts::Rectangle.area',
      'src/shapes.ts::Rectangle.constructor',
      'src/shapes.ts::Rectangle.create',
      'src/shapes.ts::Rectangle.describe',
      'src/shapes.ts::Rectangle.multiply',
      'src/shapes.ts::Rectangle.perimeter',
    ]);

    const method = nodeById(graph, 'src/shapes.ts::Rectangle.area');
    if (method.type !== 'METHOD') {
      throw new Error('expected a method node');
    }
    expect(method.parent).toBe('src/shapes.ts::Rectangle');
  });

  it('generates CONTAINS edges for files, classes, and methods', () => {
    const graph = analyzeFixture('basic-project');
    const containsIds = graph.edges
      .filter((edge) => edge.type === 'CONTAINS')
      .map((edge) => edge.id);

    expect(containsIds).toContain('CONTAINS:src/user.ts->src/user.ts::UserRepository');
    expect(containsIds).toContain(
      'CONTAINS:src/user.ts::UserRepository->src/user.ts::UserRepository.findByEmail',
    );
    expect(containsIds).toContain('CONTAINS:src/user.ts->src/user.ts::normalizeEmail');
  });
});
