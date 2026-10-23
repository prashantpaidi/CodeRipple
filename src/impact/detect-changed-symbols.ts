import {
  GitCliDiffProvider,
  type GitDiffProvider,
} from '../git/git-diff-provider.js';
import { resolveCommitId } from '../git/git-runner.js';
import { buildRevisionGraphs, type RevisionGraphs } from '../git/revision-graph.js';
import type { ChangedFile } from '../git/types.js';
import { mapChangedSymbols } from './changed-symbol-mapper.js';
import type { ChangedSymbolReport } from './types.js';

/** Builds the base and head graphs for a revision range. */
export type RevisionGraphBuilder = (
  repositoryPath: string,
  baseRef: string,
  headRef: string,
) => Promise<RevisionGraphs>;

export interface DetectChangedSymbolsOptions {
  /** Revision to compare from. */
  base: string;
  /** Revision to compare to. */
  head: string;
  /** Override the git-backed provider (used by tests). */
  diffProvider?: GitDiffProvider;
  /** Override graph construction (used by tests). */
  buildGraphs?: RevisionGraphBuilder;
}

/** True when at least one changed file carries a line range to map. */
function hasChangableRanges(files: readonly ChangedFile[]): boolean {
  return files.some((file) => file.oldRanges.length > 0 || file.newRanges.length > 0);
}

/**
 * Detect which CodeRipple symbols changed between two revisions.
 *
 * This is the storage-independent pipeline: git diff -> {@link ChangedFile}s ->
 * base/head {@link CodeGraph}s -> {@link ChangedSymbol}s. Neo4j is never
 * involved; the graphs are built in isolated temporary directories.
 *
 * The user-provided refs are frozen to immutable commit IDs once, up front, so
 * the diff ranges and the analyzed graphs always refer to the same commits. The
 * original refs are preserved on the report for display.
 */
export async function detectChangedSymbols(
  repositoryPath: string,
  options: DetectChangedSymbolsOptions,
): Promise<ChangedSymbolReport> {
  const diffProvider = options.diffProvider ?? new GitCliDiffProvider();
  const buildGraphs = options.buildGraphs ?? buildRevisionGraphs;

  const baseCommit = await resolveCommitId(repositoryPath, options.base, 'base');
  const headCommit = await resolveCommitId(repositoryPath, options.head, 'head');

  const changedFiles = await diffProvider.diff(repositoryPath, baseCommit, headCommit);

  // An empty diff, a pure rename, or a binary-only change yields no line ranges
  // to map, so the graphs are never built and there can be no changed symbols.
  if (!hasChangableRanges(changedFiles)) {
    return {
      baseRef: options.base,
      headRef: options.head,
      changedFiles,
      changedSymbols: [],
    };
  }

  const { baseGraph, headGraph } = await buildGraphs(repositoryPath, baseCommit, headCommit);

  return {
    baseRef: options.base,
    headRef: options.head,
    changedFiles,
    changedSymbols: mapChangedSymbols(changedFiles, baseGraph, headGraph),
  };
}
