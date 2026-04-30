import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateReport } from '../src/report';

function setup(): { stateDir: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'));
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    JSON.stringify({
      project: 'demo-app',
      library: '@example/ui',
      baseline: { version: '1.0.0' },
      after: { version: '1.1.0' },
    }),
  );
  fs.writeFileSync(
    path.join(stateDir, 'coverage-targets.json'),
    JSON.stringify({
      targets: [
        { targetId: 't1', importedName: 'Button', file: 'src/A.tsx', line: 1 },
        { targetId: 't2', importedName: 'Modal', file: 'src/B.tsx', line: 2 },
        { targetId: 't3', importedName: 'Drawer', file: 'src/C.tsx', line: 3 },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(stateDir, 'route-checklist.json'),
    JSON.stringify({
      selectedRoutes: [
        { routeId: 'r1', path: '/r1', url: 'https://x/r1', targetIds: ['t1', 't2'] },
        { routeId: 'r2', path: '/r2', url: 'https://x/r2', targetIds: ['t3'] },
      ],
    }),
  );

  fs.writeFileSync(
    path.join(stateDir, 'after-runtime-plan.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-04-30T00:00:00Z',
      routes: [{ routeId: 'r1', routePath: '/r1', url: 'https://x/r1', expectedTargetIds: ['t1', 't2'] }],
      excluded: {
        skippedRoutes: [{ routeId: 'r2', reason: 'no menu entry' }],
        forcedOnlyTargetIds: [],
        uncoveredTargetIds: [],
      },
    }),
  );

  const baselineDir = path.join(stateDir, 'runs', 'baseline-1.0.0', 'routes', 'r1');
  fs.mkdirSync(path.join(baselineDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, 'coverage.json'),
    JSON.stringify({
      routeId: 'r1',
      confirmedTargetIds: ['t1', 't2'],
      remainingTargetIds: [],
      reviewStatus: 'visual-ok',
      skipped: false,
    }),
  );
  fs.writeFileSync(path.join(baselineDir, 'screenshots', 'route-confirm.png'), 'png');
  fs.writeFileSync(path.join(baselineDir, 'trace.zip'), 'trace');

  const afterDir = path.join(stateDir, 'runs', 'after', 'routes', 'r1');
  fs.mkdirSync(path.join(afterDir, 'initial', 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(afterDir, 'final', 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(afterDir, 'initial', 'screenshots', 'final.png'), 'png');
  fs.writeFileSync(path.join(afterDir, 'initial', 'video.webm'), 'video');
  fs.writeFileSync(path.join(afterDir, 'initial', 'trace.zip'), 'trace');
  fs.writeFileSync(path.join(afterDir, 'final', 'screenshots', 'final.png'), 'png');
  fs.writeFileSync(path.join(afterDir, 'final', 'video.webm'), 'video');
  fs.writeFileSync(path.join(afterDir, 'final', 'trace.zip'), 'trace');
  fs.writeFileSync(
    path.join(afterDir, 'final', 'claims.json'),
    JSON.stringify({
      routeId: 'r1',
      status: 'passed',
      expectedTargetIds: ['t1', 't2'],
      missingTargetIds: [],
    }),
  );

  fs.mkdirSync(path.join(stateDir, 'api-diff'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'api-diff', 'dts-diff.md'), '# d.ts diff\n\nButton renamed.\n');
  fs.writeFileSync(path.join(stateDir, 'api-diff', 'dts-impact.md'), '# d.ts impact\n\n- r1\n');

  fs.mkdirSync(path.join(stateDir, 'build'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'build', 'build-fixes.md'), '# Build fixes\n\n- patched src/A.tsx\n');

  return { stateDir };
}

describe('generateReport', () => {
  it('writes summary markdown and JSON artifacts with key counts', () => {
    const { stateDir } = setup();
    const summary = generateReport({ stateDir });

    const summaryMd = fs.readFileSync(path.join(stateDir, 'report', 'summary.md'), 'utf8');
    expect(summaryMd).toContain('demo-app');
    expect(summaryMd).toContain('confirmed');
    expect(summaryMd).toContain('r2');
    expect(summaryMd).toContain('https://x/r2');
    expect(summaryMd).toContain('passed');

    const coverage = JSON.parse(
      fs.readFileSync(path.join(stateDir, 'report', 'coverage-summary.json'), 'utf8'),
    );
    expect(coverage.confirmedTargetCount).toBe(2);
    expect(coverage.totalTargetCount).toBe(3);
    expect(coverage.skippedRoutes).toHaveLength(1);

    const runtimeDiff = JSON.parse(
      fs.readFileSync(path.join(stateDir, 'report', 'runtime-diff.json'), 'utf8'),
    );
    expect(runtimeDiff.afterPassed).toBe(1);
    expect(runtimeDiff.afterFailed).toBe(0);

    const apiImpact = JSON.parse(
      fs.readFileSync(path.join(stateDir, 'report', 'api-impact.json'), 'utf8'),
    );
    expect(apiImpact.dtsDiffPath).toContain('dts-diff.md');

    expect(summary.confirmedTargetCount).toBe(2);
    expect(summary.afterPassed).toBe(1);
  });

  it('writes a visual html report with route evidence comparison', () => {
    const { stateDir } = setup();
    generateReport({ stateDir });

    const html = fs.readFileSync(path.join(stateDir, 'report', 'index.html'), 'utf8');
    expect(html).toContain('Upgrade Evidence Review');
    expect(html).toContain('Baseline');
    expect(html).toContain('After Initial');
    expect(html).toContain('After Final');
    expect(html).toContain('<th>URL</th>');
    expect(html).toContain('runs/baseline-1.0.0/routes/r1/screenshots/route-confirm.png');
    expect(html).toContain('runs/after/routes/r1/final/video.webm');
    expect(html).toContain('runs/after/routes/r1/final/trace.zip');
    expect(html).toContain('r1');
    expect(html).toContain('https://x/r2');

    const runtimeDiff = JSON.parse(
      fs.readFileSync(path.join(stateDir, 'report', 'runtime-diff.json'), 'utf8'),
    );
    expect(runtimeDiff.claims[0].routeId).toBe('r1');
  });
});
