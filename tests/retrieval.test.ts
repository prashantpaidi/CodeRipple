import { describe, expect, it, vi } from 'vitest';
import { createRevisionSourceReader } from '../src/git/git-runner.js';
import { retrieveEvidence, retrieveRevisionEvidence, type EmbeddingProvider, type RetrievalInput } from '../src/retrieval/evidence.js';
import { analyzeFixture, withGitRepository } from './helpers.js';
import { syntheticGraph } from './synthetic-graph.js';

const repo = { id: 'repo-a', name: 'a', rootPath: '/a', source: 'override' as const };
const graph = syntheticGraph(['validateUser', 'register', 'handler', 'other'], [['register', 'validateUser'], ['handler', 'register']]);
const source = 'function validateUser() {}\nfunction register() {}\nfunction handler() {}\nfunction other() {}';
const input: RetrievalInput = { repository: repo, baseSha: 'base', headSha: 'head', baseGraph: graph, headGraph: graph, changedSymbols: [], readSource: async () => source };
const fake: EmbeddingProvider = { embed: async (texts) => texts.map((text) => text.toLowerCase().includes('authentication') || text.startsWith('validateUser\n') ? [1, 0] : [0, 1]) };

describe('source-grounded retrieval', () => {
  it('returns callers and resolved call edges with source evidence deterministically', async () => {
    const readSource = vi.fn(input.readSource);
    const result = await retrieveEvidence({ ...input, readSource }, 'What depends on validateUser?');
    expect(result.evidence.map((e) => e.node.name)).toEqual(expect.arrayContaining(['validateUser', 'register', 'handler']));
    expect(result.relationships.filter((r) => r.edge.type === 'CALLS')).toHaveLength(2);
    expect(result.evidence.every((e) => e.revision.sha === 'head' && e.snippet.includes('validateUser'))).toBe(true);
    expect(readSource.mock.calls).toEqual([['head', 'src/graph-fixture.ts']]);
    expect(await retrieveEvidence(input, 'What depends on validateUser?')).toEqual(result);
  });
  it('retrieves deleted symbols and their callers only from base evidence', async () => {
    const head = syntheticGraph(['other'], []);
    const result = await retrieveEvidence({ ...input, headGraph: head, changedSymbols: [{ nodeId: 'src/graph-fixture.ts::validateUser', nodeType: 'FUNCTION', changeType: 'DELETED', filePath: 'src/graph-fixture.ts', changedRanges: [] }], readSource: async (sha) => sha === 'base' ? 'old validateUser source' : 'new source' }, 'validateUser');
    expect(result.evidence.map((e) => e.node.name)).toEqual(['validateUser', 'register', 'handler']);
    expect(result.evidence.every((e) => e.revision.sha === 'base' && e.snippet === 'old validateUser source')).toBe(true);
  });
  it('uses deterministic embeddings and isolates repositories and revision readers', async () => {
    const first = await retrieveEvidence(input, 'authentication', { embeddings: fake, maxResults: 2 });
    const second = await retrieveEvidence({ ...input, repository: { ...repo, id: 'repo-b' }, readSource: async () => 'different' }, 'authentication', { embeddings: fake, maxResults: 2 });
    expect(first.evidence[0]?.node.name).toBe('validateUser');
    expect(first.evidence.every((e) => e.repositoryId === 'repo-a')).toBe(true);
    expect(second.evidence.every((e) => e.repositoryId === 'repo-b' && e.snippet === 'different')).toBe(true);
  });
  it('bounds output and reports unavailable source', async () => {
    const result = await retrieveEvidence(input, 'validateUser', { maxResults: 2, maxContextChars: 5, maxSnippetChars: 20 });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.reduce((n, e) => n + e.snippet.length, 0)).toBeLessThanOrEqual(5);
    expect(result.limitations).toContain('Context character limit reached.');
    const missing = await retrieveEvidence({ ...input, readSource: async () => { throw new Error('missing'); } }, 'validateUser');
    expect(missing.evidence).toEqual([]);
    expect(missing.limitations).toContain('Source unavailable: head:src/graph-fixture.ts');
  });
  it('evaluates labelled lexical and semantic questions', async () => {
    const labels = [
      { question: 'What depends on validateUser?', expected: ['validateUser', 'register', 'handler'] },
      { question: 'authentication', expected: ['validateUser'] },
      { question: 'where is other?', expected: ['other'] },
    ];
    for (const label of labels) {
      const result = await retrieveEvidence(input, label.question, { embeddings: fake, maxResults: 4 });
      expect(result.evidence.map((e) => e.node.name)).toEqual(expect.arrayContaining(label.expected));
    }
  });

  it('keeps lexical results when an embedding batch fails or contains invalid vectors', async () => {
    const plain = await retrieveEvidence(input, 'validateUser');
    for (const embed of [
      async () => { throw new Error('provider unavailable'); },
      async (texts: readonly string[]) => texts.map((_, i) => i === 2 ? [NaN] : [1, 0]),
    ]) {
      const partial = await retrieveEvidence(input, 'validateUser', { embeddings: { embed } });
      expect(partial.evidence).toEqual(plain.evidence);
      expect(partial.relationships).toEqual(plain.relationships);
      expect(partial.limitations).toContain('Semantic retrieval unavailable. Using lexical matches and graph relationships.');
    }
  });
});

