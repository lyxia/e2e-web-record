import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  atomicWriteJson,
  createInitialProgress,
  loadOrCreateProgress,
  markPhaseDone,
  readJsonFile,
  updateBaselineRoute,
  writeProgressSnapshot,
} from '../src/state';

describe('state utilities', () => {
  it('writes json atomically and preserves previous content as .bak', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(dir, 'progress.json');
    atomicWriteJson(file, { version: 1 });
    atomicWriteJson(file, { version: 2 });
    expect(readJsonFile(file)).toEqual({ version: 2 });
    expect(readJsonFile(`${file}.bak`)).toEqual({ version: 1 });
  });

  it('creates initial progress with local resume instruction', () => {
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    expect(progress.currentPhase).toBe('scan');
    expect(progress.phases.bootstrap.status).toBe('done');
    expect(progress.resume.nextAction).toBe('run-scan');
  });

  it('loads or creates progress.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const progress = loadOrCreateProgress(dir, '2026-04-30T00:00:00Z');
    expect(readJsonFile(path.join(dir, 'progress.json'))).toEqual(progress);
  });

  it('marks phase done and writes snapshots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const progress = markPhaseDone(
      createInitialProgress('2026-04-30T00:00:00Z'),
      'scan',
      'apiDiff',
      '2026-04-30T00:01:00Z',
    );
    writeProgressSnapshot(dir, 'scan', progress);
    expect(progress.currentPhase).toBe('apiDiff');
    expect(progress.phases.scan.status).toBe('done');
    expect(progress.phases.scan.completedAt).toBe('2026-04-30T00:01:00Z');
    expect(readJsonFile(path.join(dir, 'progress.scan.snapshot.json'))).toEqual(progress);
  });

  it('updates baseline route progress immutably', () => {
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    const next = updateBaselineRoute(progress, 'course-center', {
      status: 'done',
      routePath: '/course-center',
    });
    expect(progress.items.baselineCoverage.routes['course-center']).toBeUndefined();
    expect(next.items.baselineCoverage.routes['course-center'].status).toBe('done');
    expect(next.items.baselineCoverage.routes['course-center'].routePath).toBe('/course-center');
  });
});
