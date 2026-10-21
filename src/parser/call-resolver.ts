import {
  Node,
  SyntaxKind,
  type SourceFile,
  type Symbol,
  type TypeChecker,
} from 'ts-morph';

import { edgeId } from '../graph/ids.js';
import type {
  GraphEdge,
  UnresolvedReason,
  UnresolvedReference,
} from '../graph/graph-types.js';
import { normalizeWhitespace, toPosixPath } from '../utils/paths.js';

export interface CallResolutionContext {
  /**
   * Global map from declaration node to graph ID, covering every analyzed
   * file. This is what makes cross-file and cross-class resolution possible.
   */
  declarationToNodeId: ReadonlyMap<Node, string>;
}

export interface CallResolutionResult {
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
}

/** True when a declaration lives outside the analyzed repository. */
function isExternalDeclaration(node: Node): boolean {
  const sourceFile = node.getSourceFile();
  return sourceFile.isDeclarationFile() || toPosixPath(sourceFile.getFilePath()).includes('/node_modules/');
}

/** Follow import aliases to the underlying declaration symbol. */
function resolveAlias(symbol: Symbol, checker: TypeChecker): Symbol {
  let current = symbol;
  const visited = new Set<Symbol>();
  while (current.isAlias() && !visited.has(current)) {
    visited.add(current);
    const aliased = checker.getAliasedSymbol(current);
    if (!aliased || aliased === current) {
      break;
    }
    current = aliased;
  }
  return current;
}

function declarationsFor(symbol: Symbol, checker: TypeChecker): Node[] {
  return resolveAlias(symbol, checker).getDeclarations();
}

/** Classify why a call could not be resolved into a concrete graph edge. */
function classifyReason(
  expression: Node,
  symbol: Symbol | undefined,
  checker: TypeChecker,
): UnresolvedReason {
  if (Node.isElementAccessExpression(expression)) {
    return 'DYNAMIC_PROPERTY_ACCESS';
  }

  if (symbol) {
    const declarations = declarationsFor(symbol, checker);
    if (declarations.length > 0 && declarations.every(isExternalDeclaration)) {
      return 'EXTERNAL_DEPENDENCY';
    }
    return 'TARGET_NOT_RESOLVED';
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const objectSymbol = expression.getExpression().getSymbol();
    if (
      objectSymbol &&
      declarationsFor(objectSymbol, checker).some(isExternalDeclaration)
    ) {
      return 'EXTERNAL_DEPENDENCY';
    }
  }

  return 'TARGET_NOT_RESOLVED';
}

/**
 * Resolve the statically identifiable calls contained in a single source file.
 *
 * Every call expression that lives inside a known function or method is either
 * turned into a CALLS edge or recorded as an unresolved reference — never
 * guessed.
 */
export function resolveCalls(
  sourceFile: SourceFile,
  context: CallResolutionContext,
): CallResolutionResult {
  const checker = sourceFile.getProject().getTypeChecker();
  const edges: GraphEdge[] = [];
  const unresolved: UnresolvedReference[] = [];
  const seenEdges = new Set<string>();
  const seenUnresolved = new Set<string>();

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();

    // `import("...")` is a dynamic import, which is explicitly out of scope.
    if (expression.getKind() === SyntaxKind.ImportKeyword) {
      continue;
    }

    const caller = call.getFirstAncestor((ancestor) =>
      context.declarationToNodeId.has(ancestor),
    );
    const callerId = caller ? context.declarationToNodeId.get(caller) : undefined;
    if (!callerId) {
      continue;
    }

    const symbol = expression.getSymbol();
    const targetIds: string[] = [];
    if (symbol) {
      for (const declaration of declarationsFor(symbol, checker)) {
        const targetId = context.declarationToNodeId.get(declaration);
        if (targetId && !targetIds.includes(targetId)) {
          targetIds.push(targetId);
        }
      }
    }

    if (targetIds.length === 1) {
      const targetId = targetIds[0];
      if (targetId) {
        const id = edgeId('CALLS', callerId, targetId);
        if (!seenEdges.has(id)) {
          seenEdges.add(id);
          edges.push({ id, type: 'CALLS', from: callerId, to: targetId });
        }
        continue;
      }
    }

    const reason: UnresolvedReason =
      targetIds.length > 1
        ? 'AMBIGUOUS_SYMBOL'
        : classifyReason(expression, symbol, checker);
    const expressionText = normalizeWhitespace(call.getText());
    const line = call.getStartLineNumber();
    const key = `${callerId}\u0000${expressionText}\u0000${line}\u0000${reason}`;
    if (!seenUnresolved.has(key)) {
      seenUnresolved.add(key);
      unresolved.push({ caller: callerId, expression: expressionText, line, reason });
    }
  }

  return { edges, unresolved };
}
