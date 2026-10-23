import {
  GitCliDiffProvider,
  type GitDiffProvider,
} from '../git/git-diff-provider.js';
import { buildRevisionGraphs } from '../git/revision-graph.js';
import { mapChangedSymbols } from './changed-symbol-mapper.js';
import type { ChangedSymbolReport } from './types.js';

export interface DetectChangedSymbolsOptions {
  /** Revision to compare from. */
  base: string;
  /** Revision to compare to. */
  head: string;
  /** Override the git-backed provider (used by tests). */
  diffProvider?: GitDiffProvider;
}

/**
 * Detect which CodeRipple symbols changed between two revisions.
 *
 * This is the storage-independent pipeline: git diff -> {@link ChangedFile}s ->
 * base/head {@link CodeGraph}s -> {@link ChangedSymbol}s. Neo4j is never
 * involved; the graphs are built in isolated temporary directories.
 */
export async function detectChangedSymbols(
  repositoryPath: string,
  options: DetectChangedSymbolsOptions,
): Promise<ChangedSymbolReport> {
  const diffProvider = options.diffProvider ?? new GitCliDiffProvider();
  const changedFiles = await diffProvider.diff(repositoryPath, options.base, options.head);

  if (changedFiles.length === 0) {
    return {
      baseRef: options.base,
      headRef: options.head,
      changedFiles,
      changedSymbols: [],
    };
  }

  const { baseGraph, headGraph } = await buildRevisionGraphs(
    repositoryPath,
    options.base,
    options.head,
  );

  return {
    baseRef: options.base,
    headRef: options.head,
    changedFiles,
    changedSymbols: mapChangedSymbols(changedFiles, baseGraph, headGraph),
  };
}
