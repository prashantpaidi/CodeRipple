import { describe, expect, it } from 'vitest';
import { retrieveEvidence, type EmbeddingProvider, type RetrievalInput } from '../src/retrieval/evidence.js';
import { syntheticGraph } from './synthetic-graph.js';

const repo = { id: 'repo-a', name: 'a', rootPath: '/a', source: 'override' as const };
const graph = syntheticGraph(['validateUser', 'register', 'handler', 'other'], [['register', 'validateUser'], ['handler', 'register']]);
const source = 'function validateUser() {}\nfunction register() {}\nfunction handler() {}\nfunction other() {}';
const input: RetrievalInput = { repository: repo, baseSha: 'base', headSha: 'head', baseGraph: graph, headGraph: graph, changedSymbols: [], readSource: async () => source };
const fake: EmbeddingProvider = { embed: async (texts) => texts.map((text) => text.toLowerCase().includes('authentication') || text.startsWith('validateUser\n') ? [1, 0] : [0, 1]) };

describe('source-grounded retrieval', () => {
  it('returns callers and resolved call edges with source evidence deterministically', async () => {
    const result = await retrieveEvidence(input, 'What depends on validateUser?');
    expect(result.evidence.map((e) => e.node.name)).toEqual(expect.arrayContaining(['validateUser', 'register', 'handler']));
    expect(result.relationships.filter((r) => r.edge.type === 'CALLS')).toHaveLength(2);
    expect(result.evidence.every((e) => e.revision.sha === 'head' && e.snippet.includes('validateUser'))).toBe(true);
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
});
