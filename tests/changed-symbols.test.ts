import { describe, expect, it } from 'vitest';

import type { ChangedFile, ChangedLineRange } from '../src/git/types.js';
import type { CodeGraph, GraphNode } from '../src/graph/graph-types.js';
import { mapChangedSymbols } from '../src/impact/changed-symbol-mapper.js';

function graphOf(nodes: GraphNode[]): CodeGraph {
  return {
    version: '1',
    repository: { name: 'test' },
    nodes,
    edges: [],
    unresolvedReferences: [],
    metadata: {
      filesAnalyzed: 0,
      classes: 0,
      functions: 0,
      methods: 0,
      resolvedCalls: 0,
      unresolvedCalls: 0,
    },
  };
}

/** A file with a class (two methods) and two top-level functions. */
function scenarioNodes(p: string, options: { g?: boolean; gone?: boolean } = {}): GraphNode[] {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const nodes: GraphNode[] = [
    { id: p, type: 'FILE', name, path: p },
    { id: `${p}::A`, type: 'CLASS', name: 'A', file: p, startLine: 1, endLine: 30 },
    { id: `${p}::A.m`, type: 'METHOD', name: 'm', file: p, parent: `${p}::A`, startLine: 5, endLine: 10 },
    { id: `${p}::A.n`, type: 'METHOD', name: 'n', file: p, parent: `${p}::A`, startLine: 12, endLine: 20 },
    { id: `${p}::f`, type: 'FUNCTION', name: 'f', file: p, startLine: 33, endLine: 40 },
  ];
  if (options.g !== false) {
    nodes.push({ id: `${p}::g`, type: 'FUNCTION', name: 'g', file: p, startLine: 42, endLine: 48 });
  }
  if (options.gone === true) {
    nodes.push({ id: `${p}::gone`, type: 'FUNCTION', name: 'gone', file: p, startLine: 50, endLine: 55 });
  }
  return nodes;
}

const PATH = 'src/a.ts';

function modified(ranges: ChangedLineRange[], oldRanges: ChangedLineRange[] = ranges): ChangedFile {
  return { oldPath: PATH, newPath: PATH, changeType: 'MODIFIED', oldRanges, newRanges: ranges };
}

function added(ranges: ChangedLineRange[], path = PATH): ChangedFile {
  return { newPath: path, changeType: 'ADDED', oldRanges: [], newRanges: ranges };
}

function deleted(ranges: ChangedLineRange[], path = PATH): ChangedFile {
  return { oldPath: path, changeType: 'DELETED', oldRanges: ranges, newRanges: [] };
}

const one = (startLine: number, endLine = startLine): ChangedLineRange => ({ startLine, endLine });

function idsOf(symbols: ReturnType<typeof mapChangedSymbols>): string[] {
  return symbols.map((symbol) => symbol.nodeId);
}

describe('most-specific symbol rule', () => {
  it('prefers a method over its containing class', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(5, 6)])], graph, graph);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      nodeId: `${PATH}::A.m`,
      nodeType: 'METHOD',
      changeType: 'MODIFIED',
    });
  });

  it('returns the class for a change outside any method', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(25)])], graph, graph);

    expect(idsOf(symbols)).toEqual([`${PATH}::A`]);
    expect(symbols[0]?.nodeType).toBe('CLASS');
  });

  it('falls back to the FILE node for module-level changes', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(31)])], graph, graph);

    expect(idsOf(symbols)).toEqual([PATH]);
    expect(symbols[0]?.nodeType).toBe('FILE');
    expect(symbols[0]?.filePath).toBe(PATH);
  });

  it('treats ranges touching an exact symbol boundary as overlapping', () => {
    const graph = graphOf(scenarioNodes(PATH));

    expect(idsOf(mapChangedSymbols([modified([one(10)])], graph, graph))).toEqual([
      `${PATH}::A.m`,
    ]);
    expect(idsOf(mapChangedSymbols([modified([one(33)])], graph, graph))).toEqual([
      `${PATH}::f`,
    ]);
    expect(idsOf(mapChangedSymbols([modified([one(40)])], graph, graph))).toEqual([
      `${PATH}::f`,
    ]);
  });
});

