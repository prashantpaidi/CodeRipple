import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeRepository } from '../src/cli/analyze.js';
import { validateCodeGraph } from '../src/graph/graph-schema.js';
import { analyzeImpactGraphs } from '../src/impact/impact-analysis.js';
import { graphNodeToProperties, propertiesToGraphNode } from '../src/storage/neo4j/neo4j-mapper.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function analyze(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-nest-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'app.ts'), source);
  return analyzeRepository(dir).graph;
}

describe('Nest route evidence', () => {
  it('traces a service change to a decorated handler and preserves it in storage', () => {
    const graph = analyze(`
import { Controller as C, Get as Read } from '@nestjs/common';
class Service { run() { return 1; } }
@C('users')
class Users { constructor(private service: Service) {} @Read(':id') get() { return this.service.run(); } }
`);
    expect(graph.version).toBe('2');
    const handler = graph.nodes.find((node) => node.id === 'app.ts::Users.get');
    expect(handler).toMatchObject({ route: { framework: 'nestjs', method: 'GET', controllerPath: 'users', handlerPath: ':id' } });
    if (!handler) throw new Error('Missing handler');
    expect(propertiesToGraphNode(graphNodeToProperties(handler, 'repo'))).toEqual(handler);
    const report = analyzeImpactGraphs({ repository: { id: 'repo', name: 'repo', rootPath: '/repo', source: 'path' }, baseSha: 'base', headSha: 'head', baseGraph: graph, headGraph: graph, changedSymbols: [{ nodeId: 'app.ts::Service.run', nodeType: 'METHOD', changeType: 'MODIFIED', filePath: 'app.ts', changedRanges: [{ startLine: 3, endLine: 3 }] }], depth: 2 });
    expect(report.affectedSymbols).toContainEqual(expect.objectContaining({ node: handler, level: 'directly-dependent' }));
    expect(() => validateCodeGraph({ ...graph, version: '1' })).toThrow();
  });
  it('does not treat unrelated or dynamic decorators as routes', () => {
    const graph = analyze(`
import { Controller, Get } from '@nestjs/common';
const dynamic = 'users';
@Controller(dynamic) class Dynamic { @Get('x') handler() {} }
@Controller('ok') class Mixed { @Get(dynamic) dynamic() {} }
`);
    expect(graph.version).toBe('1');
    expect(graph.nodes.some((node) => node.type === 'METHOD' && node.route)).toBe(false);
    const plain = analyze(`function Controller(_x: string): ClassDecorator { return () => {}; }\n@Controller('x') class Fake {}`);
    expect(plain.version).toBe('1');
  });
});
