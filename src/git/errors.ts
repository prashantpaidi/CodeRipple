/**
 * Error hierarchy for CodeRipple's git-backed change detection.
 *
 * Every error carries an actionable, user-facing message and preserves its
 * underlying cause, so callers can tell a missing git executable apart from a
 * non-repository path, an unknown revision, or a failed diff.
 */
export class GitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The `git` (or `tar`) executable could not be found or started. */
export class GitUnavailableError extends GitError {}

/** The given path does not exist or is not inside a git work tree. */
export class NotAGitRepositoryError extends GitError {}

/** A revision (branch, tag, or commit) could not be resolved. */
export class InvalidRefError extends GitError {}

/** A git subprocess exited with a non-zero status. */
export class GitCommandError extends GitError {}

/** Materializing or analyzing a revision failed. */
export class RevisionAnalysisError extends GitError {}
