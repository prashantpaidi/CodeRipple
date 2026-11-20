import type { ImpactReport } from '../impact/impact-report.js';
import type { ExplanationResult } from '../explanation/explain-impact.js';

/** Limit display only; JSON always contains the complete report. */
export function formatImpactReport(
  report: ImpactReport,
  format: 'text' | 'markdown',
  limit: number,
  formatItem?: (item: string) => string,
): string {
  const markdown = format === 'markdown';
  const rows = [markdown ? '# CodeRipple impact report' : 'CodeRipple impact report', '', `Base: ${report.baseSha}`, `Head: ${report.headSha}`, `Risk: ${report.risk.category} (heuristic, not a probability)`, ...report.risk.reasons.map((r) => `- ${r}`), '', `Dependents: ${report.risk.indicators.dependentCount}; depth: ${report.risk.indicators.minDepth ?? 'none'}–${report.risk.indicators.maxDepth ?? 'none'}; files: ${report.risk.indicators.affectedFiles}; potential modules: ${report.risk.indicators.affectedModules}; suggested tests: ${report.risk.indicators.affectedTests}; unresolved references: ${report.risk.indicators.unresolvedCount}`];
  const section = (title: string, items: string[]) => {
    rows.push('', markdown ? `## ${title}` : title);
    rows.push(...(items.length ? items.slice(0, limit).map((x) => `- ${formatItem?.(x) ?? x}`) : ['- None detected.']));
    if (items.length > limit) rows.push(`- ${items.length - limit} more omitted${formatItem ? '' : ' (use --limit to show more)'}.`);
  };
  section('Changed symbols', report.changedSymbols.map((s) => `${s.changeType} ${s.nodeId} (${s.filePath})`));
  section('Affected dependents and files', [...report.affectedSymbols, ...report.affectedFiles].filter((x) => x.level !== 'directly-changed').map((x) => `${x.node.id}${x.node.type === 'METHOD' && x.node.route ? ` (NestJS ${x.node.route.method}, controller ${JSON.stringify(x.node.route.controllerPath)}, handler ${JSON.stringify(x.node.route.handlerPath)})` : ''} [${x.revision.side}; ${x.level}]`));
  section('Impact paths', report.impactPaths.filter((p) => p.edges.length > 0).map((p) => `${p.nodeIds.join(' → ')} [${p.revision.side}; ${p.edges.map((e) => e.type).join(', ')}]`));
  section('Suggested tests', report.testRecommendations.map((t) => `${t.testFile} [${t.confidence}; ${t.changedSymbolId}]`));
  section('Potential API entry points', report.risk.indicators.apiEntryPoints);
  section('Uncertainty', [...report.limitations, ...report.unresolvedReferences.map(({ revision, reference }) => `${revision.side}: ${reference.caller}: ${reference.expression} (${reference.reason})`), ...report.changesWithoutDetectedTests.map((x) => `No test detected for ${x.changedSymbolId} (${x.revision.side}).`), 'Static analysis can miss dynamic calls, exports and routes; API entry points are inferred from names and paths. Import impact is potential, not a proven call.']);
  return `${rows.join('\n')}\n`;
}

export function formatExplanation(result: ExplanationResult, format: 'text' | 'markdown', limit: number): string {
  const markdown = format === 'markdown';
  const rows = ['', markdown ? '## LLM-assisted explanation' : 'LLM-assisted explanation'];
  if (result.status === 'disabled') return '';
  if (result.status === 'unavailable') {
    const reasons: Record<typeof result.reason, string> = {
      'provider-not-configured': 'Set OPENAI_API_KEY and CODERIPPLE_OPENAI_MODEL to enable the provider.',
      'no-shareable-evidence': 'No shareable impact paths with source locations were found.',
      'provider-failed': 'The provider failed or timed out.',
      'invalid-response': 'The provider returned an invalid evidence selection.',
      'evidence-failed': 'Explanation evidence could not be prepared.',
    };
    return `${[...rows, `Unavailable. ${reasons[result.reason]}`].join('\n')}\n`;
  }
  const explanation = result.explanation;
  rows.push(explanation.summary);
  const evidence = new Map(explanation.evidence.map((item) => [item.id, item]));
  const cite = (ids: string[]): string => ids.map((id) => evidence.get(id)).filter((item) => item !== undefined)
    .map((item) => `${item.filePath}:${item.startLine}–${item.endLine} (${item.revision.side} ${item.revision.sha})`).join(', ');
  const section = (heading: string, items: string[]) => {
    rows.push('', markdown ? `### ${heading}` : heading, ...items.slice(0, limit).map((item) => `- ${item}`));
    if (items.length > limit) rows.push(`- ${items.length - limit} more omitted (use --limit to show more).`);
  };
  section('Potential impact (AI interpretation)', explanation.potentialImpact.map(({ pathId, interpretation }) => {
    const path = explanation.whyAffected.find((item) => item.pathId === pathId)?.path;
    return `${path?.nodeIds.join(' → ')}. ${interpretation}`;
  }));
  section('Why symbols are affected (static evidence)', explanation.whyAffected.map(({ path, reason, evidenceIds }) =>
    `${path.nodeIds.join(' → ')}. ${reason} See ${cite(evidenceIds)}.`));
  section('Recommended tests (static evidence)', explanation.recommendedTests.length
    ? explanation.recommendedTests.map(({ recommendation, evidenceIds }) =>
      `${recommendation.testFile} [${recommendation.confidence}]. See ${cite(evidenceIds)}.`)
    : ['No static test recommendation for the selected paths.']);
  section('Explanation uncertainty', explanation.uncertainty);
  return `${rows.join('\n')}\n`;
}
