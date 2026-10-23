import type { ChangedFile } from '../git/types.js';
import type {
  ChangedSymbol,
  ChangedSymbolReport,
  SymbolChangeType,
} from '../impact/types.js';

/** Group order mirrors the CLI example: MODIFIED, ADDED, DELETED. */
const GROUP_ORDER: readonly SymbolChangeType[] = ['MODIFIED', 'ADDED', 'DELETED'];

interface SerializedChangedFile {
  oldPath: string | null;
  newPath: string | null;
  changeType: ChangedFile['changeType'];
  oldRanges: ChangedFile['oldRanges'];
  newRanges: ChangedFile['newRanges'];
}

function serializeChangedFile(file: ChangedFile): SerializedChangedFile {
  return {
    oldPath: file.oldPath ?? null,
    newPath: file.newPath ?? null,
    changeType: file.changeType,
    oldRanges: file.oldRanges,
    newRanges: file.newRanges,
  };
}

function serializeChangedSymbol(symbol: ChangedSymbol): ChangedSymbol {
  return {
    nodeId: symbol.nodeId,
    nodeType: symbol.nodeType,
    changeType: symbol.changeType,
    filePath: symbol.filePath,
    changedRanges: symbol.changedRanges,
  };
}

function line(label: string, value: number): string {
  return `${`${label}:`.padEnd(17)}${value}`;
}

/** Render a change-detection report as stable, human-readable text. */
export function formatDiffReport(report: ChangedSymbolReport): string {
  const rows = [
    'CodeRipple Change Detection',
    '',
    `Base: ${report.baseRef}`,
    `Head: ${report.headRef}`,
    '',
    line('Changed files', report.changedFiles.length),
    line('Changed symbols', report.changedSymbols.length),
  ];

  if (report.changedSymbols.length === 0) {
    rows.push('', 'No changed symbols detected.');
    return rows.join('\n');
  }

  for (const changeType of GROUP_ORDER) {
    const group = report.changedSymbols.filter((symbol) => symbol.changeType === changeType);
    if (group.length === 0) {
      continue;
    }
    rows.push('', changeType);
    for (const symbol of group) {
      rows.push(`  ${symbol.nodeId}`);
    }
  }

  return rows.join('\n');
}

/** Render a change-detection report as deterministic, pretty-printed JSON. */
export function formatDiffReportJson(report: ChangedSymbolReport): string {
  const payload = {
    base: report.baseRef,
    head: report.headRef,
    changedFiles: report.changedFiles.map(serializeChangedFile),
    changedSymbols: report.changedSymbols.map(serializeChangedSymbol),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
