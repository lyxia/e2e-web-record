import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export type ImportGraph = Map<string, string[]>;

const EXTENSION_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx'];

export function buildImportGraph(files: string[], projectRoot: string): ImportGraph {
  const fileSet = new Set(files.map(normalizePath));
  const graph: ImportGraph = new Map();

  for (const rawFile of files) {
    const file = normalizePath(rawFile);
    const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, getScriptKind(file));
    const imports = collectImportSpecifiers(sourceFile);
    const resolvedImports = imports
      .map((specifier) => resolveImport(specifier, file, projectRoot, fileSet))
      .filter((resolved): resolved is string => Boolean(resolved));
    graph.set(file, Array.from(new Set(resolvedImports)).sort());
  }

  return graph;
}

export function walkReachable(graph: ImportGraph, startFile: string): Set<string> {
  const visited = new Set<string>();
  const stack = [normalizePath(startFile)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return visited;
}

export function resolveImport(
  specifier: string,
  importerFile: string,
  projectRoot: string,
  fileSet?: Set<string>,
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
    return null;
  }

  const basePath = specifier.startsWith('@/')
    ? path.join(projectRoot, 'src', specifier.slice(2))
    : path.resolve(path.dirname(importerFile), specifier);

  for (const candidate of getResolutionCandidates(basePath)) {
    const normalized = normalizePath(candidate);
    if (fileSet ? fileSet.has(normalized) : fs.existsSync(normalized)) {
      return normalized;
    }
  }

  return null;
}

function collectImportSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier)) {
        specifiers.push(specifier.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function getResolutionCandidates(basePath: string): string[] {
  const ext = path.extname(basePath);
  if (ext) {
    return [basePath];
  }

  return [
    ...EXTENSION_CANDIDATES.map((candidateExt) => `${basePath}${candidateExt}`),
    ...EXTENSION_CANDIDATES.map((candidateExt) => path.join(basePath, `index${candidateExt}`)),
  ];
}

function normalizePath(file: string): string {
  return path.resolve(file);
}

function getScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
