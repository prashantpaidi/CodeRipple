import { Node, type ClassDeclaration, type SourceFile } from 'ts-morph';

import {
  classNodeId,
  edgeId,
  fileNodeId,
  functionNodeId,
  methodNodeId,
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

/** A method-like class member with the name we expose in the graph. */
interface MethodLikeMember {
  node: Node;
  name: string;
}

function containsEdge(from: string, to: string): GraphEdge {
  return { id: edgeId('CONTAINS', from, to), type: 'CONTAINS', from, to };
}

function isFunctionInitializer(node: Node): boolean {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

/**
 * Collect the members of a class that behave like methods: methods, the
 * constructor, accessors, and class fields initialized with a function.
 */
function collectMethodLikeMembers(declaration: ClassDeclaration): MethodLikeMember[] {
  const members: MethodLikeMember[] = [];

  for (const member of declaration.getMembers()) {
    if (Node.isConstructorDeclaration(member)) {
      members.push({ node: member, name: 'constructor' });
      continue;
    }
    if (Node.isMethodDeclaration(member)) {
      members.push({ node: member, name: member.getName() });
      continue;
    }
    if (Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member)) {
      members.push({ node: member, name: member.getName() });
      continue;
    }
    if (Node.isPropertyDeclaration(member)) {
      const initializer = member.getInitializer();
      if (initializer && isFunctionInitializer(initializer)) {
        members.push({ node: member, name: member.getName() });
      }
    }
  }

  return members;
}

/**
 * Extract FILE / CLASS / FUNCTION / METHOD nodes and the CONTAINS edges that
 * link them, for a single source file.
 */
export function extractSymbols(sourceFile: SourceFile, relativePath: string): ExtractedSymbols {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const declarationToNodeId = new Map<Node, string>();
  const seenNodeIds = new Set<string>();

  const addNode = (node: GraphNode): boolean => {
    if (seenNodeIds.has(node.id)) {
      return false;
    }
    seenNodeIds.add(node.id);
    nodes.push(node);
    return true;
  };

  const fileId = fileNodeId(relativePath);
  addNode({
    id: fileId,
    type: 'FILE',
    name: sourceFile.getBaseName(),
    path: relativePath,
  });

  const addFunction = (name: string, declaration: Node): void => {
    const id = functionNodeId(relativePath, name);
    if (addNode({
      id,
      type: 'FUNCTION',
      name,
      file: relativePath,
      startLine: declaration.getStartLineNumber(),
      endLine: declaration.getEndLineNumber(),
    })) {
      edges.push(containsEdge(fileId, id));
    }
    declarationToNodeId.set(declaration, id);
  };

  for (const declaration of sourceFile.getClasses()) {
    const className = declaration.getName();
    if (!className) {
      continue;
    }

    const classId = classNodeId(relativePath, className);
    if (addNode({
      id: classId,
      type: 'CLASS',
      name: className,
      file: relativePath,
      startLine: declaration.getStartLineNumber(),
      endLine: declaration.getEndLineNumber(),
    })) {
      edges.push(containsEdge(fileId, classId));
    }

    for (const member of collectMethodLikeMembers(declaration)) {
      const methodId = methodNodeId(relativePath, className, member.name);
      if (addNode({
        id: methodId,
        type: 'METHOD',
        name: member.name,
        file: relativePath,
        parent: classId,
        startLine: member.node.getStartLineNumber(),
        endLine: member.node.getEndLineNumber(),
      })) {
        edges.push(containsEdge(classId, methodId));
      }
      declarationToNodeId.set(member.node, methodId);
    }
  }

  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (name) {
      addFunction(name, declaration);
    }
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const nameNode = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (Node.isIdentifier(nameNode) && initializer && isFunctionInitializer(initializer)) {
        addFunction(nameNode.getText(), declaration);
      }
    }
  }

  return { nodes, edges, declarationToNodeId };
}
