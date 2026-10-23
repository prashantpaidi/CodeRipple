import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  GraphStoreError,
  InvalidArgumentError,
  errorMessage,
} from '../src/storage/errors.js';

describe('errorMessage', () => {
  it('collapses line breaks into a single line', () => {
    const error = new Error('first line\nsecond line\r\nthird line');
    const message = errorMessage(error);

    expect(message).toBe('first line second line third line');
    expect(message).not.toContain('\n');
  });

  it('renders non-Error values', () => {
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('error hierarchy', () => {
  it('names errors after their class and shares a base type', () => {
    expect(new ConfigurationError('x')).toBeInstanceOf(GraphStoreError);
    expect(new InvalidArgumentError('x').name).toBe('InvalidArgumentError');
  });
});
