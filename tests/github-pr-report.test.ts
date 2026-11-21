import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeReport, MAX_REPORT_BYTES, publishComment } from '../src/github/pr-comment.js';
import { buildPullRequestReport } from '../src/github/pr-report.js';
import { resolveMergeBase } from '../src/git/merge-base.js';

describe('GitHub PR impact report', () => {
  let directory: string;

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }

  function commit(message: string): string {
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  }

  function write(file: string, text: string): void {
    fs.writeFileSync(path.join(directory, file), text);
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-pr-test-'));
    git('init', '-qb', 'main');
    git('config', 'user.name', 'CodeRipple Test');
    git('config', 'user.email', 'test@coderipple.dev');
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('reports only the changes since the merge base with deterministic blast radius and tests', async () => {
    write('service.ts', 'export function service() { return 1; }\n');
    write('app.ts', "import { service } from './service';\nexport function app() { return service(); }\n");
    write('app.test.ts', "import { app } from './app';\napp();\n");
    const ancestor = commit('common ancestor');

    git('checkout', '-qb', 'pr');
    write('service.ts', 'export function service() { return 2; }\n');
    write('.gitignore', 'service.ts\n');
    const scriptMarker = path.join(directory, 'executed');
    write('package.json', JSON.stringify({ scripts: { postinstall: `touch "${scriptMarker}"` } }));
    const headSha = commit('PR update');

    git('checkout', '-q', 'main');
    write('unrelated.ts', 'export function baseOnly() { return 3; }\n');
    const baseTipSha = commit('unrelated base update');

    const revisions = { baseTipSha, headSha };
    const markdown = await buildPullRequestReport(directory, revisions);
    expect(markdown).toBe(await buildPullRequestReport(directory, revisions));
    expect(markdown).toContain(`PR base tip: ${baseTipSha}\nBase: ${ancestor}\nHead: ${headSha}\n`);
    expect(markdown).toContain('MODIFIED service.ts::service');
    expect(markdown).toContain('app.ts::app [head; directly-dependent]');
    expect(markdown).toContain('app.test.ts [static-call; service.ts::service]');
    expect(markdown).toContain('Risk: MEDIUM');
    expect(markdown).toContain('## Uncertainty');
    expect(markdown).not.toMatch(/unrelated\.ts|baseOnly/);
    expect(fs.existsSync(scriptMarker)).toBe(false);
    expect(decodeReport(Buffer.from(markdown).toString('base64'), revisions)).toBe(markdown);
  });

  it('labels unmapped changes and keeps PR-controlled Markdown on one inert line', async () => {
    write('README.md', 'base\n');
    const baseTipSha = commit('base');
    write('Z #12 ` @octocat\n[link](https:example.test).ts', 'export function changed() {}\n');
    write('broken.ts', 'export function pending() {\n  return unresolved(\n');
    fs.writeFileSync(path.join(directory, 'binary.dat'), Buffer.from([0, 1, 2]));
    const headSha = commit('head');

    const markdown = await buildPullRequestReport(directory, { baseTipSha, headSha });

    expect(markdown).toContain('- `` ADDED Z #12 ` @octocat\\u{a}[link](https:example.test).ts::changed');
    expect(markdown).not.toContain('\n[link]');
    expect(markdown).toContain('No changed symbol mapped for binary.dat');
    expect(markdown).toContain('Incomplete syntax in head broken.ts:');
    expect(markdown).toContain('Risk: MEDIUM');
  });

  it('rejects missing revisions, disconnected history, and shallow histories', async () => {
    write('main.ts', 'export const a = 1;\n');
    const baseTipSha = commit('base');
    await expect(buildPullRequestReport(directory, { baseTipSha, headSha: 'f'.repeat(40) }))
      .rejects.toThrow('Invalid head ref');

    git('checkout', '-q', '--orphan', 'other');
    const headSha = commit('unrelated root');
    await expect(buildPullRequestReport(directory, { baseTipSha, headSha })).rejects.toThrow('no common ancestor');

    git('branch', '-f', 'shallow', headSha);
    git('clone', '-q', '--depth=1', '-b', 'shallow', `file://${directory}`, 'shallow-copy');
    await expect(resolveMergeBase(path.join(directory, 'shallow-copy'), headSha, headSha))
      .rejects.toThrow('requires full Git history');
  });

  it('rejects histories with multiple best common ancestors', async () => {
    write('root.ts', 'export const root = 0;\n');
    const root = commit('root');
    write('left.ts', 'export const left = 1;\n');
    const left = commit('left');
    git('checkout', '-qb', 'right', root);
    write('right.ts', 'export const right = 1;\n');
    const right = commit('right');
    git('merge', '--no-ff', '-qm', 'right merges left', left);
    const headSha = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-qm', 'left merges right', right);
    const baseTipSha = git('rev-parse', 'HEAD');

    await expect(resolveMergeBase(directory, baseTipSha, headSha)).rejects.toThrow('unique merge base');
  });
});

