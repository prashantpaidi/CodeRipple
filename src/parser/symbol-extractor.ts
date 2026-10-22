import { Node, type SourceFile } from 'ts-morph';

import {
  classNodeId,
  edgeId,
  fileNodeId,
  functionNodeId,
  memberNodeId,
} from '../graph/ids.js';
import type { GraphEdge, GraphNode } from '../graph/graph-types.js';

export interface ExtractedSymbols {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Maps a ts-morph declaration node (function declaration, method, accessor,
   * variable holding a function, ...) to the graph node ID it produced. Call
   * resolution uses this to translate resolved symbols into graph edges.
   */
  declarationToNodeId: Map<Node, string>;
}

/** How a member declaration is qualified so it stays unique within its class. */
interface MemberName {
  /** Human-readable name stored on the node (e.g. `value`, `constructor`). */
  name: string;
  /** Identity suffix used to build the node ID (e.g. `get:value`). */
  qualifiedName: string;
}

function containsEdge(from: string, to: string): GraphEdge {
  return { id: edgeId('CONTAINS', from, to), type: 'CONTAINS', from, to };
}

/**
 * Peel off expression wrappers (`( )`, `as`, `satisfies`, `!`, `<T>`) so that
 * function- and class-valued initializers are recognised regardless of how the
 * author annotated them.
 */
function unwrapExpression(node: Node): Node {
  let current = node;
  for (;;) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
}

function isFunctionInitializer(node: Node): boolean {
  const unwrapped = unwrapExpression(node);
  return Node.isArrowFunction(unwrapped) || Node.isFunctionExpression(unwrapped);
}

/**
 * Determine the exposed name and identity qualifier for a class member, or
 * `null` when the member is not method-like.
 *
 * Qualifiers keep same-named declarations distinct:
 * - instance method `build`     -> `build`
 * - static method `build`       -> `static:build`
 * - getter `value`              -> `get:value`
 * - setter `value`              -> `set:value`
 * - constructor                 -> `constructor`
 */
function qualifiedMemberName(member: Node): MemberName | null {
  if (Node.isConstructorDeclaration(member)) {
    return { name: 'constructor', qualifiedName: 'constructor' };
  }
  if (Node.isMethodDeclaration(member)) {
    const name = member.getName();
    return member.isStatic()
      ? { name, qualifiedName: `static:${name}` }
      : { name, qualifiedName: name };
  }
  if (Node.isGetAccessorDeclaration(member)) {
    const name = member.getName();
    return {
      name,
      qualifiedName: member.isStatic() ? `static:get:${name}` : `get:${name}`,
    };
  }
  if (Node.isSetAccessorDeclaration(member)) {
    const name = member.getName();
    return {
      name,
      qualifiedName: member.isStatic() ? `static:set:${name}` : `set:${name}`,
    };
  }
  if (Node.isPropertyDeclaration(member)) {
    const initializer = member.getInitializer();
    if (initializer && isFunctionInitializer(initializer)) {
      const name = member.getName();
      return member.isStatic()
        ? { name, qualifiedName: `static:${name}` }
        : { name, qualifiedName: name };
    }
  }
  return null;
}

/** Widen a node's line range to also cover another declaration of the same symbol. */
function extendRange(existing: GraphNode, incoming: GraphNode): void {
  if (existing.type === 'FILE' || incoming.type === 'FILE') {
    return;
  }
  existing.startLine = Math.min(existing.startLine, incoming.startLine);
  existing.endLine = Math.max(existing.endLine, incoming.endLine);
}

/**
 * All declaration nodes that make up a single logical callable: its overload
 * signatures (which ts-morph does not report as separate members) followed by
 * the declaration itself.
 */
function declarationFamily(declaration: Node): Node[] {
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) {
    return [...declaration.getOverloads(), declaration];
  }
  return [declaration];
}

function rangeOf(nodes: readonly Node[]): { startLine: number; endLine: number } {
  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;
  for (const node of nodes) {
    startLine = Math.min(startLine, node.getStartLineNumber());
    endLine = Math.max(endLine, node.getEndLineNumber());
  }
  return { startLine, endLine };
}

/**
 * Extract FILE / CLASS / FUNCTION / METHOD nodes and the CONTAINS edges that
 * link them, for a single source file.
 *
 * Overload policy: an overloaded function or method (one name, several
 * declarations) collapses into a single logical node. The node's line range is
 * widened to span the first declaration's start through the last declaration's
 * end, and every declaration maps to that same node ID so calls resolve to the
 * logical symbol.
 */
export function extractSymbols(sourceFile: SourceFile, relativePath: string): ExtractedSymbols {
  const nodeById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const declarationToNodeId = new Map<Node, string>();

  const addEdge = (from: string, to: string): void => {
    const edge = containsEdge(from, to);
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };

  const upsertNode = (node: GraphNode): void => {
    const existing = nodeById.get(node.id);
    if (!existing) {
      nodeById.set(node.id, node);
      return;
    }
    extendRange(existing, node);
  };

  const fileId = fileNodeId(relativePath);
  upsertNode({
    id: fileId,
    type: 'FILE',
    name: sourceFile.getBaseName(),
    path: relativePath,
  });

  const addFunction = (name: string, declarations: readonly Node[]): void => {
    const id = functionNodeId(relativePath, name);
    const { startLine, endLine } = rangeOf(declarations);
    upsertNode({
      id,
      type: 'FUNCTION',
      name,
      file: relativePath,
      startLine,
      endLine,
    });
    addEdge(fileId, id);
    for (const declaration of declarations) {
      declarationToNodeId.set(declaration, id);
    }
  };

  for (const declaration of sourceFile.getClasses()) {
    const className = declaration.getName();
    if (!className) {
      continue;
    }

    const classId = classNodeId(relativePath, className);
    upsertNode({
      id: classId,
      type: 'CLASS',
      name: className,
      file: relativePath,
      startLine: declaration.getStartLineNumber(),
      endLine: declaration.getEndLineNumber(),
    });
    addEdge(fileId, classId);

    for (const member of declaration.getMembers()) {
      const memberName = qualifiedMemberName(member);
      if (!memberName) {
        continue;
      }
      const declarations = declarationFamily(member);
      const methodId = memberNodeId(relativePath, className, memberName.qualifiedName);
      const { startLine, endLine } = rangeOf(declarations);
      upsertNode({
        id: methodId,
        type: 'METHOD',
        name: memberName.name,
        file: relativePath,
        parent: classId,
        startLine,
        endLine,
      });
      addEdge(classId, methodId);
      for (const declarationNode of declarations) {
        declarationToNodeId.set(declarationNode, methodId);
      }
    }
  }

  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (name) {
      addFunction(name, declarationFamily(declaration));
    }
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const nameNode = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (Node.isIdentifier(nameNode) && initializer && isFunctionInitializer(initializer)) {
        addFunction(nameNode.getText(), [declaration]);
      }
    }
  }

  return { nodes: [...nodeById.values()], edges, declarationToNodeId };
}
