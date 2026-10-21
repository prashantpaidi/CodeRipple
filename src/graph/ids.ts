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

export function methodNodeId(
  relativePath: string,
  className: string,
  methodName: string,
): string {
  return `${relativePath}::${className}.${methodName}`;
}

export function edgeId(type: EdgeType, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}
