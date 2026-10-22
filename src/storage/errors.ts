/**
 * Error hierarchy for CodeRipple's storage layer.
 *
 * Every error carries an actionable, user-facing message and keeps its
 * underlying cause attached, so callers can distinguish invalid configuration
 * from a connectivity failure, a bad argument, or a persistence failure
 * without losing the original database error.
 */
export class GraphStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Required Neo4j configuration is missing or malformed. */
export class ConfigurationError extends GraphStoreError {}

/** CodeRipple could not reach the Neo4j database. */
export class ConnectionError extends GraphStoreError {}

/** A query argument (depth, path count, ...) is invalid. */
export class InvalidArgumentError extends GraphStoreError {}

/** Persisting or reading the graph failed inside the database. */
export class PersistenceError extends GraphStoreError {}

/**
 * Render an unknown thrown value as a stable, single-line message.
 *
 * Line breaks (including those embedded in driver/database error messages) are
 * collapsed to spaces so CLI output stays on one line and cannot be used to
 * inject extra log lines.
 */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
