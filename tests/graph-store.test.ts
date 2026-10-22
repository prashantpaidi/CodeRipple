import { describe, expect, it } from 'vitest';

import { InvalidArgumentError } from '../src/storage/errors.js';
import type { EdgeType } from '../src/graph/graph-types.js';
import {
  DEFAULT_MAX_PATHS,
  DEFAULT_PATH_DEPTH,
  DEFAULT_TRAVERSAL_DEPTH,
  MAX_TRAVERSAL_DEPTH,
  resolveMaxPaths,
  resolvePathDepth,
  resolveRelationshipTypes,
  resolveTraversalDepth,
} from '../src/storage/graph-store.js';

describe('resolveRelationshipTypes', () => {
  it('defaults to CALLS', () => {
    expect(resolveRelationshipTypes()).toEqual(['CALLS']);
    expect(resolveRelationshipTypes({ relationshipTypes: [] })).toEqual(['CALLS']);
  });

  it('deduplicates and sorts the requested types', () => {
    expect(
      resolveRelationshipTypes({ relationshipTypes: ['IMPORTS', 'CALLS', 'CALLS'] }),
    ).toEqual(['CALLS', 'IMPORTS']);
  });

  it('rejects unknown types (they are never interpolated into Cypher)', () => {
    // A double cast is needed only to pass a runtime-invalid value to the
    // validator, which is exactly what the runtime check defends against.
    const unknownType = 'OWNS' as unknown as EdgeType;
    expect(() => resolveRelationshipTypes({ relationshipTypes: [unknownType] })).toThrow(
      InvalidArgumentError,
    );
  });
});

describe('depth validation', () => {
  it('applies and validates traversal depth', () => {
    expect(resolveTraversalDepth()).toBe(DEFAULT_TRAVERSAL_DEPTH);
    expect(resolveTraversalDepth({ maxDepth: 3 })).toBe(3);
    expect(resolvePathDepth()).toBe(DEFAULT_PATH_DEPTH);
    expect(resolvePathDepth({ maxDepth: 2 })).toBe(2);
  });

  it('rejects out-of-range and non-integer depths', () => {
    expect(() => resolveTraversalDepth({ maxDepth: 0 })).toThrow(InvalidArgumentError);
    expect(() => resolveTraversalDepth({ maxDepth: MAX_TRAVERSAL_DEPTH + 1 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => resolveTraversalDepth({ maxDepth: 1.5 })).toThrow(InvalidArgumentError);
  });
});

describe('resolveMaxPaths', () => {
  it('defaults and validates the path limit', () => {
    expect(resolveMaxPaths()).toBe(DEFAULT_MAX_PATHS);
    expect(resolveMaxPaths({ maxPaths: 2 })).toBe(2);
  });

  it('rejects unsafe integers that would break the inlined LIMIT', () => {
    expect(() => resolveMaxPaths({ maxPaths: 1e21 })).toThrow(InvalidArgumentError);
    expect(() => resolveMaxPaths({ maxPaths: 0 })).toThrow(InvalidArgumentError);
  });
});
