import ts from 'typescript';
import { parseTargetImports } from '../src/parseTargetImports';

function source(code: string): ts.SourceFile {
  return ts.createSourceFile('sample.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

describe('parseTargetImports', () => {
  it('captures named imports with aliases from target packages', () => {
    const imports = parseTargetImports(source("import { Button as PrimaryButton } from '@example/ui';"), [
      '@example/ui',
    ]);

    expect(imports).toEqual([
      {
        packageName: '@example/ui',
        importedName: 'Button',
        localName: 'PrimaryButton',
        kind: 'named',
      },
    ]);
  });

  it('excludes type-only imports', () => {
    const imports = parseTargetImports(
      source("import type { Button } from '@example/ui';\nimport { type Theme } from '@example/ui';"),
      ['@example/ui'],
    );

    expect(imports).toEqual([]);
  });

  it('captures default imports', () => {
    const imports = parseTargetImports(source("import Widget from '@example/ui';"), ['@example/ui']);

    expect(imports).toEqual([
      {
        packageName: '@example/ui',
        importedName: 'default',
        localName: 'Widget',
        kind: 'default',
      },
    ]);
  });

  it('ignores non-target package imports', () => {
    const imports = parseTargetImports(source("import { Button } from '@other/ui';"), ['@example/ui']);

    expect(imports).toEqual([]);
  });

  it('captures imports from multiple target packages', () => {
    const imports = parseTargetImports(
      source("import { Button } from '@example/ui';\nimport { Table as DataTable } from '@example/data';"),
      ['@example/ui', '@example/data'],
    );

    expect(imports).toEqual([
      {
        packageName: '@example/ui',
        importedName: 'Button',
        localName: 'Button',
        kind: 'named',
      },
      {
        packageName: '@example/data',
        importedName: 'Table',
        localName: 'DataTable',
        kind: 'named',
      },
    ]);
  });

  it('captures namespace imports', () => {
    const imports = parseTargetImports(source("import * as UI from '@example/ui';"), ['@example/ui']);

    expect(imports).toEqual([
      {
        packageName: '@example/ui',
        importedName: '*',
        localName: 'UI',
        kind: 'namespace',
      },
    ]);
  });
});
