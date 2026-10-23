import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidArgumentError } from '../src/storage/errors.js';
import {
  normalizeGitRemote,
  resolveRepositoryIdentity,
} from '../src/storage/repository-identity.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderipple-identity-'));
  tempDirs.push(dir);
  return dir;
}

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function initRepoWithRemote(remote: string): string {
  const dir = fs.realpathSync(makeTempDir());
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

afterEach(() => {
  let dir = tempDirs.pop();
  while (dir !== undefined) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = tempDirs.pop();
  }
});

describe('normalizeGitRemote', () => {
  it('collapses SSH, scp-like, and HTTPS forms of the same repository', () => {
    const expected = 'github.com/prashantpaidi/CodeRipple';

    expect(normalizeGitRemote('git@github.com:prashantpaidi/CodeRipple.git')).toBe(expected);
    expect(normalizeGitRemote('ssh://git@github.com/prashantpaidi/CodeRipple.git')).toBe(expected);
    expect(normalizeGitRemote('https://github.com/prashantpaidi/CodeRipple.git')).toBe(expected);
    expect(normalizeGitRemote('https://github.com/prashantpaidi/CodeRipple')).toBe(expected);
    expect(normalizeGitRemote('https://user:token@github.com/prashantpaidi/CodeRipple.git')).toBe(
      expected,
    );
  });

  it('lowercases only the host, preserving the repository path case', () => {
    expect(normalizeGitRemote('git@GitHub.com:Owner/Repo.git')).toBe('github.com/Owner/Repo');
  });

  it('returns null for remotes it cannot normalize', () => {
    expect(normalizeGitRemote('')).toBeNull();
    expect(normalizeGitRemote('   ')).toBeNull();
    expect(normalizeGitRemote('/home/me/local-repo')).toBeNull();
    expect(normalizeGitRemote('file:///home/me/repo')).toBeNull();
    // Local filesystem remotes must not be read as `host/path`.
    expect(normalizeGitRemote('file://server/share/repo.git')).toBeNull();
    expect(normalizeGitRemote('C:\\repos\\app')).toBeNull();
    expect(normalizeGitRemote('C:/repos/app')).toBeNull();
  });
});

describe('resolveRepositoryIdentity', () => {
  it('honors an explicit override above every derived source', () => {
    const dir = makeTempDir();
    const identity = resolveRepositoryIdentity(dir, { override: 'my-pinned-repo' });

    expect(identity).toMatchObject({ id: 'my-pinned-repo', source: 'override' });
    expect(identity.rootPath).toBe(fs.realpathSync(dir));
  });

  it('falls back to a stable path hash outside a git working tree', () => {
    const dir = makeTempDir();
    const first = resolveRepositoryIdentity(dir);
    const second = resolveRepositoryIdentity(dir);

    expect(first.source).toBe('path');
    expect(first.id).toMatch(/^repo_[0-9a-f]{16}$/);
    expect(first.id).toBe(second.id);
    expect(first.name).toBe(path.basename(fs.realpathSync(dir)));
  });

  it('throws a clear error for a path that does not exist', () => {
    expect(() => resolveRepositoryIdentity('/definitely/not/here')).toThrow(
      InvalidArgumentError,
    );
  });

  it.skipIf(!gitAvailable())(
    'derives the same identity for two clones of the same remote',
    () => {
      const httpsClone = initRepoWithRemote('https://github.com/example/repo.git');
      const sshClone = initRepoWithRemote('git@github.com:example/repo.git');

      const first = resolveRepositoryIdentity(httpsClone);
      const second = resolveRepositoryIdentity(sshClone);

      expect(first.source).toBe('git-remote');
      expect(second.source).toBe('git-remote');
      expect(first.id).toBe(second.id);
      expect(first.id).not.toBe(resolveRepositoryIdentity(httpsClone, { override: 'x' }).id);
    },
  );

  it.skipIf(!gitAvailable())(
    'distinguishes subdirectories of the same git repository',
    () => {
      const repo = initRepoWithRemote('https://github.com/example/mono.git');
      const child = path.join(repo, 'packages', 'a');
      fs.mkdirSync(child, { recursive: true });

      const root = resolveRepositoryIdentity(repo);
      const sub = resolveRepositoryIdentity(child);

      expect(sub.source).toBe('git-remote');
      expect(sub.id).not.toBe(root.id);
      expect(resolveRepositoryIdentity(child).id).toBe(sub.id);
    },
  );
});
