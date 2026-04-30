import fs from 'fs';
import os from 'os';
import path from 'path';
import { runApiDiff } from '../src/apiDiff';

function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function setup(): {
  stateDir: string;
  baselineRoot: string;
  afterRoot: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'api-diff-'));
  const baselineRoot = path.join(root, 'baseline');
  const afterRoot = path.join(root, 'after');
  const stateDir = path.join(root, 'coverage-state');

  const baselineDts = path.join(baselineRoot, 'node_modules', '@example', 'ui', 'lib', 'Button.d.ts');
  const afterDts = path.join(afterRoot, 'node_modules', '@example', 'ui', 'lib', 'Button.d.ts');
  mkdirp(path.dirname(baselineDts));
  mkdirp(path.dirname(afterDts));

  fs.writeFileSync(
    baselineDts,
    [
      'export interface ButtonProps {',
      '  oldName?: string;',
      "  mode?: 'a' | 'b';",
      '}',
      'export declare function Button(props: ButtonProps): JSX.Element;',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    afterDts,
    [
      'export interface ButtonProps {',
      '  newName?: string;',
      "  mode?: 'a';",
      '  requiredLabel: string;',
      '}',
      'export declare function Button(props: ButtonProps): JSX.Element;',
      '',
    ].join('\n'),
  );

  mkdirp(stateDir);
  fs.writeFileSync(
    path.join(stateDir, 'pages.json'),
    JSON.stringify({
      schemaVersion: 1,
      pages: [
        {
          id: 'p1',
          path: '/p1',
          components: ['Button'],
          file: 'src/pages/P1.tsx',
        },
      ],
    }),
  );

  return { stateDir, baselineRoot, afterRoot };
}

describe('runApiDiff', () => {
  it('diffs d.ts files and reports impacted routes', () => {
    const { stateDir, baselineRoot, afterRoot } = setup();
    const summary = runApiDiff({
      stateDir,
      baselineRoot,
      afterRoot,
      targetPackages: ['@example/ui'],
    });

    const dtsDiff = fs.readFileSync(path.join(stateDir, 'api-diff', 'dts-diff.md'), 'utf8');
    const dtsImpact = fs.readFileSync(path.join(stateDir, 'api-diff', 'dts-impact.md'), 'utf8');

    expect(dtsDiff).toContain('Button');
    expect(dtsDiff).toContain('oldName');
    expect(dtsDiff).toContain('newName');
    expect(dtsDiff).toContain('requiredLabel');

    expect(dtsImpact).toContain('p1');
    expect(dtsImpact).toContain('Button');

    expect(summary.redCount).toBeGreaterThan(0);
    expect(summary.greenCount).toBeGreaterThanOrEqual(0);
    expect(typeof summary.yellowCount).toBe('number');
  });
});
