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
  testRecommendations: z.array(z.object({
    changedSymbolId: z.string().min(1), revision, testFile: z.string().min(1),
    confidence: z.enum(['static-call', 'module-import']), reason: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).min(1), edges: z.array(graphEdgeSchema),
  }).strict()),
  changesWithoutDetectedTests: z.array(z.object({ changedSymbolId: z.string().min(1), revision }).strict()),
  traversal: z.object({ depth: z.number().int().nonnegative(), graphOptions: z.object({ ignoredDirectories: z.array(z.string()), respectGitignore: z.boolean() }).strict() }).strict(),
  unresolvedReferences: z.array(z.object({ revision, reference: unresolvedReferenceSchema }).strict()),
  limitations: z.array(z.string()),
  risk: z.object({ category: z.enum(['LOW', 'MEDIUM', 'HIGH']), indicators: z.object({ dependentCount: z.number().int().nonnegative(), minDepth: z.number().int().nonnegative().nullable(), maxDepth: z.number().int().nonnegative().nullable(), affectedFiles: z.number().int().nonnegative(), affectedModules: z.number().int().nonnegative(), apiEntryPoints: z.array(z.string()), affectedTests: z.number().int().nonnegative(), unresolvedCount: z.number().int().nonnegative(), changeTypes: z.array(z.enum(SYMBOL_CHANGE_TYPES)) }).strict(), reasons: z.array(z.string()) }).strict(),
}).strict();
export type ImpactReport = z.infer<typeof impactReportSchema>;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];
