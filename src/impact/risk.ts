import type { ImpactReport } from './impact-report.js';

/** Observable, deterministic indicators; categories are heuristics, not probabilities. */
export function assessRisk(report: Omit<ImpactReport, 'risk'>): ImpactReport['risk'] {
  const callPaths = report.impactPaths.filter((p) => p.edges.length > 0 && p.edges.every((e) => e.type === 'CALLS'));
  const dependents = new Set(callPaths.map((p) => `${p.revision.side}:${p.nodeIds[0]}`));
  const depths = callPaths.map((p) => p.edges.length);
  const apiEntryPoints = report.affectedSymbols.filter(({ node }) => /(^|\/)(api|routes?|controllers?)(\/|\.|$)/i.test(node.type === 'FILE' ? node.path : node.file) || /^(handle|controller|route)/i.test(node.name)).map(({ node, revision }) => `${revision.side}:${node.id}`).sort();
  const indicators = {
    dependentCount: dependents.size,
    minDepth: depths.length ? Math.min(...depths) : null,
    maxDepth: depths.length ? Math.max(...depths) : null,
    affectedFiles: new Set(report.affectedFiles.map((x) => `${x.revision.side}:${x.node.id}`)).size,
    affectedModules: report.affectedFiles.filter((x) => x.level === 'potential-module-impact').length,
    apiEntryPoints: [...new Set(apiEntryPoints)],
    affectedTests: new Set(report.testRecommendations.map((x) => x.testFile)).size,
    unresolvedCount: report.unresolvedReferences.length,
    changeTypes: [...new Set(report.changedSymbols.map((x) => x.changeType))].sort(),
  };
  const reasons: string[] = [];
  if (indicators.changeTypes.includes('DELETED')) reasons.push('A symbol was deleted.');
  if (indicators.dependentCount >= 10) reasons.push('At least 10 dependent symbols were detected.');
  if (indicators.affectedFiles >= 10) reasons.push('At least 10 files were affected.');
  if (indicators.apiEntryPoints.length) reasons.push('Potential API entry points were detected by name or path.');
  if (reasons.length) return { category: 'HIGH', indicators, reasons };
  if (indicators.dependentCount > 0) reasons.push('Dependent symbols were detected.');
  if (indicators.affectedModules > 0) reasons.push('Importing modules may be affected.');
  if (indicators.unresolvedCount > 0) reasons.push('Unresolved references leave impact uncertain.');
  if (report.limitations.length > 0) reasons.push('Analysis limitations leave impact uncertain.');
  if (report.changesWithoutDetectedTests.length > 0) reasons.push('Some changes have no detected tests.');
  if (reasons.length) return { category: 'MEDIUM', indicators, reasons };
  return { category: 'LOW', indicators, reasons: ['No elevated risk indicators were detected.'] };
}
