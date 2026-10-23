import type { Driver } from 'neo4j-driver';

import { PersistenceError, errorMessage } from '../errors.js';
import type { Neo4jConfig } from './neo4j-config.js';

/**
 * Schema statements for CodeRipple's Neo4j model.
 *
 * Every statement is idempotent (`IF NOT EXISTS`), so running initialization on
 * every connection is safe. Uniqueness is enforced by the database, not only by
 * application logic:
 * - one `:Repository` per identity;
 * - one `:CodeEntity` per `(repository, CodeRipple node id)` via the namespaced
 *   `ref` property;
 * - an index for efficient lookup by `repositoryId`.
 */
export const NEO4J_SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT repository_id_unique IF NOT EXISTS FOR (r:Repository) REQUIRE r.id IS UNIQUE',
  'CREATE CONSTRAINT code_entity_ref_unique IF NOT EXISTS FOR (c:CodeEntity) REQUIRE c.ref IS UNIQUE',
  'CREATE INDEX code_entity_repository_id IF NOT EXISTS FOR (c:CodeEntity) ON (c.repositoryId)',
] as const;

/** Create constraints/indexes; safe to call repeatedly. */
export async function initializeSchema(driver: Driver, config: Neo4jConfig): Promise<void> {
  const session = driver.session({ database: config.database });
  try {
    for (const statement of NEO4J_SCHEMA_STATEMENTS) {
      await session.executeWrite((transaction) => transaction.run(statement));
    }
  } catch (error) {
    throw new PersistenceError(
      `Failed to initialize Neo4j schema: ${errorMessage(error)}`,
      { cause: error },
    );
  } finally {
    await session.close();
  }
}
