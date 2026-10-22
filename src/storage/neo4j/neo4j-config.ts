import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { ConfigurationError, errorMessage } from '../errors.js';

/** Resolved Neo4j connection settings. */
export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

const DEFAULT_USERNAME = 'neo4j';
const DEFAULT_DATABASE = 'neo4j';

const configSchema = z.object({
  uri: z
    .string()
    .min(1)
    .regex(/^(bolt|neo4j)(\+s|\+ssc)?:\/\/.+/i, 'must be a bolt:// or neo4j:// URI'),
  username: z.string().min(1),
  password: z.string().min(1),
  database: z.string().min(1),
});

const REQUIRED_VARIABLES = ['NEO4J_URI', 'NEO4J_PASSWORD'] as const;

/**
 * Load and validate Neo4j configuration from the environment.
 *
 * Fails with a {@link ConfigurationError} that names the offending variables so
 * a misconfigured environment is obvious immediately, rather than surfacing as
 * an opaque connection error later.
 */
export function loadNeo4jConfig(env: NodeJS.ProcessEnv = process.env): Neo4jConfig {
  const missing = REQUIRED_VARIABLES.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Missing required Neo4j configuration: ${missing.join(', ')}. ` +
        'Set NEO4J_URI and NEO4J_PASSWORD (see .env.example).',
    );
  }

  const candidate = {
    uri: env.NEO4J_URI,
    username: (env.NEO4J_USERNAME ?? '').trim() || DEFAULT_USERNAME,
    password: env.NEO4J_PASSWORD,
    database: (env.NEO4J_DATABASE ?? '').trim() || DEFAULT_DATABASE,
  };

  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'} ${issue.message}`)
      .join('; ');
    throw new ConfigurationError(`Invalid Neo4j configuration: ${issues}`);
  }

  return parsed.data;
}

const ENV_LINE_PATTERN = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=.*$/;

/** Line numbers (1-based) of entries that are not blank, comments, or KEY=VALUE. */
function findInvalidEnvLines(content: string): number[] {
  const invalid: number[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const trimmedLine = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      return;
    }
    if (!ENV_LINE_PATTERN.test(line)) {
      invalid.push(index + 1);
    }
  });
  return invalid;
}

/**
 * Load a `.env` file into `process.env` when one is present.
 *
 * Uses Node's built-in loader (no extra dependency); values already present in
 * the environment take precedence. Node's loader silently skips malformed
 * entries, so the file is syntax-checked first and a malformed file surfaces as
 * a {@link ConfigurationError} instead of being quietly ignored.
 */
export function loadEnvFileIfPresent(
  filePath: string = path.resolve(process.cwd(), '.env'),
): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ConfigurationError(
      `Failed to read environment file "${filePath}": ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const invalidLines = findInvalidEnvLines(content);
  if (invalidLines.length > 0) {
    const shown = invalidLines.slice(0, 5).join(', ');
    throw new ConfigurationError(
      `Invalid environment file "${filePath}": malformed entries on line(s) ${shown}. Expected KEY=VALUE.`,
    );
  }

  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    throw new ConfigurationError(
      `Failed to load environment file "${filePath}": ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
