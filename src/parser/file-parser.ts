import { Project, ts, type SourceFile } from 'ts-morph';

import type { RepositoryConfig } from '../config/repository-config.js';
import type { DiscoveredFile } from './repository-parser.js';

export interface ParsedRepository {
  project: Project;
  /** Source files in the analyzed set, keyed by repository-relative POSIX path. */
  sourceFiles: Map<string, SourceFile>;
}

/**
 * Build a ts-morph project for the repository.
 *
 * When a `tsconfig.json` exists we load its compiler options so that module
 * resolution (including `paths` aliases) behaves exactly like the project
 * would. We always add files ourselves (via `skipAddingFilesFromTsConfig`), so
 * repository discovery — including `.gitignore` and ignored directories —
 * decides which files become graph nodes. ts-morph may still load other files
 * that are reached through imports in order to resolve types; those are never
 * emitted as nodes.
 */
export function parseRepository(
  config: RepositoryConfig,
  files: readonly DiscoveredFile[],
): ParsedRepository {
  const overrideOptions = {
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    noEmit: true,
  } as const;

  const project = config.tsconfigPath
    ? new Project({
        tsConfigFilePath: config.tsconfigPath,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: overrideOptions,
      })
    : new Project({
        compilerOptions: {
          ...overrideOptions,
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
      });

  const sourceFiles = new Map<string, SourceFile>();
  for (const file of files) {
    sourceFiles.set(file.relativePath, project.addSourceFileAtPath(file.absolutePath));
  }

  return { project, sourceFiles };
}
