import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/cli/analyze.js';
import { analyzeImpactGraphs } from '../src/impact/impact-analysis.js';
import type { ChangedSymbol } from '../src/impact/types.js';

const repository = { id: 'fixture', name: 'fixture', rootPath: '/fixture', source: 'path' as const };

describe('affected test discovery', () => {
  it('uses resolved calls and lower-confidence imports, and reports undetected changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-tests-'));
    try {
      const files: Record<string, string> = {
        'src/service.ts': 'export function service() { return 1; }\nexport function unused() { return 2; }',
        'src/other.ts': 'export function other() { return 3; }',
        'src/consumer.ts': "import { service } from './service'; export function consumer() { return service(); }",
        'tests/service.test.ts': "import { service } from '../src/service'; test('service', () => service());",
        'tests/consumer.spec.js': "import { consumer } from '../src/consumer'; test('consumer', () => consumer());",
        '__tests__/fallback.ts': "import * as service from '../src/service'; const key = 'service'; service[key]();",
        'tests/module.test.mjs': "import { service } from '../src/service'; service();",
        'tests/unrelated.test.ts': "import { other } from '../src/other'; test('other', () => other());",
      };
      for (const [name, contents] of Object.entries(files)) {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
      }
      const graph = analyzeRepository(root).graph;
      const symbol = graph.nodes.find((node) => node.type === 'FUNCTION' && node.name === 'service');
      const other = graph.nodes.find((node) => node.type === 'FUNCTION' && node.name === 'other');
      if (!symbol || !other) throw new Error('Missing fixture symbols');
      const changes: ChangedSymbol[] = [symbol, other].map((node) => ({ nodeId: node.id, nodeType: node.type, changeType: 'MODIFIED', filePath: 'src/service.ts', changedRanges: [{ startLine: 1, endLine: 1 }] }));
      const run = (changedSymbols: ChangedSymbol[]) => analyzeImpactGraphs({ repository, baseSha: 'base', headSha: 'head', baseGraph: graph, headGraph: graph, changedSymbols, depth: 3 });
      const report = run([changes[0]!]);
      expect(report.testRecommendations.map((item) => [item.testFile, item.confidence])).toEqual(expect.arrayContaining([
        ['tests/service.test.ts', 'static-call'], ['tests/module.test.mjs', 'static-call'], ['tests/consumer.spec.js', 'static-call'], ['__tests__/fallback.ts', 'module-import'],
      ]));
      expect(report.testRecommendations.some((item) => item.testFile === 'tests/unrelated.test.ts')).toBe(false);
      const direct = report.testRecommendations.find((item) => item.testFile === 'tests/service.test.ts');
      expect(direct?.nodeIds).toEqual(['tests/service.test.ts', symbol.id]);
      expect(direct?.edges.map((edge) => edge.type)).toEqual(['CALLS']);
      const isolated = { ...graph, edges: graph.edges.filter((edge) => edge.to !== other.id && edge.to !== 'src/other.ts') };
      const empty = analyzeImpactGraphs({ repository, baseSha: 'base', headSha: 'head', baseGraph: isolated, headGraph: isolated, changedSymbols: [changes[1]!], depth: 3 });
      expect(empty.testRecommendations).toEqual([]);
      expect(empty.changesWithoutDetectedTests).toEqual([{ changedSymbolId: other.id, revision: { side: 'head', sha: 'head' } }]);
      expect(run([changes[0]!])).toEqual(report);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