describe('GraphRAG evaluation on committed source', () => {
  const api = 'packages/api/service.ts::validate';
  const handler = 'packages/api/handler.ts::handleRequest';
  const test = 'packages/api/handler.test.ts::checkRequest';
  const loader = 'packages/worker/load.ts::loadWorker';

  it('checks ordered evidence IDs, graph expansion, semantic results and absent evidence', () => withGitRepository(async (repo) => {
    const base = repo.commit('baseline');
    repo.write('packages/api/service.ts', "export function validate() { return 'committed'; }\n");
    const head = repo.commit('change api');
    repo.write('packages/api/service.ts', "export function validate() { return 'uncommitted'; }\n");
    const embeddings: EmbeddingProvider = {
      embed: async ([question, ...texts]) => [[1, 0], ...texts.map((text) =>
        question === 'background execution' && text.startsWith('loadWorker\n') ? [1, 0] : [0, 1])],
    };
    const labels = [
      { question: 'Which callers depend on validate api?', ids: [api, handler, test], reasons: ['lexical', 'dependent', 'dependent'] },
      { question: 'background execution', ids: [loader], reasons: ['semantic'] },
      { question: 'unicorn compaction', ids: [], reasons: [] },
    ];
    for (const { question, ids, reasons } of labels) {
      const result = await retrieveRevisionEvidence(repo.path, base, head, question, { embeddings, maxResults: 3 });
      expect(result.evidence.map((item) => item.node.id)).toEqual(ids);
      expect(result.evidence.flatMap((item) => item.reasons)).toEqual(reasons);
      expect(result.evidence.every((item) => item.revision.sha === head)).toBe(true);
      if (ids.includes(api)) {
        expect(result.evidence[0]?.snippet).toContain("'committed'");
        expect(result.relationships.map(({ edge }) => [edge.from, edge.to])).toEqual([[test, handler], [handler, api]]);
      }
      if (ids.includes(loader)) {
        expect(result.unresolvedReferences).toEqual([expect.objectContaining({
          reference: expect.objectContaining({ caller: loader, reason: 'DYNAMIC_IMPORT' }),
        })]);
      }
    }
  }, 'reliability-project'));

  it('retains evidence from available files when a source reader throws synchronously', () => withGitRepository(async (repo) => {
    const sha = repo.commit('baseline');
    const readSource = await createRevisionSourceReader(repo.path);
    const headGraph = analyzeFixture('reliability-project');
    const missing = 'packages/api/handler.test.ts';
    const result = await retrieveEvidence({
      ...input, headSha: sha, headGraph,
      readSource(sha, file) {
        if (file === missing) throw new Error('missing file');
        return readSource(sha, file);
      },
    }, 'validate api', { maxResults: 2 });
    expect(result.evidence.map((item) => item.node.id)).toEqual([api, handler]);
    expect(result.relationships.map(({ edge }) => [edge.from, edge.to])).toEqual([[handler, api]]);
    expect(result.limitations).toContain(`Source unavailable: ${sha}:${missing}`);
  }, 'reliability-project'));
});
