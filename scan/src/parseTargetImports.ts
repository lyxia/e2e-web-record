import ts from 'typescript';

export type TargetImportKind = 'default' | 'named' | 'namespace';

export interface TargetImport {
  packageName: string;
  importedName: string;
  localName: string;
  kind: TargetImportKind;
}

export function parseTargetImports(sourceFile: ts.SourceFile, targetPackages: string[]): TargetImport[] {
  const targets = new Set(targetPackages);
  const imports: TargetImport[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const packageName = statement.moduleSpecifier.text;
    if (!targets.has(packageName) || !statement.importClause || statement.importClause.isTypeOnly) {
      continue;
    }

    if (statement.importClause.name) {
      imports.push({
        packageName,
        importedName: 'default',
        localName: statement.importClause.name.text,
        kind: 'default',
      });
    }

    const namedBindings = statement.importClause.namedBindings;
    if (!namedBindings) {
      continue;
    }

    if (ts.isNamespaceImport(namedBindings)) {
      imports.push({
        packageName,
        importedName: '*',
        localName: namedBindings.name.text,
        kind: 'namespace',
      });
      continue;
    }

    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }

      imports.push({
        packageName,
        importedName: element.propertyName ? element.propertyName.text : element.name.text,
        localName: element.name.text,
        kind: 'named',
      });
    }
  }

  return imports;
}