describe('GitHub PR comment', () => {
  const marker = '<!-- coderipple-pr-impact -->';
  const revisions = { baseTipSha: 'a'.repeat(40), headSha: 'b'.repeat(40) };
  const markdown = `# CodeRipple impact report\n\nPR base tip: ${revisions.baseTipSha}\nBase: ${'c'.repeat(40)}\nHead: ${revisions.headSha}\n`;
  const publication = { ...revisions, apiUrl: 'https://api.github.com', repository: 'owner/repo', pullNumber: 12, token: 'test-token', markdown };
  const encode = (value: string) => Buffer.from(value).toString('base64');

  it('rejects empty, malformed, oversized, or mismatched report transfers', () => {
    expect(() => decodeReport('', revisions)).toThrow('empty');
    expect(() => decodeReport('not base64', revisions)).toThrow('Base64');
    expect(() => decodeReport(encode(`${markdown}${'💧'.repeat(MAX_REPORT_BYTES / 4)}`), revisions)).toThrow('48 KiB');
    expect(() => decodeReport(encode(markdown), { ...revisions, headSha: 'd'.repeat(40) })).toThrow('revisions');
    expect(() => decodeReport(encode(markdown), { ...revisions, baseTipSha: 'd'.repeat(40) })).toThrow('revisions');
  });

  it('creates once, updates the identified bot comment, and skips identical reruns', async () => {
    const bot = { login: 'github-actions[bot]', type: 'Bot' };
    const user = { login: 'reviewer', type: 'User' };
    const comments = Array.from({ length: 100 }, (_, id) => ({ id, user, body: `${marker}\nLeave me alone.` }));
    const writes: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/pulls/12')) {
        return Response.json({ state: 'open', base: { sha: revisions.baseTipSha }, head: { sha: revisions.headSha } });
      }
      if (init?.method === 'GET') {
        return Response.json(url.searchParams.get('page') === '1' ? comments.slice(0, 100) : comments.slice(100));
      }
      writes.push(`${init?.method} ${url.pathname}`);
      const { body } = JSON.parse(String(init?.body)) as { body: string };
      if (init?.method === 'POST') comments.push({ id: 100, user: bot, body });
      if (init?.method === 'PATCH') comments[100] = { id: 100, user: bot, body };
      return Response.json({ id: 100 });
    });

    expect(await publishComment(publication, fetcher)).toBe('created');
    expect(await publishComment(publication, fetcher)).toBe('unchanged');
    expect(await publishComment({ ...publication, markdown: '# CodeRipple impact report unavailable\n' }, fetcher)).toBe('updated');
    expect(comments).toHaveLength(101);
    expect(comments[100]?.body).toContain('report unavailable');
    expect(writes).toEqual(['POST /repos/owner/repo/issues/12/comments', 'PATCH /repos/owner/repo/issues/comments/100']);
  });

  it.each(['head', 'base'] as const)('skips publishing when the PR %s has moved', async (side) => {
    const pr = { state: 'open', base: { sha: revisions.baseTipSha }, head: { sha: revisions.headSha } };
    pr[side].sha = 'e'.repeat(40);
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method).toBe('GET');
      return Response.json(String(url).endsWith('/pulls/12') ? pr : []);
    });
    expect(await publishComment(publication, fetcher)).toBe('stale');
  });
});
