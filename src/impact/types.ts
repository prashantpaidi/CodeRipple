import type { ChangedFile, ChangedLineRange } from '../git/types.js';
import type { NodeType } from '../graph/graph-types.js';

export const SYMBOL_CHANGE_TYPES = ['ADDED', 'MODIFIED', 'DELETED'] as const;
export type SymbolChangeType = (typeof SYMBOL_CHANGE_TYPES)[number];

/**
 * A CodeRipple symbol affected by a change.
 *
 * `nodeId`/`nodeType` come from the authoritative graph for the change kind:
 * the HEAD graph for ADDED and MODIFIED symbols, the BASE graph for DELETED
 * ones. `changedRanges` are the side-appropriate line ranges that mapped to the
 * symbol, deduplicated and sorted.
 */
export interface ChangedSymbol {
  nodeId: string;
  nodeType: NodeType;
  changeType: SymbolChangeType;
  filePath: string;
  changedRanges: ChangedLineRange[];
}

/** The complete result of a change-detection run. */
export interface ChangedSymbolReport {
  baseRef: string;
  headRef: string;
  changedFiles: ChangedFile[];
  changedSymbols: ChangedSymbol[];
}
