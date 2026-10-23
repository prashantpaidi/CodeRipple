import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { toPosixPath } from '../utils/paths.js';
import {
  GitCommandError,
  GitUnavailableError,
  InvalidRefError,
  NotAGitRepositoryError,
} from './errors.js';

const execFileAsync = promisify(execFile);

/** Cap on captured stdout; a large diff must never silently truncate. */
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/** True when the OS could not find the executable to launch. */
export function isMissingExecutable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOENT';
}

function firstLine(value: string): string {
  const line = value.split('\n').find((candidate) => candidate.trim() !== '');
  return line === undefined ? '' : line.trim();
}

/**
 * Reduce a child-process failure to a single actionable line, preferring the
 * tool's own stderr over the noisy Node error (which repeats the whole argv).
 */
export function commandFailureDetail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    return firstLine(stderr);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run `git -C <repositoryPath> <args...>` with an argument array (never a shell
 * string) and return captured stdout.
 */
export async function runGit(
  repositoryPath: string,
  args: readonly string[],
): Promise<string> {
  try {
    const result = await execFileAsync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      maxBuffer: DEFAULT_MAX_BUFFER,
      windowsHide: true,
    });
    return String(result.stdout);
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new GitUnavailableError('Git executable is not available on this system.', {
        cause: error,
      });
    }
    throw new GitCommandError(`git ${args[0] ?? ''} failed: ${commandFailureDetail(error)}`, {
      cause: error,
    });
  }
}

/** The git work-tree root and the repository path's location within it. */
export interface GitRoots {
  /** Canonical absolute path of the work-tree root. */
  toplevel: string;
  /** Path of the analyzed repository relative to `toplevel` (`''` at the root). */
  prefix: string;
}

/**
 * Resolve the git work-tree root for `repositoryPath` and the path's location
 * within it.
 *
 * The prefix translates work-tree-relative git paths (which is what
 * `git diff` emits) into paths relative to the analyzed repository, matching
 * CodeRipple node IDs.
 */
export async function resolveGitRoots(repositoryPath: string): Promise<GitRoots> {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(repositoryPath);
  } catch (error) {
    throw new NotAGitRepositoryError(`Repository path does not exist: ${repositoryPath}`, {
      cause: error,
    });
  }

  if (!fs.statSync(realRoot).isDirectory()) {
    throw new NotAGitRepositoryError(`Repository path is not a directory: ${repositoryPath}`);
  }

  let toplevel: string;
  try {
    toplevel = (await runGit(realRoot, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (error instanceof GitUnavailableError) {
      throw error;
    }
    throw new NotAGitRepositoryError(`Not a Git repository: ${repositoryPath}`, { cause: error });
  }

  const toplevelReal = fs.realpathSync(toplevel);
  const relative = toPosixPath(path.relative(toplevelReal, realRoot));
  if (relative === '' || relative === '.') {
    return { toplevel: toplevelReal, prefix: '' };
  }
  if (relative.startsWith('..')) {
    throw new NotAGitRepositoryError(
      `Repository path is outside its Git work tree: ${repositoryPath}`,
    );
  }
  return { toplevel: toplevelReal, prefix: relative };
}

/** Fail with an actionable message unless `ref` resolves to a commit. */
export async function verifyRef(
  repositoryPath: string,
  ref: string,
  label: 'base' | 'head',
): Promise<void> {
  try {
    await runGit(repositoryPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch (error) {
    if (error instanceof GitUnavailableError) {
      throw error;
    }
    throw new InvalidRefError(`Invalid ${label} ref: ${ref}`, { cause: error });
  }
}
