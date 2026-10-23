import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidRefError, NotAGitRepositoryError } from '../src/git/errors.js';
import { GitCliDiffProvider } from '../src/git/git-diff-provider.js';
import { detectChangedSymbols } from '../src/impact/detect-changed-symbols.js';

const tempDirs: string[] = [];

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function makeTempDir(prefix = 'coderipple-diff-'): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

function makeRepo(): string {
  const dir = makeTempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@coderipple.dev']);
  git(dir, ['config', 'user.name', 'CodeRipple Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function write(dir: string, relativePath: string, content: string | Buffer): void {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(dir: string, message: string, tag: string): void {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', message]);
  git(dir, ['tag', tag]);
}

afterEach(() => {
  let dir = tempDirs.pop();
  while (dir !== undefined) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = tempDirs.pop();
  }
});

const describeGit = gitAvailable() ? describe : describe.skip;

describeGit('GitCliDiffProvider', () => {
  it('reports a modified file with per-side ranges', async () => {
    const dir = makeRepo();
    write(dir, 'src/service.ts', 'export function a(): number {\n  return 1;\n}\n');
    commit(dir, 'base', 'base');
    write(dir, 'src/service.ts', 'export function a(): number {\n  return 2;\n}\n');
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');

    expect(files).toEqual([
      {
        oldPath: 'src/service.ts',
        newPath: 'src/service.ts',
        changeType: 'MODIFIED',
        oldRanges: [{ startLine: 2, endLine: 2 }],
        newRanges: [{ startLine: 2, endLine: 2 }],
      },
    ]);
  });

  it('reports an added file as an addition with only new-side ranges', async () => {
    const dir = makeRepo();
    write(dir, 'keep.ts', 'export const keep = 1;\n');
    commit(dir, 'base', 'base');
    write(dir, 'src/new.ts', 'export function a() {}\nexport function b() {}\n');
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');
    const added = files.find((file) => file.newPath === 'src/new.ts');

    expect(added?.changeType).toBe('ADDED');
    expect(added?.oldRanges).toEqual([]);
    expect(added?.newRanges).toEqual([{ startLine: 1, endLine: 2 }]);
  });

  it('detects a pure file rename with no line ranges', async () => {
    const dir = makeRepo();
    write(dir, 'src/old.ts', 'export function a(): void {}\n');
    commit(dir, 'base', 'base');
    fs.renameSync(path.join(dir, 'src/old.ts'), path.join(dir, 'src/new.ts'));
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');

    expect(files).toEqual([
      {
        oldPath: 'src/old.ts',
        newPath: 'src/new.ts',
        changeType: 'RENAMED',
        oldRanges: [],
        newRanges: [],
      },
    ]);
  });

  it('handles paths containing spaces', async () => {
    const dir = makeRepo();
    write(dir, 'src/my file.ts', 'export function a(): number {\n  return 1;\n}\n');
    commit(dir, 'base', 'base');
    write(dir, 'src/my file.ts', 'export function a(): number {\n  return 2;\n}\n');
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');

    expect(files).toHaveLength(1);
    expect(files[0]?.newPath).toBe('src/my file.ts');
    expect(files[0]?.newRanges).toEqual([{ startLine: 2, endLine: 2 }]);
  });

  it('handles a modified binary file with no ranges', async () => {
    const dir = makeRepo();
    write(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    commit(dir, 'base', 'base');
    write(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x04, 0x05, 0x06]));
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');

    expect(files).toEqual([
      {
        oldPath: 'logo.png',
        newPath: 'logo.png',
        changeType: 'MODIFIED',
        oldRanges: [],
        newRanges: [],
      },
    ]);
  });

  it('returns nothing for an empty diff', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    commit(dir, 'base', 'base');

    expect(await new GitCliDiffProvider().diff(dir, 'main', 'main')).toEqual([]);
  });

  it('rejects an invalid base ref', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    commit(dir, 'base', 'base');

    await expect(new GitCliDiffProvider().diff(dir, 'nope', 'base')).rejects.toBeInstanceOf(
      InvalidRefError,
    );
  });

  it('rejects an invalid head ref', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    commit(dir, 'base', 'base');

    await expect(new GitCliDiffProvider().diff(dir, 'base', 'nope')).rejects.toBeInstanceOf(
      InvalidRefError,
    );
  });

  it('rejects a path that is not a git repository', async () => {
    const dir = makeTempDir();

    await expect(new GitCliDiffProvider().diff(dir, 'main', 'main')).rejects.toBeInstanceOf(
      NotAGitRepositoryError,
    );
  });

  it('rejects a path that does not exist', async () => {
    const dir = makeTempDir();

    await expect(
      new GitCliDiffProvider().diff(path.join(dir, 'missing'), 'main', 'main'),
    ).rejects.toBeInstanceOf(NotAGitRepositoryError);
  });
});

