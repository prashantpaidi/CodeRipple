import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidRefError, NotAGitRepositoryError } from '../src/git/errors.js';
import {
  GitCliDiffProvider,
  restrictToPrefix,
  type GitDiffProvider,
} from '../src/git/git-diff-provider.js';
import { resolveGitRoots } from '../src/git/git-runner.js';
import { resolveAnalyzableSubtree } from '../src/git/revision-graph.js';
import type { ChangedFile } from '../src/git/types.js';
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

function configure(dir: string): void {
  git(dir, ['config', 'user.email', 'test@coderipple.dev']);
  git(dir, ['config', 'user.name', 'CodeRipple Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function makeRepo(): string {
  const dir = makeTempDir();
  // Portable accross Git versions that lack `init -b`.
  git(dir, ['init', '-q']);
  git(dir, ['branch', '-M', 'main']);
  configure(dir);
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

describe('restrictToPrefix', () => {
  const ranges = [{ startLine: 1, endLine: 1 }];

  it('reclassifies a rename leaving the subtree as DELETED', () => {
    const files: ChangedFile[] = [
      {
        oldPath: 'sub/a.ts',
        newPath: 'other/a.ts',
        changeType: 'RENAMED',
        oldRanges: ranges,
        newRanges: ranges,
      },
    ];

    expect(restrictToPrefix(files, 'sub')).toEqual([
      { oldPath: 'a.ts', changeType: 'DELETED', oldRanges: ranges, newRanges: [] },
    ]);
  });

  it('reclassifies a rename entering the subtree as ADDED', () => {
    const files: ChangedFile[] = [
      {
        oldPath: 'other/a.ts',
        newPath: 'sub/a.ts',
        changeType: 'RENAMED',
        oldRanges: ranges,
        newRanges: ranges,
      },
    ];

    expect(restrictToPrefix(files, 'sub')).toEqual([
      { newPath: 'a.ts', changeType: 'ADDED', oldRanges: [], newRanges: ranges },
    ]);
  });

  it('keeps an inside-to-inside rename as RENAMED', () => {
    const files: ChangedFile[] = [
      {
        oldPath: 'sub/a.ts',
        newPath: 'sub/b.ts',
        changeType: 'RENAMED',
        oldRanges: ranges,
        newRanges: ranges,
      },
    ];

    expect(restrictToPrefix(files, 'sub')).toEqual([
      {
        oldPath: 'a.ts',
        newPath: 'b.ts',
        changeType: 'RENAMED',
        oldRanges: ranges,
        newRanges: ranges,
      },
    ]);
  });

  it('omits an outside-to-outside rename', () => {
    const files: ChangedFile[] = [
      {
        oldPath: 'other/a.ts',
        newPath: 'other/b.ts',
        changeType: 'RENAMED',
        oldRanges: ranges,
        newRanges: ranges,
      },
    ];

    expect(restrictToPrefix(files, 'sub')).toEqual([]);
  });

  it('keeps inside changes and drops outside changes', () => {
    const files: ChangedFile[] = [
      { oldPath: 'sub/a.ts', newPath: 'sub/a.ts', changeType: 'MODIFIED', oldRanges: ranges, newRanges: ranges },
      { newPath: 'sub/new.ts', changeType: 'ADDED', oldRanges: [], newRanges: ranges },
      { oldPath: 'sub/gone.ts', changeType: 'DELETED', oldRanges: ranges, newRanges: [] },
      { oldPath: 'other/x.ts', newPath: 'other/x.ts', changeType: 'MODIFIED', oldRanges: ranges, newRanges: ranges },
    ];

    expect(restrictToPrefix(files, 'sub')).toEqual([
      { oldPath: 'a.ts', newPath: 'a.ts', changeType: 'MODIFIED', oldRanges: ranges, newRanges: ranges },
      { newPath: 'new.ts', changeType: 'ADDED', oldRanges: [], newRanges: ranges },
      { oldPath: 'gone.ts', changeType: 'DELETED', oldRanges: ranges, newRanges: [] },
    ]);
  });

  it('returns changes unchanged when the prefix is empty', () => {
    const files: ChangedFile[] = [
      { oldPath: 'other/a.ts', newPath: 'other/a.ts', changeType: 'MODIFIED', oldRanges: ranges, newRanges: ranges },
    ];

    expect(restrictToPrefix(files, '')).toEqual(files);
  });
});

describe('resolveAnalyzableSubtree', () => {
  it('returns the revision root for an empty prefix', () => {
    const root = makeTempDir();

    expect(resolveAnalyzableSubtree(root, '')).toBe(fs.realpathSync(root));
  });

  it('returns undefined for a missing subtree', () => {
    const root = makeTempDir();

    expect(resolveAnalyzableSubtree(root, 'sub')).toBeUndefined();
  });

  it('returns undefined when the subtree is a regular file', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'sub'), 'not a directory');

    expect(resolveAnalyzableSubtree(root, 'sub')).toBeUndefined();
  });

  it('resolves a symlinked subtree that stays inside the workspace', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync('real', path.join(root, 'sub'));

    expect(resolveAnalyzableSubtree(root, 'sub')).toBe(fs.realpathSync(path.join(root, 'real')));
  });

  it('rejects a symlinked subtree that escapes the workspace', () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    fs.symlinkSync(outside, path.join(root, 'sub'));

    expect(resolveAnalyzableSubtree(root, 'sub')).toBeUndefined();
  });
});

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

  it('reports a rename with content changes on both sides', async () => {
    const dir = makeRepo();
    write(
      dir,
      'src/old.ts',
      'export function keep(): number {\n  return 1;\n}\n\nexport function other(): number {\n  return 2;\n}\n',
    );
    commit(dir, 'base', 'base');
    fs.renameSync(path.join(dir, 'src/old.ts'), path.join(dir, 'src/new.ts'));
    write(
      dir,
      'src/new.ts',
      'export function keep(): number {\n  return 42;\n}\n\nexport function other(): number {\n  return 2;\n}\n',
    );
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');

    expect(files).toEqual([
      {
        oldPath: 'src/old.ts',
        newPath: 'src/new.ts',
        changeType: 'RENAMED',
        oldRanges: [{ startLine: 2, endLine: 2 }],
        newRanges: [{ startLine: 2, endLine: 2 }],
      },
    ]);
  });

  it('reclassifies renames that cross the analyzed subtree boundary', async () => {
    const dir = makeRepo();
    write(dir, 'sub/inside.ts', 'export function insideOne(): number {\n  return 1;\n}\n');
    write(dir, 'other/outside.ts', 'export function outsideOne(): number {\n  return 2;\n}\n');
    commit(dir, 'base', 'base');
    fs.renameSync(path.join(dir, 'sub/inside.ts'), path.join(dir, 'other/inside.ts'));
    fs.renameSync(path.join(dir, 'other/outside.ts'), path.join(dir, 'sub/outside.ts'));
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(path.join(dir, 'sub'), 'base', 'head');

    expect(files).toEqual([
      { oldPath: 'inside.ts', changeType: 'DELETED', oldRanges: [], newRanges: [] },
      { newPath: 'outside.ts', changeType: 'ADDED', oldRanges: [], newRanges: [] },
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

  it('handles paths containing a tab, double quote and backslash', async () => {
    const dir = makeRepo();
    const names = ['tab\tname.ts', 'quote"name.ts', 'back\\slash.ts'];
    for (const name of names) {
      write(dir, name, 'export const value = 1;\n');
    }
    commit(dir, 'base', 'base');
    for (const name of names) {
      write(dir, name, 'export const value = 2;\n');
    }
    commit(dir, 'head', 'head');

    const files = await new GitCliDiffProvider().diff(dir, 'base', 'head');
    const byPath = new Map(files.map((file) => [file.newPath, file]));

    for (const name of names) {
      const file = byPath.get(name);
      expect(file?.changeType).toBe('MODIFIED');
      expect(file?.oldRanges).toEqual([{ startLine: 1, endLine: 1 }]);
      expect(file?.newRanges).toEqual([{ startLine: 1, endLine: 1 }]);
    }
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

  it('produces an empty base graph when the subtree is absent in the base revision', async () => {
    const dir = makeRepo();
    write(dir, 'top.ts', 'export const top = 1;\n');
    commit(dir, 'base', 'base');
    write(dir, 'sub/src/a.ts', 'export function inSub(): void {}\n');
    commit(dir, 'head', 'head');

    const report = await detectChangedSymbols(path.join(dir, 'sub'), {
      base: 'base',
      head: 'head',
    });

    expect(report.changedFiles).toEqual([
      {
        newPath: 'src/a.ts',
        changeType: 'ADDED',
        oldRanges: [],
        newRanges: [{ startLine: 1, endLine: 1 }],
      },
    ]);
    expect(report.changedSymbols).toEqual([
      {
        nodeId: 'src/a.ts::inSub',
        nodeType: 'FUNCTION',
        changeType: 'ADDED',
        filePath: 'src/a.ts',
        changedRanges: [{ startLine: 1, endLine: 1 }],
      },
    ]);
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

  it('freezes refs so a branch moving mid-run cannot change the analyzed commit', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export function alpha(): void {}\n\nexport function beta(): void {\n  return 1;\n}\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'c1']);
    git(dir, ['branch', 'base']);

    write(dir, 'src/a.ts', 'export function beta(): void {\n  return 2;\n}\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'c2']);
    git(dir, ['branch', 'head']);

    write(dir, 'src/a.ts', 'export function gamma(): void {}\n\nexport function beta(): void {\n  return 1;\n}\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'c3']);
    const moved = git(dir, ['rev-parse', 'HEAD']).trim();

    const movingProvider: GitDiffProvider = {
      diff: async (repositoryPath, baseRef, headRef) => {
        git(repositoryPath, ['branch', '-f', 'base', moved]);
        return new GitCliDiffProvider().diff(repositoryPath, baseRef, headRef);
      },
    };

    const report = await detectChangedSymbols(dir, {
      base: 'base',
      head: 'head',
      diffProvider: movingProvider,
    });

    expect(git(dir, ['rev-parse', 'base']).trim()).toBe(moved);
    const deleted = report.changedSymbols
      .filter((symbol) => symbol.changeType === 'DELETED')
      .map((symbol) => symbol.nodeId);
    expect(deleted).toEqual(['src/a.ts::alpha']);
  });

  it('does not build graphs when no changed file has line ranges', async () => {
    const dir = makeRepo();
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    commit(dir, 'base', 'base');

    const emptyRangeFiles: ChangedFile[] = [
      { oldPath: 'src/a.ts', newPath: 'src/a.ts', changeType: 'MODIFIED', oldRanges: [], newRanges: [] },
      { oldPath: 'logo.png', newPath: 'logo.png', changeType: 'MODIFIED', oldRanges: [], newRanges: [] },
    ];
    let graphBuilds = 0;

    const report = await detectChangedSymbols(dir, {
      base: 'base',
      head: 'base',
      diffProvider: { diff: async () => emptyRangeFiles },
      buildGraphs: async () => {
        graphBuilds += 1;
        throw new Error('graphs must not be built for empty-range changes');
      },
    });

    expect(graphBuilds).toBe(0);
    expect(report.changedFiles).toEqual(emptyRangeFiles);
    expect(report.changedSymbols).toEqual([]);
    expect(report.baseRef).toBe('base');
    expect(report.headRef).toBe('base');
  });

  it('returns no symbols for a binary-only change', async () => {
    const dir = makeRepo();
    write(dir, 'logo.png', Buffer.from([1, 0, 2, 3]));
    commit(dir, 'base', 'base');
    write(dir, 'logo.png', Buffer.from([1, 0, 9, 9]));
    commit(dir, 'head', 'head');

    const report = await detectChangedSymbols(dir, { base: 'base', head: 'head' });

    expect(report.changedFiles).toEqual([
      { oldPath: 'logo.png', newPath: 'logo.png', changeType: 'MODIFIED', oldRanges: [], newRanges: [] },
    ]);
    expect(report.changedSymbols).toEqual([]);
  });
});

describeGit('resolveGitRoots path boundaries', () => {
  it('accepts a subdirectory whose name begins with dots', async () => {
    const dir = makeRepo();
    write(dir, '..cache/x.ts', 'export const x = 1;\n');

    const roots = await resolveGitRoots(path.join(dir, '..cache'));

    expect(roots.prefix).toBe('..cache');
    expect(roots.toplevel).toBe(fs.realpathSync(dir));
  });

  it('does not trim whitespace from the work-tree root path', async () => {
    const base = makeTempDir();
    const repoDir = path.join(base, 'repo ');

    fs.mkdirSync(repoDir);
    git(repoDir, ['init', '-q']);
    git(repoDir, ['branch', '-M', 'main']);
    configure(repoDir);
    write(repoDir, 'a.ts', 'export const a = 1;\n');
    git(repoDir, ['add', '-A']);
    git(repoDir, ['commit', '-qm', 'c1']);

    const roots = await resolveGitRoots(repoDir);

    expect(roots.prefix).toBe('');
    expect(roots.toplevel).toBe(fs.realpathSync(repoDir));
  });
});
