import { parseGitDiff } from './diff-parser.js';
import { resolveGitRoots, runGit, verifyRef } from './git-runner.js';
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

function stripPrefix(value: string | undefined, prefix: string): string | undefined {
  if (value === undefined || prefix === '') {
    return value;
  }
  if (!withinPrefix(value, prefix)) {
    return undefined;
  }
  return value === prefix ? '' : value.slice(prefix.length + 1);
}

/**
 * Drop changes outside the analyzed repository and rebase surviving paths onto
 * it. A file whose base path is in the prefix but whose rename target is not
 * keeps only the side that is still relevant.
 */
function restrictToPrefix(files: readonly ChangedFile[], prefix: string): ChangedFile[] {
  if (prefix === '') {
    return [...files];
  }

  const result: ChangedFile[] = [];
  for (const file of files) {
    const oldPath = stripPrefix(file.oldPath, prefix);
    const newPath = stripPrefix(file.newPath, prefix);
    if (oldPath === undefined && newPath === undefined) {
      continue;
    }
    result.push({
      ...(oldPath === undefined ? {} : { oldPath }),
      ...(newPath === undefined ? {} : { newPath }),
      changeType: file.changeType,
      oldRanges: oldPath === undefined ? [] : file.oldRanges,
      newRanges: newPath === undefined ? [] : file.newRanges,
    });
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
    await verifyRef(repositoryPath, baseRef, 'base');
    await verifyRef(repositoryPath, headRef, 'head');

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
