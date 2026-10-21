import type { EdgeType } from './graph-types.js';

/**
 * Deterministic ID builders.
 *
 * IDs are derived purely from repository-relative paths and symbol names so
 * that the same repository always produces the same IDs. This is what lets a
 * future CodeRipple diff graphs across commits.
 */

export function fileNodeId(relativePath: string): string {
  return relativePath;
}

export function classNodeId(relativePath: string, className: string): string {
  return `${relativePath}::${className}`;
}

export function functionNodeId(relativePath: string, functionName: string): string {
  return `${relativePath}::${functionName}`;
}

/**
 * Build a METHOD node ID from an already-qualified member name.
 *
 * The qualifier keeps declarations that share a name distinct, e.g.
 * `value` (instance method), `static:value`, `get:value`, and `set:value`.
 * See `qualifiedMemberName` in the symbol extractor.
 */
export function memberNodeId(
  relativePath: string,
  className: string,
  qualifiedMemberName: string,
): string {
  return `${relativePath}::${className}.${qualifiedMemberName}`;
}

/**
 * Escape endpoint IDs so that the `->` delimiter can never appear inside a
 * component. This keeps `edgeId` injective: two distinct edges always produce
 * two distinct IDs, so deduplication can never drop a real relationship.
 */
function encodeEdgePart(value: string): string {
  return value.replace(/%/g, '%25').replace(/->/g, '%2D%3E');
}

export function edgeId(type: EdgeType, from: string, to: string): string {
  return `${type}:${encodeEdgePart(from)}->${encodeEdgePart(to)}`;
}
