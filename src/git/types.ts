/**
 * Git change-domain model.
 *
 * These types describe *what changed between two revisions* independently of
 * how the change was discovered (git CLI) and of the CodeRipple graph model.
 * Keeping them free of raw git output strings is what lets the changed-symbol
 * mapper be tested as pure logic.
 */

export const FILE_CHANGE_TYPES = ['ADDED', 'MODIFIED', 'DELETED', 'RENAMED'] as const;
export type FileChangeType = (typeof FILE_CHANGE_TYPES)[number];

/** A contiguous changed line range on one side of a diff. */
export interface ChangedLineRange {
  startLine: number;
  endLine: number;
}

/**
 * A single changed file.
 *
 * `oldRanges` are line ranges on the base side, `newRanges` on the head side;
 * zero-length sides (pure additions/deletions) contribute no range, so we never
 * invent a line that does not exist. `oldPath` is set for MODIFIED, DELETED and
 * RENAMED entries; `newPath` for MODIFIED, ADDED and RENAMED.
 */
export interface ChangedFile {
  oldPath?: string;
  newPath?: string;
  changeType: FileChangeType;
  oldRanges: ChangedLineRange[];
  newRanges: ChangedLineRange[];
}