describe('change classification', () => {
  it('marks a symbol present in both graphs as MODIFIED', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(34, 35)])], graph, graph);

    expect(symbols).toEqual([
      {
        nodeId: `${PATH}::f`,
        nodeType: 'FUNCTION',
        changeType: 'MODIFIED',
        filePath: PATH,
        changedRanges: [one(34, 35)],
      },
    ]);
  });

  it('marks a head-only symbol as ADDED, from the head graph', () => {
    const base = graphOf(scenarioNodes(PATH, { g: false }));
    const head = graphOf(scenarioNodes(PATH, { g: true }));
    const symbols = mapChangedSymbols([added([one(43, 44)])], base, head);

    expect(symbols).toEqual([
      {
        nodeId: `${PATH}::g`,
        nodeType: 'FUNCTION',
        changeType: 'ADDED',
        filePath: PATH,
        changedRanges: [one(43, 44)],
      },
    ]);
  });

  it('marks a base-only symbol as DELETED, from the base graph', () => {
    const base = graphOf(scenarioNodes(PATH, { g: true }));
    const head = graphOf(scenarioNodes(PATH, { g: false }));
    const symbols = mapChangedSymbols([deleted([one(43, 44)])], base, head);

    expect(symbols).toEqual([
      {
        nodeId: `${PATH}::g`,
        nodeType: 'FUNCTION',
        changeType: 'DELETED',
        filePath: PATH,
        changedRanges: [one(43, 44)],
      },
    ]);
  });

  it('uses head-side ranges for a modification whose position shifted', () => {
    const base = graphOf([
      { id: PATH, type: 'FILE', name: 'a.ts', path: PATH },
      { id: `${PATH}::f`, type: 'FUNCTION', name: 'f', file: PATH, startLine: 33, endLine: 40 },
    ]);
    const head = graphOf([
      { id: PATH, type: 'FILE', name: 'a.ts', path: PATH },
      { id: `${PATH}::f`, type: 'FUNCTION', name: 'f', file: PATH, startLine: 43, endLine: 50 },
    ]);
    const symbols = mapChangedSymbols(
      [modified([one(44)], [one(34)])],
      base,
      head,
    );

    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.changeType).toBe('MODIFIED');
    expect(symbols[0]?.changedRanges).toEqual([one(44)]);
  });

  it('does not treat a still-present FILE node as ADDED when a line is inserted', () => {
    const base = graphOf([
      { id: PATH, type: 'FILE', name: 'a.ts', path: PATH },
      { id: `${PATH}::f`, type: 'FUNCTION', name: 'f', file: PATH, startLine: 1, endLine: 5 },
    ]);
    const head = graphOf([
      { id: PATH, type: 'FILE', name: 'a.ts', path: PATH },
      { id: `${PATH}::f`, type: 'FUNCTION', name: 'f', file: PATH, startLine: 2, endLine: 6 },
    ]);
    // A pure insertion at the top: no base-side range, head-side range is module level.
    const symbols = mapChangedSymbols([modified([one(1)], [])], base, head);

    expect(symbols).toEqual([
      {
        nodeId: PATH,
        nodeType: 'FILE',
        changeType: 'MODIFIED',
        filePath: PATH,
        changedRanges: [one(1)],
      },
    ]);
  });
});

describe('multiple symbols and deduplication', () => {
  it('returns every most-specific symbol a single hunk overlaps', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(8, 15)])], graph, graph);

    expect(idsOf(symbols)).toEqual([`${PATH}::A.m`, `${PATH}::A.n`]);
  });

  it('returns several symbols changed across one file', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(34), one(43)])], graph, graph);

    expect(idsOf(symbols)).toEqual([`${PATH}::f`, `${PATH}::g`]);
  });

  it('aggregates multiple hunks into one symbol without duplication', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(34), one(38, 39)])], graph, graph);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.nodeId).toBe(`${PATH}::f`);
    expect(symbols[0]?.changedRanges).toEqual([one(34), one(38, 39)]);
  });

  it('does not duplicate a symbol for repeated identical ranges', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([modified([one(34), one(34)])], graph, graph);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.changedRanges).toEqual([one(34)]);
  });
});

