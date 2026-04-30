import path from 'path';
import { transformSync } from '@babel/core';
import plugin from '../src/index';

const cwd = process.cwd();
const filename = path.join(cwd, 'src/x.tsx');

function transform(source: string, targetPackages: string[] = ['@target/ui']) {
  const result = transformSync(source, {
    cwd,
    filename,
    plugins: [[plugin, { targetPackages }]],
    presets: [
      ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
    ],
    configFile: false,
    babelrc: false,
  });

  return result?.code ?? '';
}

test('target JSX is wrapped and id matches src/x.tsx#Widget#L<n>', () => {
  const code = transform([
    "import { Widget } from '@target/ui';",
    '',
    'export const App = () => <Widget tone="blue" />;',
  ].join('\n'));

  expect(code).toContain('<__CoverageMark id="src/x.tsx#Widget#L3">');
  expect(code).toContain('<Widget tone="blue" />');
});

test('runtime imported from @odc/coverage-marker/runtime', () => {
  const code = transform([
    "import { Widget } from '@target/ui';",
    '',
    'export const App = () => <Widget />;',
  ].join('\n'));

  expect(code).toContain("import { __CoverageMark } from \"@odc/coverage-marker/runtime\";");
});

test('non-target package no-op', () => {
  const source = [
    "import { Widget } from '@other/ui';",
    '',
    'export const App = () => <Widget />;',
  ].join('\n');

  expect(transform(source)).not.toContain('__CoverageMark');
});

test('alias preserves importedName', () => {
  const code = transform([
    "import { Button as PrimaryButton } from '@target/ui';",
    '',
    'export const App = () => <PrimaryButton />;',
  ].join('\n'));

  expect(code).toContain('<__CoverageMark id="src/x.tsx#Button#L3">');
});

test('type-only import no-op', () => {
  const source = [
    "import type { Widget } from '@target/ui';",
    '',
    'export const App = () => <Widget />;',
  ].join('\n');

  expect(transform(source)).not.toContain('__CoverageMark');
});

test('React.createElement no-op', () => {
  const source = [
    "import { Widget } from '@target/ui';",
    '',
    'export const App = () => React.createElement(Widget);',
  ].join('\n');

  expect(transform(source)).not.toContain('__CoverageMark');
});

test('component-as-prop no-op', () => {
  const source = [
    "import { Widget } from '@target/ui';",
    "import { Host } from '@other/ui';",
    '',
    'export const App = () => <Host component={Widget} />;',
  ].join('\n');

  expect(transform(source)).not.toContain('__CoverageMark');
});

test('multiple target packages', () => {
  const code = transform([
    "import { Widget } from '@target/ui';",
    "import { Panel } from '@target/layout';",
    '',
    'export const App = () => <><Widget /><Panel /></>;',
  ].join('\n'), ['@target/ui', '@target/layout']);

  expect(code).toContain('src/x.tsx#Widget#L4');
  expect(code).toContain('src/x.tsx#Panel#L4');
});

test('empty targetPackages array no-op', () => {
  const source = [
    "import { Widget } from '@target/ui';",
    '',
    'export const App = () => <Widget />;',
  ].join('\n');

  expect(transform(source, [])).not.toContain('__CoverageMark');
});

test('already wrapped JSX is not recursively wrapped and nested target JSX wraps each target once', () => {
  const code = transform([
    "import { Widget, Panel } from '@target/ui';",
    "import { __CoverageMark } from '@odc/coverage-marker/runtime';",
    '',
    'export const App = () => (',
    '  <Panel>',
    '    <Widget />',
    '    <__CoverageMark id="manual"><Widget /></__CoverageMark>',
    '  </Panel>',
    ');',
  ].join('\n'));

  expect(code.match(/src\/x\.tsx#Panel#L5/g)).toHaveLength(1);
  expect(code.match(/src\/x\.tsx#Widget#L6/g)).toHaveLength(1);
  expect(code).toContain('<__CoverageMark id="manual">');
  expect(code).not.toContain('src/x.tsx#Widget#L7');
});

test('shadowed local binding with same name as target import is not wrapped', () => {
  const code = transform([
    "import { Widget } from '@target/ui';",
    "import { Other } from '@other/ui';",
    '',
    'export const App = () => {',
    '  const Widget = Other;',
    '  return <Widget />;',
    '};',
  ].join('\n'));

  expect(code).not.toContain('src/x.tsx#Widget#L6');
});

test('existing aliased runtime import is reused consistently', () => {
  const code = transform([
    "import { Widget } from '@target/ui';",
    "import { __CoverageMark as Mark } from '@odc/coverage-marker/runtime';",
    '',
    'export const App = () => <><Mark id="manual"><span /></Mark><Widget /></>;',
  ].join('\n'));

  expect(code).toContain('<Mark id="src/x.tsx#Widget#L4">');
  expect(code).not.toContain('<__CoverageMark id=');
  expect(code).not.toContain('import { __CoverageMark }');
});

test('existing aliased runtime wrapper prevents recursive wrapping inside it', () => {
  const code = transform([
    "import { Widget } from '@target/ui';",
    "import { __CoverageMark as Mark } from '@odc/coverage-marker/runtime';",
    '',
    'export const App = () => <Mark id="manual"><Widget /></Mark>;',
  ].join('\n'));

  expect(code).toContain('<Mark id="manual">');
  expect(code).not.toContain('src/x.tsx#Widget#L4');
});
