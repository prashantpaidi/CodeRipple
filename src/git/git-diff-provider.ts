import { parseGitDiff } from './diff-parser.js';
import { resolveCommitId, resolveGitRoots, runGit } from './git-runner.js';
import type { ChangedFile } from './types.js';

/**
 * Discovers which files changed between two revisions.
 *
 * Implementations must return paths relative to the repository path they were
 * given, so the result lines up with CodeRipple node IDs.
 */
export interface GitDiffProvider {
  diff(repositoryPath: string, baseRef: string, headRef: string): Promise<ChangedFile[]>;
}

// `--no-color`/`--no-ext-diff`/`--no-textconv` keep the output machine-oriented;
// the explicit prefixes make header parsing independent of the user's config.
const COMMON_ARGS = ['--diff-filter=ADMRT', '-M'] as const;
const NAME_STATUS_ARGS = ['diff', '--name-status', '-z', ...COMMON_ARGS] as const;
const PATCH_ARGS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--unified=0',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  ...COMMON_ARGS,
] as const;

function withinPrefix(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`);
}

function stripPrefix(value: string, prefix: string): string {
  return value === prefix ? '' : value.slice(prefix.length + 1);
}

/**
 * Drop changes outside the analyzed repository and rebase surviving paths onto
 * it, preserving the {@link ChangedFile} contract for each change type.
 *
 * A rename that crosses the subtree boundary loses one side and is reclassified
 * accordingly: inside→outside becomes DELETED, outside→inside becomes ADDED,
 * inside→inside stays RENAMED, and outside→outside is omitted. Non-rename
 * changes are kept only when their relevant side is inside the subtree.
 */
export function restrictToPrefix(
  files: readonly ChangedFile[],
  prefix: string,
): ChangedFile[] {
  if (prefix === '') {
    return [...files];
  }

  const inside = (path: string | undefined): string | undefined =>
    path !== undefined && withinPrefix(path, prefix) ? stripPrefix(path, prefix) : undefined;

  const result: ChangedFile[] = [];
  for (const file of files) {
    const oldPath = inside(file.oldPath);
    const newPath = inside(file.newPath);

    switch (file.changeType) {
      case 'ADDED':
        if (newPath !== undefined) {
          result.push({
            newPath,
            changeType: 'ADDED',
            oldRanges: [],
            newRanges: file.newRanges,
          });
        }
        break;
      case 'DELETED':
        if (oldPath !== undefined) {
          result.push({
            oldPath,
            changeType: 'DELETED',
            oldRanges: file.oldRanges,
            newRanges: [],
          });
        }
        break;
      case 'MODIFIED':
        if (oldPath !== undefined && newPath !== undefined) {
          result.push({
            oldPath,
            newPath,
            changeType: 'MODIFIED',
            oldRanges: file.oldRanges,
            newRanges: file.newRanges,
          });
        }
        break;
      case 'RENAMED':
        if (oldPath !== undefined && newPath !== undefined) {
          result.push({
            oldPath,
            newPath,
            changeType: 'RENAMED',
            oldRanges: file.oldRanges,
            newRanges: file.newRanges,
          });
        } else if (oldPath !== undefined) {
          result.push({
            oldPath,
            changeType: 'DELETED',
            oldRanges: file.oldRanges,
            newRanges: [],
          });
        } else if (newPath !== undefined) {
          result.push({
            newPath,
            changeType: 'ADDED',
            oldRanges: [],
            newRanges: file.newRanges,
          });
        }
        break;
    }
  }
  return result;
}

/** {@link GitDiffProvider} backed by the installed `git` executable. */
export class GitCliDiffProvider implements GitDiffProvider {
  async diff(
    repositoryPath: string,
    baseRef: string,
    headRef: string,
  ): Promise<ChangedFile[]> {
    const prefix = (await resolveGitRoots(repositoryPath)).prefix;
    await resolveCommitId(repositoryPath, baseRef, 'base');
    await resolveCommitId(repositoryPath, headRef, 'head');

    // `core.quotePath=false` makes both invocations emit identical raw paths,
    // which is what lets the two outputs be joined by path.
    const nameStatus = await runGit(repositoryPath, [
      '-c',
      'core.quotePath=false',
      ...NAME_STATUS_ARGS,
      baseRef,
      headRef,
      '--',
    ]);
    const patch = await runGit(repositoryPath, [
      '-c',
      'core.quotePath=false',
      ...PATCH_ARGS,
      baseRef,
      headRef,
      '--',
    ]);

    return restrictToPrefix(parseGitDiff(nameStatus, patch), prefix);
  }
}
