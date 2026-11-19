import { z } from 'zod';
import type { EdgeType } from '../graph/graph-types.js';
import type { ImpactLevel, ImpactReport } from '../impact/impact-report.js';

export const concerns = ['behavior', 'inputs', 'outputs', 'errors', 'module-contract'] as const;
export type ImpactConcern = (typeof concerns)[number];
export const maxFocus = 5;

export const selectionSchema = z.object({
  focus: z.array(z.object({
    pathId: z.string(),
    concern: z.enum(concerns),
  }).strict()).min(1).max(maxFocus),
}).strict();

type Revision = ImpactReport['impactPaths'][number]['revision'];

/** Privacy-filtered projection of the report. Repository names and paths use opaque IDs. */
export interface ExplanationContext {
  baseSha: string;
  headSha: string;
  risk: ImpactReport['risk']['category'];
  paths: {
    id: string;
    revision: Revision;
    changeType: ImpactReport['changedSymbols'][number]['changeType'];
    level: ImpactLevel;
    nodes: string[];
    edges: EdgeType[];
    evidenceIds: string[];
  }[];
  tests: {
    revision: Revision;
    changedNode: string;
    confidence: ImpactReport['testRecommendations'][number]['confidence'];
    fileId: string;
    nodes: string[];
    edges: EdgeType[];
    evidenceIds: string[];
  }[];
  evidence: {
    id: string;
    fileId: string;
    nodeId: string;
    revision: Revision;
    startLine: number;
    endLine: number;
    kind: 'declaration' | 'changed-lines' | 'file-excerpt';
    truncated: boolean;
    snippet?: string;
  }[];
  limitations: string[];
}

/** Return a selection of supplied paths and review concerns. The caller validates the result. */
export interface ExplanationProvider {
  explain(context: ExplanationContext, signal: AbortSignal): Promise<unknown>;
}
