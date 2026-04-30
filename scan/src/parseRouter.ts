import fs from 'fs';
import ts from 'typescript';

export interface ParsedRoute {
  path: string;
  componentImportPath: string;
  file: string;
}

export function parseRouter(routeFiles: string[]): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  for (const file of routeFiles) {
    const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, getScriptKind(file));
    const lazyVariables = collectLazyVariables(sourceFile);

    function visit(node: ts.Node): void {
      if (ts.isObjectLiteralExpression(node)) {
        const route = parseRouteObject(node, lazyVariables, file);
        if (route) {
          routes.push(route);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return routes;
}

function collectLazyVariables(sourceFile: ts.SourceFile): Map<string, string> {
  const lazyVariables = new Map<string, string>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const importPath = getLazyImportPath(node.initializer);
      if (importPath) {
        lazyVariables.set(node.name.text, importPath);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lazyVariables;
}

function parseRouteObject(
  objectLiteral: ts.ObjectLiteralExpression,
  lazyVariables: Map<string, string>,
  file: string,
): ParsedRoute | null {
  let routePath: string | null = null;
  let componentImportPath: string | null = null;

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const propertyName = getPropertyName(property.name);
    if (propertyName === 'path' && ts.isStringLiteralLike(property.initializer)) {
      routePath = property.initializer.text;
    }

    if (propertyName === 'component') {
      if (ts.isIdentifier(property.initializer)) {
        componentImportPath = lazyVariables.get(property.initializer.text) ?? null;
      } else {
        componentImportPath = getRouteComponentImportPath(property.initializer);
      }
    }
  }

  return routePath && componentImportPath ? { path: routePath, componentImportPath, file } : null;
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function getLazyImportPath(expression: ts.Expression): string | null {
  if (!ts.isCallExpression(expression)) {
    return null;
  }

  const [firstArg] = expression.arguments;
  if (!firstArg || (!ts.isArrowFunction(firstArg) && !ts.isFunctionExpression(firstArg))) {
    return null;
  }

  return findDynamicImportPath(firstArg.body);
}

function getRouteComponentImportPath(expression: ts.Expression): string | null {
  return getLazyImportPath(expression) ?? (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
      ? findDynamicImportPath(expression.body)
      : null
  );
}

function findDynamicImportPath(node: ts.Node): string | null {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [specifier] = node.arguments;
    return specifier && ts.isStringLiteralLike(specifier) ? specifier.text : null;
  }

  let found: string | null = null;
  ts.forEachChild(node, (child) => {
    if (!found) {
      found = findDynamicImportPath(child);
    }
  });
  return found;
}

function getScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
