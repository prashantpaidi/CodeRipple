import fs from 'node:fs';
import path from 'node:path';

import ignore, { type Ignore } from 'ignore';

import type { RepositoryConfig } from '../config/repository-config.js';
import {
  DEFAULT_IGNORED_DIRECTORIES,
  compareStrings,
  hasSourceExtension,
  isDeclarationFile,
  isMinifiedFile,
  toPosixPath,
} from '../utils/paths.js';

export interface DiscoveredFile {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Repository-relative POSIX path, e.g. `src/services/user.ts`. */
  relativePath: string;
}

export interface DiscoveryOptions {
  /** Extra directory names to skip, merged with the defaults. */
  ignoredDirectories?: readonly string[];
  /** Set to `false` to skip `.gitignore` handling (useful for tests). */
  respectGitignore?: boolean;
}

/**
 * Load the repository root `.gitignore`, if any, into a matcher.
 *
 * We intentionally only honor the root `.gitignore`; nested ignore files are
 * out of scope for this foundation PR.
 */
export function loadGitignoreMatcher(rootDir: string): Ignore | null {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath) || !fs.statSync(gitignorePath).isFile()) {
    return null;
  }
  const content = fs.readFileSync(gitignorePath, 'utf8');
  return ignore().add(content);
}

/**
 * Recursively discover analyzable source files.
 *
 * Directories that are conventional build output (`node_modules`, `dist`,
 * `build`, `coverage`, `.next`, `.git`) are always skipped. Declaration files
 * (`.d.ts`) and minified bundles are skipped to avoid generating low-value
 * graph nodes from generated code.
 */
export function discoverSourceFiles(
  config: RepositoryConfig,
  options: DiscoveryOptions = {},
): DiscoveredFile[] {
  const ignoredDirectories = new Set<string>([
    ...DEFAULT_IGNORED_DIRECTORIES,
    ...(options.ignoredDirectories ?? []),
  ]);
  const gitignore =
    options.respectGitignore === false ? null : loadGitignoreMatcher(config.rootDir);

  const results: DiscoveredFile[] = [];

  const walk = (absoluteDir: string, relativeDir: string): void => {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const absoluteEntry = path.join(absoluteDir, entry.name);
      const relativeEntry = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        if (gitignore?.ignores(`${toPosixPath(relativeEntry)}/`)) {
          continue;
        }
        walk(absoluteEntry, relativeEntry);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!hasSourceExtension(entry.name)) {
        continue;
      }

      if (isDeclarationFile(entry.name) || isMinifiedFile(entry.name)) {
        continue;
      }

      if (gitignore?.ignores(toPosixPath(relativeEntry))) {
        continue;
      }

      results.push({
        absolutePath: absoluteEntry,
        relativePath: toPosixPath(relativeEntry),
      });
    }
  };

  walk(config.rootDir, '');

  results.sort((a, b) => compareStrings(a.relativePath, b.relativePath));
  return results;
}
