import { z } from 'zod';
import { graphEdgeSchema, graphNodeSchema, unresolvedReferenceSchema } from '../graph/graph-schema.js';
import { NODE_TYPES } from '../graph/graph-types.js';
import { SYMBOL_CHANGE_TYPES } from './types.js';

export const IMPACT_LEVELS = ['directly-changed', 'directly-dependent', 'transitively-dependent', 'potential-module-impact', 'unknown/unresolved'] as const;
const revision = z.object({ side: z.enum(['base', 'head']), sha: z.string().min(1) }).strict();
const changedSymbol = z.object({
  nodeId: z.string().min(1), nodeType: z.enum(NODE_TYPES), changeType: z.enum(SYMBOL_CHANGE_TYPES),
  filePath: z.string().min(1), changedRanges: z.array(z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() }).strict()),
}).strict();
const impactPath = z.object({
  revision, changedSymbolId: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(1),
  edges: z.array(graphEdgeSchema), level: z.enum(IMPACT_LEVELS),
}).strict();
const affected = z.object({ node: graphNodeSchema, revision, level: z.enum(IMPACT_LEVELS) }).strict();

/** Canonical, storage-independent impact analysis contract. */
export const impactReportSchema = z.object({
  schemaVersion: z.literal('1'),
  repository: z.object({ id: z.string().min(1), name: z.string().min(1), rootPath: z.string().min(1), source: z.enum(['override', 'git-remote', 'path']) }).strict(),
  baseSha: z.string().min(1), headSha: z.string().min(1),
  changedSymbols: z.array(changedSymbol), affectedSymbols: z.array(affected), affectedFiles: z.array(affected),
  impactPaths: z.array(impactPath),
  traversal: z.object({ depth: z.number().int().nonnegative(), graphOptions: z.object({ ignoredDirectories: z.array(z.string()), respectGitignore: z.boolean() }).strict() }).strict(),
  unresolvedReferences: z.array(z.object({ revision, reference: unresolvedReferenceSchema }).strict()),
  limitations: z.array(z.string()),
}).strict();
export type ImpactReport = z.infer<typeof impactReportSchema>;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];
