import { describe, expect, it } from 'vitest';

import { impactReportSchema } from '../src/impact/impact-report.js';
import { runCli, withGitRepository } from './helpers.js';

const request = (id: number | string, method: string, params?: unknown) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const initialize = request('init', 'initialize', {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
});
const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
const call = (id: number, args: unknown) => request(id, 'tools/call', { name: 'analyze_impact', arguments: args });

describe('MCP over stdio', () => {
  it('negotiates, lists a read-only tool and serves the canonical CLI report', () => withGitRepository((repo) => {
    repo.write('target.ts', 'export function target() { return 1; }\n');
    const base = repo.commit('baseline');
    repo.write('target.ts', 'export function target() { return 2; }\n');
    const head = repo.commit('change');
    const env = { ...process.env, NEO4J_URI: '', NEO4J_PASSWORD: '', OPENAI_API_KEY: '' };
    const requestStream = [initialize, initialized, request(1, 'tools/list'), call(2, { base, head }), request(3, 'ping'), ''].join('\n');
    const mcp = runCli(['mcp', repo.path], env, requestStream);
    expect(mcp.status).toBe(0);
    expect(mcp.stderr).toBe('');
    const messages = mcp.stdout.trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(messages.map((message) => message.id)).toEqual(['init', 1, 2, 3]);
    expect(messages[0].result).toMatchObject({ protocolVersion: '2025-11-25', capabilities: { tools: {} } });
    expect(messages[1].result.tools).toEqual([expect.objectContaining({
      name: 'analyze_impact', annotations: { readOnlyHint: true, openWorldHint: false },
    })]);
    const report = impactReportSchema.parse(JSON.parse(messages[2].result.content[0].text));
    expect(report.changedSymbols.map((symbol) => symbol.nodeId)).toEqual(['target.ts::target']);
    const cli = runCli(['impact', repo.path, '--base', base, '--head', head, '--format', 'json'], env);
    expect(cli.status).toBe(0);
    expect(report).toEqual(JSON.parse(cli.stdout));
    expect(messages[3].result).toEqual({});
  }));

  it('recovers from malformed frames and rejects calls outside its repository and depth limits', () => withGitRepository((repo) => {
    const stream = [
      request(0, 'tools/list'), '{', '[]', 'x'.repeat(70_000), initialize, initialized,
      request(1, 'unknown'), call(2, { base: 'HEAD', head: 'HEAD', repository: '/outside' }),
      call(3, { base: 'HEAD', head: 'HEAD', depth: 11 }), call(4, { base: '--help', head: 'HEAD' }),
      request(5, 'ping'), '',
    ].join('\n');
    const mcp = runCli(['mcp', repo.path], process.env, stream);
    expect(mcp.status).toBe(0);
    const messages = mcp.stdout.trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(messages.map((message) => message.error?.code ?? message.id))
      .toEqual([-32002, -32700, -32600, -32600, 'init', -32601, 2, 3, 4, 5]);
    expect(messages.slice(6, 9).map((message) => message.result.isError)).toEqual([true, true, true]);
    expect(messages[8].result.content[0].text).toContain('Invalid base ref');
    expect(messages[9].result).toEqual({});
  }));
});
