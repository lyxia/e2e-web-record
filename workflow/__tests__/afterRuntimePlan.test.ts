import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildAfterRuntimePlan } from '../src/afterRuntimePlan';

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function setup(): { stateDir: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-plan-'));
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    JSON.stringify({
      baseline: { version: '1.0.0' },
      after: { version: '1.1.0' },
    }),
  );
  fs.writeFileSync(
    path.join(stateDir, 'coverage-targets.json'),
    JSON.stringify({
      targets: [
        { targetId: 't1', importedName: 'A', file: 'src/A.tsx', line: 1 },
        { targetId: 't2', importedName: 'B', file: 'src/B.tsx', line: 2 },
        { targetId: 't3', importedName: 'C', file: 'src/C.tsx', line: 3 },
        { targetId: 't4', importedName: 'D', file: 'src/D.tsx', line: 4 },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(stateDir, 'route-checklist.json'),
    JSON.stringify({
      selectedRoutes: [
        { routeId: 'r-confirmed', path: '/r1', url: 'https://example.test/r1', targetIds: ['t1', 't2'] },
        { routeId: 'r-skipped', path: '/r2', url: 'https://example.test/r2', targetIds: ['t3'] },
        { routeId: 'r-forced', path: '/r3', url: 'https://example.test/r3', targetIds: ['t4'] },
      ],
    }),
  );

  const baselineRouteDir = (routeId: string) =>
    path.join(stateDir, 'runs', 'baseline-1.0.0', 'routes', routeId);

  fs.mkdirSync(baselineRouteDir('r-confirmed'), { recursive: true });
  fs.writeFileSync(
    path.join(baselineRouteDir('r-confirmed'), 'coverage.json'),
    JSON.stringify({
      schemaVersion: 1,
      routeId: 'r-confirmed',
      routePath: '/r1',
      url: 'https://example.test/r1',
      expectedTargetIds: ['t1', 't2'],
      confirmedTargetIds: ['t1', 't2'],
      remainingTargetIds: [],
      forceConfirmReason: null,
      operatorNote: null,
      reviewStatus: 'visual-ok',
      targetContexts: {},
      skipped: false,
    }),
  );

  fs.mkdirSync(baselineRouteDir('r-skipped'), { recursive: true });
  fs.writeFileSync(
    path.join(baselineRouteDir('r-skipped'), 'coverage.json'),
    JSON.stringify({
      schemaVersion: 1,
      routeId: 'r-skipped',
      routePath: '/r2',
      url: 'https://example.test/r2',
      expectedTargetIds: ['t3'],
      confirmedTargetIds: [],
      remainingTargetIds: ['t3'],
      reviewStatus: 'skipped',
      skipped: true,
      skippedReason: 'no menu entry',
    }),
  );

  fs.mkdirSync(baselineRouteDir('r-forced'), { recursive: true });
  fs.writeFileSync(
    path.join(baselineRouteDir('r-forced'), 'coverage.json'),
    JSON.stringify({
      schemaVersion: 1,
      routeId: 'r-forced',
      routePath: '/r3',
      url: 'https://example.test/r3',
      expectedTargetIds: ['t4'],
      confirmedTargetIds: [],
      remainingTargetIds: ['t4'],
      forceConfirmReason: 'visual review only',
      reviewStatus: 'force-confirmed',
      skipped: false,
    }),
  );

  return { stateDir };
}

describe('buildAfterRuntimePlan', () => {
  it('only emits routes whose baseline has confirmed targets', () => {
    const { stateDir } = setup();
    const plan = buildAfterRuntimePlan({ stateDir });

    expect(plan.routes.map((r) => r.routeId)).toEqual(['r-confirmed']);
    expect(plan.excluded.skippedRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routeId: 'r-skipped', reason: 'no menu entry' }),
      ]),
    );
    expect(plan.excluded.uncoveredTargetIds).toEqual([]);
    expect(plan.excluded.forcedOnlyTargetIds).toEqual(['t4']);

    const written = readJson<any>(path.join(stateDir, 'after-runtime-plan.json'));
    expect(written.routes[0].routeId).toBe('r-confirmed');
  });

  it('emits uncovered targets when target appears nowhere confirmed', () => {
    const { stateDir } = setup();
    fs.writeFileSync(
      path.join(stateDir, 'coverage-targets.json'),
      JSON.stringify({
        targets: [
          { targetId: 't1', importedName: 'A', file: 'src/A.tsx', line: 1 },
          { targetId: 't2', importedName: 'B', file: 'src/B.tsx', line: 2 },
          { targetId: 't3', importedName: 'C', file: 'src/C.tsx', line: 3 },
          { targetId: 't4', importedName: 'D', file: 'src/D.tsx', line: 4 },
          { targetId: 't5', importedName: 'E', file: 'src/E.tsx', line: 5 },
        ],
      }),
    );
    const plan = buildAfterRuntimePlan({ stateDir });
    expect(plan.excluded.uncoveredTargetIds).toEqual(['t5']);
  });
});
