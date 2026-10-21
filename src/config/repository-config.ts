import fs from 'node:fs';
import path from 'node:path';

/** Resolved configuration for a repository being analyzed. */
export interface RepositoryConfig {
  /** Absolute path to the repository root. */
  rootDir: string;
  /** Human-readable repository name (the root directory's basename). */
  name: string;
  /** Absolute path to `tsconfig.json`, or `null` when none is present. */
  tsconfigPath: string | null;
}

const TSCONFIG_FILE_NAMES = ['tsconfig.json'];

/**
 * Resolve the repository root and locate its `tsconfig.json` when present.
 *
 * The path is validated eagerly here so that the CLI can fail fast with a
 * clear message before any parsing work begins.
 */
export function loadRepositoryConfig(inputPath: string): RepositoryConfig {
  const absolute = path.resolve(inputPath);

  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolute);
  } catch {
    throw new Error(`Repository path does not exist: ${inputPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${inputPath}`);
  }

  let tsconfigPath: string | null = null;
  for (const fileName of TSCONFIG_FILE_NAMES) {
    const candidate = path.join(absolute, fileName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      tsconfigPath = candidate;
      break;
    }
  }

  return {
    rootDir: absolute,
    name: path.basename(absolute),
    tsconfigPath,
  };
}
