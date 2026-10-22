import neo4j, { type Driver } from 'neo4j-driver';

import { ConnectionError, errorMessage } from '../errors.js';
import type { Neo4jConfig } from './neo4j-config.js';

/**
 * Create the single Neo4j driver for a process.
 *
 * `disableLosslessIntegers` returns Neo4j integers as plain JavaScript numbers,
 * which is what CodeRipple's line numbers and depths are; the driver type is
 * kept internal to this package.
 */
export function createNeo4jDriver(config: Neo4jConfig): Driver {
  return neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.username, config.password),
    { disableLosslessIntegers: true },
  );
}

/** Verify connectivity, translating failures into a {@link ConnectionError}. */
export async function verifyConnectivity(driver: Driver): Promise<void> {
  try {
    await driver.verifyConnectivity();
  } catch (error) {
    throw new ConnectionError(
      `Failed to connect to Neo4j. Check NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/** True when a driver error indicates the database is unreachable or unauthorized. */
export function isConnectivityError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === 'string' &&
    /ServiceUnavailable|SessionExpired|Unauthorized|AuthenticationRateLimit/i.test(code)
  );
}
