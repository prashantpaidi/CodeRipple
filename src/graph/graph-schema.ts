import { z } from 'zod';

import {
  EDGE_TYPES,
  NODE_TYPES,
  UNRESOLVED_REASONS,
  type CodeGraph,
  type EdgeType,
  type GraphNode,
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

const graphBodySchema = z
  .object({
    version: z.literal('1'),
    repository: z.object({ name: nonEmptyString }).strict(),
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
    unresolvedReferences: z.array(unresolvedReferenceSchema),
    metadata: graphMetadataSchema,
  })
  .strict();

/** Node types that are allowed to originate a CALLS edge. */
const CALLER_NODE_TYPES = new Set<GraphNode['type']>(['FILE', 'FUNCTION', 'METHOD']);
/** Node types that a CALLS edge is allowed to target. */
const CALLEE_NODE_TYPES = new Set<GraphNode['type']>(['FUNCTION', 'METHOD']);

function edgeShapeError(
  type: EdgeType,
  from: GraphNode,
  to: GraphNode,
): string | null {
  switch (type) {
    case 'CONTAINS':
      if (from.type === 'FILE' && (to.type === 'CLASS' || to.type === 'FUNCTION')) {
        return null;
      }
      if (from.type === 'CLASS' && to.type === 'METHOD') {
        return null;
      }
      return `CONTAINS edges must be FILE->CLASS, FILE->FUNCTION, or CLASS->METHOD (got ${from.type}->${to.type})`;
    case 'IMPORTS':
      if (from.type === 'FILE' && to.type === 'FILE') {
        return null;
      }
      return `IMPORTS edges must connect FILE->FILE (got ${from.type}->${to.type})`;
    case 'CALLS':
      if (CALLER_NODE_TYPES.has(from.type) && CALLEE_NODE_TYPES.has(to.type)) {
        return null;
      }
      return `CALLS edges must originate from FILE/FUNCTION/METHOD and target FUNCTION/METHOD (got ${from.type}->${to.type})`;
  }
}

/**
 * Full graph schema: shape validation plus a semantic-integrity pass.
 *
 * Shape validation alone would accept a graph with dangling edge endpoints,
 * duplicate IDs, a METHOD whose parent is not a CLASS, an unresolved reference
 * to a nonexistent caller, or metadata that disagrees with the contents. The
 * `superRefine` pass enforces those invariants so that anything this schema
 * accepts is safe to persist and to diff across commits.
 */
export const codeGraphSchema = graphBodySchema.superRefine((graph, ctx) => {
  const nodeById = new Map<string, GraphNode>();
  for (const [index, node] of graph.nodes.entries()) {
    if (nodeById.has(node.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate node id "${node.id}"`,
        path: ['nodes', index, 'id'],
      });
    } else {
      nodeById.set(node.id, node);
    }
  }

  const edgeIds = new Set<string>();
  for (const [index, edge] of graph.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate edge id "${edge.id}"`,
        path: ['edges', index, 'id'],
      });
    }
    edgeIds.add(edge.id);

    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Edge "${edge.id}" references unknown source node "${edge.from}"`,
        path: ['edges', index, 'from'],
      });
    }
    if (!to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Edge "${edge.id}" references unknown target node "${edge.to}"`,
        path: ['edges', index, 'to'],
      });
    }
    if (from && to) {
      const shapeError = edgeShapeError(edge.type, from, to);
      if (shapeError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: shapeError,
          path: ['edges', index],
        });
      }
    }
  }

  for (const [index, node] of graph.nodes.entries()) {
    if (node.type === 'METHOD') {
      const parent = nodeById.get(node.parent);
      if (!parent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `METHOD "${node.id}" references unknown parent "${node.parent}"`,
          path: ['nodes', index, 'parent'],
        });
      } else if (parent.type !== 'CLASS') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `METHOD "${node.id}" parent must be a CLASS node (got ${parent.type})`,
          path: ['nodes', index, 'parent'],
        });
      }
    }

    if (node.type !== 'FILE') {
      const file = nodeById.get(node.file);
      if (!file || file.type !== 'FILE') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${node.type} "${node.id}" references unknown file "${node.file}"`,
          path: ['nodes', index, 'file'],
        });
      }
    }
  }

  for (const [index, reference] of graph.unresolvedReferences.entries()) {
    const caller = nodeById.get(reference.caller);
    if (!caller) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unresolved reference caller "${reference.caller}" is not a node`,
        path: ['unresolvedReferences', index, 'caller'],
      });
    } else if (!CALLER_NODE_TYPES.has(caller.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unresolved reference caller "${reference.caller}" must be a FILE, FUNCTION, or METHOD`,
        path: ['unresolvedReferences', index, 'caller'],
      });
    }
  }

  const expectedCounts = {
    filesAnalyzed: graph.nodes.filter((node) => node.type === 'FILE').length,
    classes: graph.nodes.filter((node) => node.type === 'CLASS').length,
    functions: graph.nodes.filter((node) => node.type === 'FUNCTION').length,
    methods: graph.nodes.filter((node) => node.type === 'METHOD').length,
    resolvedCalls: graph.edges.filter((edge) => edge.type === 'CALLS').length,
    unresolvedCalls: graph.unresolvedReferences.length,
  };
  for (const key of Object.keys(expectedCounts) as (keyof typeof expectedCounts)[]) {
    if (graph.metadata[key] !== expectedCounts[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `metadata.${key} is ${graph.metadata[key]} but the graph contains ${expectedCounts[key]}`,
        path: ['metadata', key],
      });
    }
  }
});

export const NODE_TYPE_VALUES = NODE_TYPES;
export const EDGE_TYPE_VALUES = EDGE_TYPES;
export const UNRESOLVED_REASON_VALUES = UNRESOLVED_REASONS;

/**
 * Validate a candidate graph and return it typed as a `CodeGraph`.
 *
 * Throws the underlying `ZodError` when the graph is malformed — either in
 * shape or in structural integrity — so that `analyze` never writes an invalid
 * file to disk.
 */
export function validateCodeGraph(candidate: unknown): CodeGraph {
  const result = codeGraphSchema.safeParse(candidate);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}
