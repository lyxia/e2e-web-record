import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteJson, createInitialProgress, markPhaseDone, updateBaselineRoute, updateAfterRoute } from '../src/state';
import { reconcileProgress } from '../src/reconcile';

function mkStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
}

describe('reconcileProgress', () => {
  it('reverts scan to in_progress when scan artifacts are missing', () => {
    const dir = mkStateDir();
    const progress = markPhaseDone(
      createInitialProgress('2026-04-30T00:00:00Z'),
      'scan',
      'apiDiff',
      '2026-04-30T00:01:00Z',
    );
    const result = reconcileProgress(dir, progress, '2026-04-30T01:00:00Z');
    expect(result.changed).toBe(true);
    expect(result.progress.phases.scan.status).toBe('pending');
    expect(result.progress.currentPhase).toBe('scan');
    expect(result.progress.resume.nextAction).toBe('run-scan');
  });

  it('keeps scan done when artifacts are present', () => {
    const dir = mkStateDir();
    const progress = markPhaseDone(
      createInitialProgress('2026-04-30T00:00:00Z'),
      'scan',
      'apiDiff',
      '2026-04-30T00:01:00Z',
    );
    atomicWriteJson(path.join(dir, 'coverage-targets.json'), { schemaVersion: 1, targets: [] });
    atomicWriteJson(path.join(dir, 'route-checklist.json'), { schemaVersion: 1, selectedRoutes: [] });
    atomicWriteJson(path.join(dir, 'pages.json'), { schemaVersion: 1, pages: [] });
    const result = reconcileProgress(dir, progress, '2026-04-30T01:00:00Z');
    expect(result.changed).toBe(false);
    expect(result.progress.phases.scan.status).toBe('done');
  });

  it('marks running baseline route as stale when heartbeat is older than 120s', () => {
    const dir = mkStateDir();
    let progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress = updateBaselineRoute(progress, 'r1', { status: 'running', routePath: '/r1' });
    atomicWriteJson(path.join(dir, 'runtime-state.json'), {
      heartbeatAt: '2026-04-30T01:00:00Z',
      currentRouteId: 'r1',
      phase: 'baseline',
    });
    const result = reconcileProgress(dir, progress, '2026-04-30T01:05:00Z');
    expect(result.changed).toBe(true);
    expect(result.progress.items.baselineCoverage.routes.r1.status).toBe('stale');
  });

  it('keeps baseline route running when heartbeat is recent', () => {
    const dir = mkStateDir();
    let progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress = updateBaselineRoute(progress, 'r1', { status: 'running', routePath: '/r1' });
    atomicWriteJson(path.join(dir, 'runtime-state.json'), {
      heartbeatAt: '2026-04-30T01:00:00Z',
      currentRouteId: 'r1',
      phase: 'baseline',
    });
    const result = reconcileProgress(dir, progress, '2026-04-30T01:01:00Z');
    expect(result.progress.items.baselineCoverage.routes.r1.status).toBe('running');
    expect(result.changed).toBe(false);
  });

  it('marks after route as blocked when fixes.json exists without recorded commit', () => {
    const dir = mkStateDir();
    let progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress = updateAfterRoute(progress, 'r1', { status: 'running', routePath: '/r1' });
    const fixesPath = path.join(dir, 'runs', 'after', 'routes', 'r1', 'fixes.json');
    fs.mkdirSync(path.dirname(fixesPath), { recursive: true });
    fs.writeFileSync(fixesPath, JSON.stringify({ fixes: [{ id: 'f1' }] }));
    const result = reconcileProgress(dir, progress, '2026-04-30T01:00:00Z');
    expect(result.changed).toBe(true);
    expect(result.progress.items.afterRuntime.routes.r1.status).toBe('blocked');
    expect(result.progress.items.afterRuntime.routes.r1.blockReason).toMatch(/commit/);
  });

  it('does not block after route when commit is recorded', () => {
    const dir = mkStateDir();
    let progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress = updateAfterRoute(progress, 'r1', { status: 'running', routePath: '/r1', commit: 'abc1234' });
    const fixesPath = path.join(dir, 'runs', 'after', 'routes', 'r1', 'fixes.json');
    fs.mkdirSync(path.dirname(fixesPath), { recursive: true });
    fs.writeFileSync(fixesPath, JSON.stringify({ fixes: [{ id: 'f1' }] }));
    const result = reconcileProgress(dir, progress, '2026-04-30T01:00:00Z');
    expect(result.progress.items.afterRuntime.routes.r1.status).toBe('running');
  });
});
