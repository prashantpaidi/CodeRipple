import { compareStrings } from '../utils/paths.js';
import { GitError } from './errors.js';
import type { ChangedFile, ChangedLineRange, FileChangeType } from './types.js';

/** One file's change classification, derived from `git diff --name-status -z`. */
export interface FileLevelChange {
  changeType: FileChangeType;
  oldPath?: string;
  newPath?: string;
}

/** One file's changed line ranges, derived from the unified patch body. */
export interface PatchFileRanges {
  oldPath?: string;
  newPath?: string;
  oldRanges: ChangedLineRange[];
  newRanges: ChangedLineRange[];
}

const NULL_DEVICE = '/dev/null';
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function singlePathChange(code: string, target: string): FileLevelChange {
  switch (code) {
    case 'A':
      return { changeType: 'ADDED', newPath: target };
    case 'D':
      return { changeType: 'DELETED', oldPath: target };
    case 'M':
    case 'T':
      return { changeType: 'MODIFIED', oldPath: target, newPath: target };
    default:
      throw new GitError(`Unsupported git change status: ${code}`);
  }
}

/**
 * Parse `git diff --name-status -z` output.
 *
 * `-z` separates every token with NUL, so paths containing spaces are preserved
 * verbatim and renames carry both paths. Similarity scores (`R087`) are ignored.
 */
export function parseNameStatus(output: string): FileLevelChange[] {
  const tokens = output.split('\0');
  const changes: FileLevelChange[] = [];
  let index = 0;

  while (index < tokens.length) {
    const status = tokens[index];
    if (status === undefined || status === '') {
      index += 1;
      continue;
    }

    const code = status.charAt(0);
    if (code === 'R') {
      const oldPath = tokens[index + 1];
      const newPath = tokens[index + 2];
      if (oldPath === undefined || newPath === undefined) {
        throw new GitError(`Malformed rename entry in git diff output: ${status}`);
      }
      changes.push({ changeType: 'RENAMED', oldPath, newPath });
      index += 3;
    } else {
      const target = tokens[index + 1];
      if (target === undefined) {
        throw new GitError(`Malformed entry in git diff output: ${status}`);
      }
      changes.push(singlePathChange(code, target));
      index += 2;
    }
  }

  return changes;
}

/**
 * Extract a repository path from a `---`/`+++` header line.
 *
 * Git terminates the path with a TAB when it contains a space (so it cannot be
 * mistaken for a timestamp); `/dev/null` means that side does not exist.
 */
function stripSidePrefix(value: string, prefix: string): string | undefined {
  const tabIndex = value.indexOf('\t');
  const rawPath = tabIndex === -1 ? value : value.slice(0, tabIndex);
  if (rawPath === NULL_DEVICE) {
    return undefined;
  }
  return rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
}

function countFrom(raw: string | undefined): number {
  return raw === undefined ? 1 : Number.parseInt(raw, 10);
}

/**
 * Convert a hunk header's start/count pair into a range, or `undefined` when the
 * side has zero lines. A zero-length side is a pure insertion/deletion and must
 * not invent a line range.
 */
function rangeFrom(start: number, count: number): ChangedLineRange | undefined {
  if (count <= 0) {
    return undefined;
  }
  return { startLine: start, endLine: start + count - 1 };
}

/**
 * Parse the unified patch body into per-file changed ranges.
 *
 * Only `@@` headers are interpreted; content lines (including removed lines that
 * begin with `--- `) are skipped. Header lines are only recognized before a
 * block's first hunk, which removes the classic `---`-in-content ambiguity.
 */
export function parsePatchRanges(patch: string): PatchFileRanges[] {
  const files: PatchFileRanges[] = [];
  let current: PatchFileRanges | undefined;
  let pushed = false;
  let inHunks = false;

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = undefined;
      pushed = false;
      inHunks = false;
      continue;
    }

    if (!inHunks && line.startsWith('--- ')) {
      current = {
        oldPath: stripSidePrefix(line.slice(4), 'a/'),
        newPath: undefined,
        oldRanges: [],
        newRanges: [],
      };
      pushed = false;
      continue;
    }

    if (!inHunks && line.startsWith('+++ ')) {
      if (current !== undefined) {
        current.newPath = stripSidePrefix(line.slice(4), 'b/');
      }
      continue;
    }

    const match = HUNK_HEADER.exec(line);
    if (match !== null) {
      inHunks = true;
      if (current === undefined) {
        continue;
      }

      const [, oldStartRaw, oldCountRaw, newStartRaw, newCountRaw] = match;
      if (oldStartRaw === undefined || newStartRaw === undefined) {
        continue;
      }

      const oldRange = rangeFrom(Number.parseInt(oldStartRaw, 10), countFrom(oldCountRaw));
      const newRange = rangeFrom(Number.parseInt(newStartRaw, 10), countFrom(newCountRaw));
      if (oldRange !== undefined) {
        current.oldRanges.push(oldRange);
      }
      if (newRange !== undefined) {
        current.newRanges.push(newRange);
      }
      if (!pushed) {
        files.push(current);
        pushed = true;
      }
    }
  }

  return files;
}

function rangeKey(oldPath: string | undefined, newPath: string | undefined): string {
  return `${oldPath ?? ''}\u0000${newPath ?? ''}`;
}

function dedupeSorted(ranges: readonly ChangedLineRange[]): ChangedLineRange[] {
  const seen = new Set<string>();
  const unique: ChangedLineRange[] = [];
  for (const range of ranges) {
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(range);
  }
  unique.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return unique;
}

function compareFiles(a: ChangedFile, b: ChangedFile): number {
  const pathA = a.newPath ?? a.oldPath ?? '';
  const pathB = b.newPath ?? b.oldPath ?? '';
  return compareStrings(pathA, pathB) || compareStrings(a.oldPath ?? '', b.oldPath ?? '');
}

/**
 * Combine name-status classification with patch hunk ranges into a
 * deterministic list of {@link ChangedFile}.
 *
 * The two git invocations share the same revision pair and rename detection, so
 * their path keys agree; a file with no textual hunks (binary, pure rename)
 * simply gets empty ranges.
 */
export function parseGitDiff(
  nameStatusOutput: string,
  patchOutput: string,
): ChangedFile[] {
  const patchByKey = new Map<string, PatchFileRanges>();
  for (const entry of parsePatchRanges(patchOutput)) {
    patchByKey.set(rangeKey(entry.oldPath, entry.newPath), entry);
  }

  const files = parseNameStatus(nameStatusOutput).map((change): ChangedFile => {
    const patch = patchByKey.get(rangeKey(change.oldPath, change.newPath));
    return {
      ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
      ...(change.newPath === undefined ? {} : { newPath: change.newPath }),
      changeType: change.changeType,
      oldRanges: patch === undefined ? [] : dedupeSorted(patch.oldRanges),
      newRanges: patch === undefined ? [] : dedupeSorted(patch.newRanges),
    };
  });

  files.sort(compareFiles);
  return files;
}