describeGit('detectChangedSymbols', () => {
  it('detects added, modified and deleted symbols across TypeScript and JavaScript', async () => {
    const dir = makeRepo();
    write(
      dir,
      'src/service.ts',
      'export function validateUser(email: string): boolean {\n  return email.length > 0;\n}\n',
    );
    write(
      dir,
      'src/auth.ts',
      'export class AuthService {\n  validateToken(token: string): boolean {\n    return token.length > 0;\n  }\n}\n',
    );
    write(dir, 'src/index.js', 'function greet(name) {\n  return "hi " + name;\n}\n');
    write(dir, 'src/legacy.ts', 'export function legacyLogin(): void {}\n');
    commit(dir, 'base', 'base');

    write(
      dir,
      'src/service.ts',
      'export function validateUser(email: string): boolean {\n  return email.includes("@");\n}\n',
    );
    write(
      dir,
      'src/auth.ts',
      'export class AuthService {\n  validateToken(token: string): boolean {\n    return token.trim().length > 0;\n  }\n}\n',
    );
    write(dir, 'src/index.js', 'function greet(name) {\n  return "hello " + name;\n}\n');
    write(dir, 'src/added.ts', 'export function resetPassword(): void {}\n');
    fs.rmSync(path.join(dir, 'src/legacy.ts'));
    commit(dir, 'head', 'head');

    const report = await detectChangedSymbols(dir, { base: 'base', head: 'head' });

    expect(report.changedFiles).toHaveLength(5);
    expect(report.changedSymbols.map((symbol) => `${symbol.changeType} ${symbol.nodeId}`)).toEqual([
      'MODIFIED src/auth.ts::AuthService.validateToken',
      'MODIFIED src/index.js::greet',
      'MODIFIED src/service.ts::validateUser',
      'ADDED src/added.ts::resetPassword',
      'DELETED src/legacy.ts::legacyLogin',
    ]);

    const method = report.changedSymbols.find(
      (symbol) => symbol.nodeId === 'src/auth.ts::AuthService.validateToken',
    );
    expect(method).toMatchObject({
      nodeType: 'METHOD',
      changeType: 'MODIFIED',
      filePath: 'src/auth.ts',
    });

    expect(report.changedSymbols.find((symbol) => symbol.changeType === 'ADDED')).toMatchObject({
      nodeId: 'src/added.ts::resetPassword',
      nodeType: 'FUNCTION',
      filePath: 'src/added.ts',
    });
    expect(report.changedSymbols.find((symbol) => symbol.changeType === 'DELETED')).toMatchObject({
      nodeId: 'src/legacy.ts::legacyLogin',
      nodeType: 'FUNCTION',
      filePath: 'src/legacy.ts',
    });
  });

  it('scopes detection to a repository path inside a work tree', async () => {
    const dir = makeRepo();
    write(dir, 'sub/src/a.ts', 'export function inSub(): number {\n  return 1;\n}\n');
    write(dir, 'other/src/b.ts', 'export function inOther(): number {\n  return 1;\n}\n');
    commit(dir, 'base', 'base');
    write(dir, 'sub/src/a.ts', 'export function inSub(): number {\n  return 2;\n}\n');
    write(dir, 'other/src/b.ts', 'export function inOther(): number {\n  return 2;\n}\n');
    commit(dir, 'head', 'head');

    const report = await detectChangedSymbols(path.join(dir, 'sub'), {
      base: 'base',
      head: 'head',
    });

    expect(report.changedFiles.map((file) => file.newPath)).toEqual(['src/a.ts']);
    expect(report.changedSymbols.map((symbol) => symbol.nodeId)).toEqual(['src/a.ts::inSub']);
  });

  it('yields no symbols for an entirely renamed file with unchanged content', async () => {
    const dir = makeRepo();
    write(dir, 'src/old.ts', 'export function a(): void {}\n');
    commit(dir, 'base', 'base');
    fs.renameSync(path.join(dir, 'src/old.ts'), path.join(dir, 'src/new.ts'));
    commit(dir, 'head', 'head');

    const report = await detectChangedSymbols(dir, { base: 'base', head: 'head' });

    expect(report.changedFiles.map((file) => file.changeType)).toEqual(['RENAMED']);
    expect(report.changedSymbols).toEqual([]);
  });

  it('leaves the working tree and surviving uncommitted changes untouched', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export function a(): number {\n  return 1;\n}\n');
    commit(dir, 'base', 'base');
    write(dir, 'src/a.ts', 'export function a(): number {\n  return 2;\n}\n');
    commit(dir, 'head', 'head');

    write(dir, 'src/a.ts', 'export function a(): number {\n  return 3; // uncommitted\n}\n');
    write(dir, 'src/untracked.ts', 'export const untracked = true;\n');

    const statusBefore = git(dir, ['status', '--porcelain']);
    const contentBefore = fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf8');

    await detectChangedSymbols(dir, { base: 'base', head: 'head' });

    expect(git(dir, ['status', '--porcelain'])).toBe(statusBefore);
    expect(fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf8')).toBe(contentBefore);
    expect(fs.existsSync(path.join(dir, 'src/untracked.ts'))).toBe(true);
  });

  it('removes its temporary workspaces', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export function a(): number {\n  return 1;\n}\n');
    commit(dir, 'base', 'base');
    write(dir, 'src/a.ts', 'export function a(): number {\n  return 2;\n}\n');
    commit(dir, 'head', 'head');

    const before = new Set(
      fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('coderipple-rev-')),
    );

    await detectChangedSymbols(dir, { base: 'base', head: 'head' });

    const created = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith('coderipple-rev-') && !before.has(name));
    expect(created).toEqual([]);
  });
});
