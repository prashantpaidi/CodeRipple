import type { SourceFile } from 'ts-morph';

import { edgeId, fileNodeId } from '../graph/ids.js';
import type { GraphEdge } from '../graph/graph-types.js';
import { toPosixPath } from '../utils/paths.js';

/**
 * Resolve static `import`/`export ... from` declarations into FILE --IMPORTS-->
 * FILE edges.
 *
 * Module resolution is delegated to ts-morph, which honors the project's
 * `tsconfig.json` compiler options (relative specifiers, `baseUrl`, and
 * `paths` aliases). Only imports that resolve to another file inside the
 * analyzed set become edges; external packages are silently ignored.
 */
export function resolveImports(
  sourceFile: SourceFile,
  relativePath: string,
  analyzedByAbsolutePath: ReadonlyMap<string, string>,
): GraphEdge[] {
  const fromId = fileNodeId(relativePath);
  const seenTargets = new Set<string>();
  const edges: GraphEdge[] = [];

  const addEdge = (target: SourceFile | undefined): void => {
    if (!target) {
      return;
    }
    const targetRelative = analyzedByAbsolutePath.get(toPosixPath(target.getFilePath()));
    if (!targetRelative || targetRelative === relativePath) {
      return;
    }
    if (seenTargets.has(targetRelative)) {
      return;
    }
    seenTargets.add(targetRelative);

    const toId = fileNodeId(targetRelative);
    edges.push({
      id: edgeId('IMPORTS', fromId, toId),
      type: 'IMPORTS',
      from: fromId,
      to: toId,
    });
  };

  for (const declaration of sourceFile.getImportDeclarations()) {
    addEdge(declaration.getModuleSpecifierSourceFile());
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    addEdge(declaration.getModuleSpecifierSourceFile());
  }

  return edges;
}
