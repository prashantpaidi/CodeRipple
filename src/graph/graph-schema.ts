import { z } from 'zod';

import {
  EDGE_TYPES,
  NODE_TYPES,
  UNRESOLVED_REASONS,
  type CodeGraph,
} from './graph-types.js';

const nonEmptyString = z.string().min(1);
const positiveLine = z.number().int().positive();

export const fileNodeSchema = z
  .object({
    id: nonEmptyString,
    type: z.literal('FILE'),
    name: nonEmptyString,
    path: nonEmptyString,
  })
  .strict();

export const classNodeSchema = z
  .object({
    id: nonEmptyString,
    type: z.literal('CLASS'),
    name: nonEmptyString,
    file: nonEmptyString,
    startLine: positiveLine,
    endLine: positiveLine,
  })
  .strict();

export const functionNodeSchema = z
  .object({
    id: nonEmptyString,
    type: z.literal('FUNCTION'),
    name: nonEmptyString,
    file: nonEmptyString,
    startLine: positiveLine,
    endLine: positiveLine,
  })
  .strict();

export const methodNodeSchema = z
  .object({
    id: nonEmptyString,
    type: z.literal('METHOD'),
    name: nonEmptyString,
    file: nonEmptyString,
    parent: nonEmptyString,
    startLine: positiveLine,
    endLine: positiveLine,
  })
  .strict();

export const graphNodeSchema = z.discriminatedUnion('type', [
  fileNodeSchema,
  classNodeSchema,
  functionNodeSchema,
  methodNodeSchema,
]);

export const graphEdgeSchema = z
  .object({
    id: nonEmptyString,
    type: z.enum(EDGE_TYPES),
    from: nonEmptyString,
    to: nonEmptyString,
  })
  .strict();

export const unresolvedReferenceSchema = z
  .object({
    caller: nonEmptyString,
    expression: nonEmptyString,
    line: positiveLine,
    reason: z.enum(UNRESOLVED_REASONS),
  })
  .strict();

export const graphMetadataSchema = z
  .object({
    filesAnalyzed: z.number().int().nonnegative(),
    classes: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative(),
    methods: z.number().int().nonnegative(),
    resolvedCalls: z.number().int().nonnegative(),
    unresolvedCalls: z.number().int().nonnegative(),
  })
  .strict();

export const codeGraphSchema = z
  .object({
    version: z.literal('1'),
    repository: z.object({ name: nonEmptyString }).strict(),
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
    unresolvedReferences: z.array(unresolvedReferenceSchema),
    metadata: graphMetadataSchema,
  })
  .strict();

export const NODE_TYPE_VALUES = NODE_TYPES;
export const EDGE_TYPE_VALUES = EDGE_TYPES;
export const UNRESOLVED_REASON_VALUES = UNRESOLVED_REASONS;

/**
 * Validate a candidate graph and return it typed as a `CodeGraph`.
 *
 * Throws a `ZodError` (with a readable message) when the graph is malformed so
 * that `analyze` never writes an invalid file to disk.
 */
export function validateCodeGraph(candidate: unknown): CodeGraph {
  const result = codeGraphSchema.safeParse(candidate);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Generated graph failed validation:\n${details}`);
  }
  return result.data;
}