describe('whole-file changes', () => {
  it('maps an entirely added file against the head graph', () => {
    const base = graphOf([]);
    const head = graphOf(scenarioNodes(PATH));
    const symbols = mapChangedSymbols([added([one(1, 48)])], base, head);

    expect(idsOf(symbols)).toEqual([
      `${PATH}::A.m`,
      `${PATH}::A.n`,
      `${PATH}::f`,
      `${PATH}::g`,
    ]);
    expect(symbols.every((symbol) => symbol.changeType === 'ADDED')).toBe(true);
  });

  it('maps an entirely deleted file against the base graph', () => {
    const base = graphOf(scenarioNodes(PATH));
    const head = graphOf([]);
    const symbols = mapChangedSymbols([deleted([one(1, 48)])], base, head);

    expect(idsOf(symbols)).toEqual([
      `${PATH}::A.m`,
      `${PATH}::A.n`,
      `${PATH}::f`,
      `${PATH}::g`,
    ]);
    expect(symbols.every((symbol) => symbol.changeType === 'DELETED')).toBe(true);
  });

  it('reports a module-level file with no symbols as FILE', () => {
    const base = graphOf([]);
    const head = graphOf([{ id: PATH, type: 'FILE', name: 'a.ts', path: PATH }]);
    const symbols = mapChangedSymbols([added([one(1, 5)])], base, head);

    expect(symbols).toEqual([
      {
        nodeId: PATH,
        nodeType: 'FILE',
        changeType: 'ADDED',
        filePath: PATH,
        changedRanges: [one(1, 5)],
      },
    ]);
  });
});

describe('renamed files', () => {
  it('maps old ranges to the base path and new ranges to the head path', () => {
    const from = 'src/a.ts';
    const to = 'src/b.ts';
    const base = graphOf(scenarioNodes(from));
    const head = graphOf(scenarioNodes(to));
    const symbols = mapChangedSymbols(
      [{ oldPath: from, newPath: to, changeType: 'RENAMED', oldRanges: [one(5)], newRanges: [one(5)] }],
      base,
      head,
    );

    expect(symbols).toEqual([
      {
        nodeId: `${to}::A.m`,
        nodeType: 'METHOD',
        changeType: 'ADDED',
        filePath: to,
        changedRanges: [one(5)],
      },
      {
        nodeId: `${from}::A.m`,
        nodeType: 'METHOD',
        changeType: 'DELETED',
        filePath: from,
        changedRanges: [one(5)],
      },
    ]);
  });
});

describe('non-symbol changes', () => {
  it('returns nothing for a changed file with no graph nodes', () => {
    const graph = graphOf(scenarioNodes(PATH));
    const readme: ChangedFile = {
      oldPath: 'README.md',
      newPath: 'README.md',
      changeType: 'MODIFIED',
      oldRanges: [one(1)],
      newRanges: [one(1)],
    };

    expect(mapChangedSymbols([readme], graph, graph)).toEqual([]);
  });

  it('returns nothing when there are no changed ranges', () => {
    const graph = graphOf(scenarioNodes(PATH));

    expect(mapChangedSymbols([modified([], [])], graph, graph)).toEqual([]);
  });
});

describe('deterministic ordering', () => {
  it('orders by change type then node id, and is stable across runs', () => {
    const base = graphOf(scenarioNodes(PATH, { g: false, gone: true }));
    const head = graphOf(scenarioNodes(PATH, { g: true, gone: false }));
    const files = [modified([one(5), one(43)], [one(5), one(51)])];

    const first = mapChangedSymbols(files, base, head);
    const second = mapChangedSymbols(files, base, head);

    expect(first.map((symbol) => `${symbol.changeType} ${symbol.nodeId}`)).toEqual([
      `MODIFIED ${PATH}::A.m`,
      `ADDED ${PATH}::g`,
      `DELETED ${PATH}::gone`,
    ]);
    expect(second).toEqual(first);
  });
});
