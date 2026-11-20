import { GitCommandError } from './errors.js';
import { isGitObjectId, resolveCommitId, runGit } from './git-runner.js';

/** Resolve a three-dot comparison from two immutable branch tips. */
export async function resolveMergeBase(repository: string, base: string, head: string) {
  if ((await runGit(repository, ['rev-parse', '--is-shallow-repository'])).trim() === 'true') {
    throw new GitCommandError('Pull request comparison requires full Git history.');
  }
  const [baseTipSha, headSha] = await Promise.all([
    resolveCommitId(repository, base, 'base'),
    resolveCommitId(repository, head, 'head'),
  ]);

  let output: string;
  try {
    output = await runGit(repository, ['merge-base', '--all', baseTipSha, headSha]);
  } catch (error) {
    if (error instanceof GitCommandError && (error.cause as { code?: number })?.code === 1) {
      throw new GitCommandError('The pull request revisions have no common ancestor.', { cause: error });
    }
    throw error;
  }

  const baseSha = output.trim();
  if (!isGitObjectId(baseSha)) {
    throw new GitCommandError('The pull request revisions do not have a unique merge base.');
  }
  return { baseTipSha, baseSha, headSha };
}
