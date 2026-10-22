import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { toPosixPath } from '../utils/paths.js';
import { InvalidArgumentError } from './errors.js';

/** How a repository identity was derived. */
export type RepositoryIdentitySource = 'override' | 'git-remote' | 'path';

/**
 * Stable identity for a repository being indexed.
 *
 * CodeRipple's node IDs are repository-relative paths, so the same symbol in
 * two repositories (e.g. `src/auth.ts::validateToken`) produces the same node
 * ID. The repository identity namespaces those IDs so that multiple
 * repositories can coexist in one Neo4j database without colliding.
 */
export interface RepositoryIdentity {
  /** Namespacing key stored on every node (`ref = id::nodeId`). */
  id: string;
  /** Human-readable name (the repository root directory's basename). */
  name: string;
  /** Canonical absolute path of the repository root at index time. */
  rootPath: string;
  /** Which strategy produced the identity. */
  source: RepositoryIdentitySource;
}

export interface RepositoryIdentityOptions {
  /**
   * Explicit identity from `--repository-id`, taking precedence over any
   * derived value so operators can pin a repository across moves/machines.
   */
  override?: string;
}

const REPO_ID_PREFIX = 'repo_';
const REPO_ID_LENGTH = 16;

function hashToId(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');
  return `${REPO_ID_PREFIX}${digest.slice(0, REPO_ID_LENGTH)}`;
}

/**
 * Normalize a git remote URL to `host/owner/repo` so that the SSH and HTTPS
 * forms of the same repository resolve to the same identity.
 *
 * Returns `null` for remotes that cannot be normalized (local paths, `file://`,
 * unrecognized strings), in which case the caller falls back to a path hash.
 */
export function normalizeGitRemote(remote: string): string | null {
  const trimmed = remote.trim();
  if (trimmed === '') {
    return null;
  }

  let host: string;
  let repoPath: string;

  // scp-like syntax, e.g. `git@github.com:owner/repo.git`.
  const scpMatch = /^(?:[^@/]+@)?([^:/@]+):(.+)$/.exec(trimmed);
  if (!trimmed.includes('://') && scpMatch?.[1] !== undefined && scpMatch[2] !== undefined) {
    host = scpMatch[1];
    repoPath = scpMatch[2];
  } else {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    host = url.hostname;
    repoPath = url.pathname;
  }

  const normalizedHost = host.toLowerCase();
  const normalizedPath = repoPath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');

  if (normalizedHost === '' || normalizedPath === '') {
    return null;
  }

  return `${normalizedHost}/${normalizedPath}`;
}

function readGitRemote(rootDir: string): string | null {
  try {
    const output = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = output.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    // No git, no working tree, or no `origin` remote — fall back to the path.
    return null;
  }
}

/** Resolve the git working-tree root containing `rootDir`, if any. */
function readGitToplevel(rootDir: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = output.trim();
    return trimmed === '' ? null : fs.realpathSync(trimmed);
  } catch {
    return null;
  }
}

/**
 * Resolve a deterministic repository identity.
 *
 * Priority: explicit override -> normalized git `origin` remote combined with
 * the analyzed directory's path *within* the working tree -> hash of the
 * canonical absolute path.
 *
 * Combining the remote with the subpath keeps clones of the same repository
 * stable while still distinguishing two directories of one git repository
 * (e.g. two fixtures in a monorepo), whose repository-relative node IDs could
 * otherwise collide. A non-git repository gets a *different* identity if it is
 * moved (documented in the README).
 */
export function resolveRepositoryIdentity(
  rootDir: string,
  options: RepositoryIdentityOptions = {},
): RepositoryIdentity {
  const inputPath = path.resolve(rootDir);

  let rootPath: string;
  try {
    rootPath = fs.realpathSync(inputPath);
  } catch (error) {
    throw new InvalidArgumentError(`Repository path does not exist: ${rootDir}`, {
      cause: error,
    });
  }

  const name = path.basename(rootPath);
  const override = options.override?.trim();
  if (override !== undefined && override !== '') {
    return { id: override, name, rootPath, source: 'override' };
  }

  const remote = readGitRemote(rootPath);
  const normalizedRemote = remote === null ? null : normalizeGitRemote(remote);
  const toplevel = readGitToplevel(rootPath);
  if (normalizedRemote !== null && toplevel !== null) {
    const relative = toPosixPath(path.relative(toplevel, rootPath));
    const key = relative === '' ? normalizedRemote : `${normalizedRemote}/${relative}`;
    return { id: hashToId(key), name, rootPath, source: 'git-remote' };
  }

  return { id: hashToId(rootPath), name, rootPath, source: 'path' };
}
