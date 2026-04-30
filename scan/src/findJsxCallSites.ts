import ts from 'typescript';
import { parseTargetImports, TargetImport } from './parseTargetImports';

export interface JsxCallSite {
  packageName: string;
  importedName: string;
  localName: string;
  file: string;
  line: number;
  column: number;
  kind: 'runtime-jsx';
}

export function findJsxCallSites(
  sourceFile: ts.SourceFile,
  targetPackages: string[],
  file: string,
): JsxCallSite[] {
  const importsByLocalName = new Map<string, TargetImport>();
  for (const targetImport of parseTargetImports(sourceFile, targetPackages)) {
    importsByLocalName.set(targetImport.localName, targetImport);
  }

  const sites: JsxCallSite[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const localName = getJsxTagRootName(node.tagName);
      const targetImport = localName ? importsByLocalName.get(localName) : undefined;

      if (targetImport) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        sites.push({
          packageName: targetImport.packageName,
          importedName: targetImport.importedName,
          localName: targetImport.localName,
          file,
          line: line + 1,
          column: character + 1,
          kind: 'runtime-jsx',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return sites;
}

function getJsxTagRootName(tagName: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(tagName)) {
    return tagName.text;
  }

  if (ts.isPropertyAccessExpression(tagName)) {
    return getExpressionRootName(tagName.expression);
  }

  return null;
}

function getExpressionRootName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return getExpressionRootName(expression.expression);
  }

  return null;
}
