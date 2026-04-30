import ts from 'typescript';
import { findJsxCallSites } from '../src/findJsxCallSites';

function source(code: string): ts.SourceFile {
  return ts.createSourceFile('src/App.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

describe('findJsxCallSites', () => {
  it('reports self-closing JSX tag usage from target imports', () => {
    const sites = findJsxCallSites(
      source("import { Button } from '@example/ui';\nexport const App = () => <Button />;"),
      ['@example/ui'],
      'src/App.tsx',
    );

    expect(sites).toEqual([
      {
        packageName: '@example/ui',
        importedName: 'Button',
        localName: 'Button',
        file: 'src/App.tsx',
        line: 2,
        column: 26,
        kind: 'runtime-jsx',
      },
    ]);
  });

  it('preserves importedName and localName for aliases', () => {
    const sites = findJsxCallSites(
      source("import { Button as PrimaryButton } from '@example/ui';\nexport const App = () => <PrimaryButton />;"),
      ['@example/ui'],
      'src/App.tsx',
    );

    expect(sites[0]).toMatchObject({
      importedName: 'Button',
      localName: 'PrimaryButton',
    });
  });

  it('does not report createElement calls or component-as-prop references', () => {
    const sites = findJsxCallSites(
      source(
        [
          "import React from 'react';",
          "import { Button } from '@example/ui';",
          "export const A = () => React.createElement(Button);",
          "export const B = () => <div action={Button} />;",
        ].join('\n'),
      ),
      ['@example/ui'],
      'src/App.tsx',
    );

    expect(sites).toEqual([]);
  });

  it('does not report type-only imports', () => {
    const sites = findJsxCallSites(
      source("import type { Button } from '@example/ui';\nexport const App = () => <div />;"),
      ['@example/ui'],
      'src/App.tsx',
    );

    expect(sites).toEqual([]);
  });

  it('reports namespaced JSX using the namespace root', () => {
    const sites = findJsxCallSites(
      source("import * as UI from '@example/ui';\nexport const App = () => <UI.Button />;"),
      ['@example/ui'],
      'src/App.tsx',
    );

    expect(sites).toEqual([
      {
        packageName: '@example/ui',
        importedName: '*',
        localName: 'UI',
        file: 'src/App.tsx',
        line: 2,
        column: 26,
        kind: 'runtime-jsx',
      },
    ]);
  });

  it('distinguishes same-line duplicate call sites by column', () => {
    const sites = findJsxCallSites(
      source("import { Button } from '@example/ui';\nexport const App = () => <><Button /><Button /></>;"),
      ['@example/ui'],
      'src/App.tsx',
    );

    expect(sites.map((site) => site.column)).toEqual([28, 38]);
  });
});
