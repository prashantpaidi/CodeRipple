import { Node, type Decorator, type SourceFile } from 'ts-morph';

import type { GraphNode } from '../graph/graph-types.js';

const verbs = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Options: 'OPTIONS', Head: 'HEAD', All: 'ALL' } as const;
type Verb = keyof typeof verbs;

/** Resolve only named, value imports from Nest itself, including import aliases. */
function importedDecorator(decorator: Decorator): string | undefined {
  const call = decorator.getCallExpression();
  const expression = call?.getExpression();
  if (!expression || !Node.isIdentifier(expression)) return undefined;
  const declarations = expression.getSymbol()?.getDeclarations() ?? [];
  if (declarations.length !== 1) return undefined;
  const specifier = declarations[0];
  if (!specifier || !Node.isImportSpecifier(specifier) || specifier.isTypeOnly()) return undefined;
  const declaration = specifier.getImportDeclaration();
  if (declaration.isTypeOnly() || declaration.getModuleSpecifierValue() !== '@nestjs/common') return undefined;
  return specifier.getName();
}

/** Return only literal paths; dynamic values and arrays cannot be represented safely. */
function literalPath(decorator: Decorator): string | undefined {
  const args = decorator.getArguments();
  if (args.length === 0) return '';
  if (args.length !== 1 || !Node.isStringLiteral(args[0])) return undefined;
  return args[0].getLiteralValue();
}

export function extractNestRoutes(sourceFile: SourceFile, declarations: ReadonlyMap<Node, string>, nodes: Map<string, GraphNode>): void {
  for (const cls of sourceFile.getClasses()) {
    const controllers = cls.getDecorators().filter((d) => importedDecorator(d) === 'Controller');
    if (controllers.length !== 1 || !controllers[0]) continue;
    const controllerPath = literalPath(controllers[0]);
    if (controllerPath === undefined) continue;
    for (const method of cls.getMethods()) {
      const handlers = method.getDecorators().filter((d) => Object.hasOwn(verbs, importedDecorator(d) ?? ''));
      if (handlers.length !== 1 || !handlers[0]) continue;
      const handlerPath = literalPath(handlers[0]);
      const verb = importedDecorator(handlers[0]);
      const id = declarations.get(method);
      const node = id ? nodes.get(id) : undefined;
      if (handlerPath === undefined || !verb || node?.type !== 'METHOD' || method.isStatic()) continue;
      node.route = { framework: 'nestjs', method: verbs[verb as Verb], controllerPath, handlerPath };
    }
  }
}
