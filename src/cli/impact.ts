import type { ImpactReport } from '../impact/impact-report.js';

/** Limit display only; JSON always contains the complete report. */
export function formatImpactReport(report: ImpactReport, format: 'text' | 'markdown', limit: number): string {
  const markdown = format === 'markdown';
  const rows = [markdown ? '# CodeRipple impact report' : 'CodeRipple impact report', '', `Base: ${report.baseSha}`, `Head: ${report.headSha}`, `Risk: ${report.risk.category} (heuristic, not a probability)`, ...report.risk.reasons.map((r) => `- ${r}`), '', `Dependents: ${report.risk.indicators.dependentCount}; depth: ${report.risk.indicators.minDepth ?? 'none'}–${report.risk.indicators.maxDepth ?? 'none'}; files: ${report.risk.indicators.affectedFiles}; potential modules: ${report.risk.indicators.affectedModules}; suggested tests: ${report.risk.indicators.affectedTests}; unresolved references: ${report.risk.indicators.unresolvedCount}`];
  const section = (title: string, items: string[]) => {
    rows.push('', markdown ? `## ${title}` : title);
    rows.push(...(items.length ? items.slice(0, limit).map((x) => `- ${x}`) : ['- None detected.']));
    if (items.length > limit) rows.push(`- ${items.length - limit} more omitted (use --limit to show more).`);
  };
  section('Changed symbols', report.changedSymbols.map((s) => `${s.changeType} ${s.nodeId} (${s.filePath})`));
  section('Affected dependents and files', [...report.affectedSymbols, ...report.affectedFiles].filter((x) => x.level !== 'directly-changed').map((x) => `${x.node.id} [${x.revision.side}; ${x.level}]`));
  section('Impact paths', report.impactPaths.filter((p) => p.edges.length > 0).map((p) => `${p.nodeIds.join(' → ')} [${p.revision.side}; ${p.edges.map((e) => e.type).join(', ')}]`));
  section('Suggested tests', report.testRecommendations.map((t) => `${t.testFile} [${t.confidence}; ${t.changedSymbolId}]`));
  section('Potential API entry points', report.risk.indicators.apiEntryPoints);
  section('Uncertainty', [...report.limitations, ...report.unresolvedReferences.map(({ revision, reference }) => `${revision.side}: ${reference.caller}: ${reference.expression} (${reference.reason})`), ...report.changesWithoutDetectedTests.map((x) => `No test detected for ${x.changedSymbolId} (${x.revision.side}).`), 'Static analysis can miss dynamic calls, exports and routes; API entry points are inferred from names and paths. Import impact is potential, not a proven call.']);
  return `${rows.join('\n')}\n`;
}
