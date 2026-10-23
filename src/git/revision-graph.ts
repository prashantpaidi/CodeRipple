import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { analyzeRepository } from '../cli/analyze.js';
import { GRAPH_VERSION, type CodeGraph } from '../graph/graph-types.js';
import { GitUnavailableError, RevisionAnalysisError } from './errors.js';
import {
  commandFailureDetail,
  isMissingExecutable,
  resolveGitRoots,
  runGit,
} from './git-runner.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/** The base and head graphs produced for a revision range. */
export interface RevisionGraphs {
  baseGraph: CodeGraph;
  headGraph: CodeGraph;
}

function emptyGraph(): CodeGraph {
  return {
    version: GRAPH_VERSION,
    repository: { name: '' },
    nodes: [],
    edges: [],
    unresolvedReferences: [],
    metadata: {
      filesAnalyzed: 0,
      classes: 0,
      functions: 0,
      methods: 0,
      resolvedCalls: 0,
      unresolvedCalls: 0,
    },
  };
}

async function extractArchive(archivePath: string, directory: string): Promise<void> {
  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', directory], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new GitUnavailableError(
        'The `tar` executable is not available on this system.',
        { cause: error },
      );
    }
    throw new RevisionAnalysisError(
      `Failed to extract revision archive: ${commandFailureDetail(error)}`,
      { cause: error },
    );
  }
}

/** True when `candidate` is `root` itself or lies beneath it. */
function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * Resolve the subtree to analyze inside an extracted revision workspace.
 *
 * Returns `undefined` unless the selected subtree exists, is a directory, and
 * resolves (following symlinks) to a path contained within `revisionRoot`. A
 * symlink that escapes the workspace, a regular file, or a missing path all
 * yield `undefined` so the caller analyzes an empty graph instead of an
 * unintended location.
 */
export function resolveAnalyzableSubtree(
  revisionRoot: string,
  prefix: string,
): string | undefined {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(revisionRoot);
  } catch {
    return undefined;
  }
  if (!fs.statSync(realRoot).isDirectory()) {
    return undefined;
  }
  if (prefix === '') {
    return realRoot;
  }

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(path.join(revisionRoot, prefix));
  } catch {
    return undefined;
  }
  if (!isWithin(realRoot, realCandidate)) {
    return undefined;
  }
  try {
    if (!fs.statSync(realCandidate).isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return realCandidate;
}

async function analyzeRevision(
  gitCwd: string,
  ref: string,
  workspace: string,
  label: 'base' | 'head',
  prefix: string,
): Promise<CodeGraph> {
  const directory = path.join(workspace, label);
  await fs.promises.mkdir(directory, { recursive: true });

  const archivePath = path.join(workspace, `${label}.tar`);
  await runGit(gitCwd, ['archive', '--format=tar', `--output=${archivePath}`, ref]);
  await extractArchive(archivePath, directory);

  const target = resolveAnalyzableSubtree(directory, prefix);
  if (target === undefined) {
    return emptyGraph();
  }

  try {
    return analyzeRepository(target).graph;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RevisionAnalysisError(
      `Failed to analyze ${label} revision ${ref}: ${detail}`,
      { cause: error },
    );
  }
}

/**
 * Build the base and head code graphs for a revision range.
 *
 * Each revision is materialized with `git archive` (run from the work-tree
 * root, so the whole tree is captured) into an isolated temporary directory and
 * analyzed there. This never checks out, mutates, or cleans the user's working
 * tree, so uncommitted changes are untouched; the temporary workspace is
 * removed afterwards. When `repositoryPath` is a subdirectory of the work tree,
 * only that subtree is analyzed, so node paths match a direct `analyze` of it.
 */
export async function buildRevisionGraphs(
  repositoryPath: string,
  baseRef: string,
  headRef: string,
): Promise<RevisionGraphs> {
  const { toplevel, prefix } = await resolveGitRoots(repositoryPath);
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'coderipple-rev-'));

  try {
    const baseGraph = await analyzeRevision(toplevel, baseRef, workspace, 'base', prefix);
    const headGraph = await analyzeRevision(toplevel, headRef, workspace, 'head', prefix);
    return { baseGraph, headGraph };
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}
