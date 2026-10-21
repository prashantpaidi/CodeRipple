import {
  Node,
  SyntaxKind,
  type SourceFile,
  type Symbol,
  type TypeChecker,
} from 'ts-morph';

import { edgeId, fileNodeId } from '../graph/ids.js';
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

/**
 * True for declarations that are type-only and therefore cannot be the runtime
 * target of a call (interface members, type aliases, ...). These do not
 * invalidate a resolution the way an unmapped value declaration would.
 */
function isTypeOnlyDeclaration(node: Node): boolean {
  return (
    Node.isMethodSignature(node) ||
    Node.isPropertySignature(node) ||
    Node.isCallSignatureDeclaration(node) ||
    Node.isConstructSignatureDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node)
  );
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
 * Every call expression is attributed to its enclosing function or method, or
 * to the FILE node when it sits in module-level executable code, and is then
 * either turned into a CALLS edge or recorded as an unresolved reference —
 * never guessed.
 */
export function resolveCalls(
  sourceFile: SourceFile,
  relativePath: string,
  context: CallResolutionContext,
): CallResolutionResult {
  const checker = sourceFile.getProject().getTypeChecker();
  const edges: GraphEdge[] = [];
  const unresolved: UnresolvedReference[] = [];
  const seenEdges = new Set<string>();
  const seenUnresolved = new Set<string>();

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();

    // Dynamic `import("...")` is explicitly out of scope for PR #1.
    if (expression.getKind() === SyntaxKind.ImportKeyword) {
      continue;
    }

    // Module-level code has no function/method to attribute to, so the FILE
    // node becomes the caller. This keeps top-level calls (and their failures)
    // in the graph instead of dropping them silently.
    const enclosing = call.getFirstAncestor((ancestor) =>
      context.declarationToNodeId.has(ancestor),
    );
    const callerId =
      (enclosing ? context.declarationToNodeId.get(enclosing) : undefined) ??
      fileNodeId(relativePath);

    const symbol = expression.getSymbol();
    const declarations = symbol ? declarationsFor(symbol, checker) : [];
    const targetIds: string[] = [];
    let everyDeclarationResolvable = declarations.length > 0;
    for (const declaration of declarations) {
      const targetId = context.declarationToNodeId.get(declaration);
      if (targetId) {
        if (!targetIds.includes(targetId)) {
          targetIds.push(targetId);
        }
      } else if (!isTypeOnlyDeclaration(declaration)) {
        // An unmapped value declaration means we cannot be certain the call
        // targets the single mapped candidate, so we refuse to guess.
        everyDeclarationResolvable = false;
      }
    }

    const targetId = targetIds[0];
    if (everyDeclarationResolvable && targetIds.length === 1 && targetId) {
      const id = edgeId('CALLS', callerId, targetId);
      if (!seenEdges.has(id)) {
        seenEdges.add(id);
        edges.push({ id, type: 'CALLS', from: callerId, to: targetId });
      }
      continue;
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
