import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateAfterRuntimeQualityGate } from '../src/afterRuntimeQualityGate';

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function writeFile(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeFakeFfprobe(dir: string, duration: number): string {
  const ffprobe = path.join(dir, 'ffprobe');
  fs.writeFileSync(
    ffprobe,
    `#!/bin/sh\nprintf '{"format":{"duration":"${duration}"}}\\n'\n`,
    { mode: 0o755 },
  );
  return ffprobe;
}

function setup(): { stateDir: string; ffprobePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-gate-'));
  const stateDir = path.join(root, 'coverage-state');
  const ffprobePath = writeFakeFfprobe(root, 2);

  writeJson(path.join(stateDir, 'after-runtime-plan.json'), {
    routes: [
      {
        routeId: 'r1',
        expectedTargetIds: ['t1', 't2'],
      },
    ],
  });

  const routeDir = path.join(stateDir, 'runs', 'after', 'routes', 'r1');
  writeJson(path.join(routeDir, 'result.json'), {
    routeId: 'r1',
    status: 'passed',
    expectedTargetIds: ['t1', 't2'],
    missingTargetIds: [],
  });
  writeJson(path.join(routeDir, 'final', 'coverage.json'), {
    confirmedTargetIds: ['t1', 't2'],
  });

  for (const phase of ['initial', 'final']) {
    writeFile(path.join(routeDir, phase, 'trace.zip'), Buffer.from('PK\x03\x04 trace.trace\n'));
    writeFile(path.join(routeDir, phase, 'video.webm'), Buffer.alloc(1024));
  }

  return { stateDir, ffprobePath };
}

describe('validateAfterRuntimeQualityGate', () => {
  it('accepts passed route with complete trace, video, result, and final coverage', () => {
    const { stateDir, ffprobePath } = setup();

    const result = validateAfterRuntimeQualityGate({ stateDir, ffprobePath, minVideoBytes: 100, minVideoSeconds: 1 });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('rejects passed route when final video is missing', () => {
    const { stateDir, ffprobePath } = setup();
    fs.unlinkSync(path.join(stateDir, 'runs', 'after', 'routes', 'r1', 'final', 'video.webm'));

    const result = validateAfterRuntimeQualityGate({ stateDir, ffprobePath, minVideoBytes: 100, minVideoSeconds: 1 });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('r1 final/video.webm is missing'),
      ]),
    );
  });

  it('rejects passed route when result does not cover expected targets', () => {
    const { stateDir, ffprobePath } = setup();
    writeJson(path.join(stateDir, 'runs', 'after', 'routes', 'r1', 'result.json'), {
      routeId: 'r1',
      status: 'passed',
      expectedTargetIds: ['t1', 't2'],
      missingTargetIds: ['t2'],
    });

    const result = validateAfterRuntimeQualityGate({ stateDir, ffprobePath, minVideoBytes: 100, minVideoSeconds: 1 });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('r1 result.json cannot be passed with missingTargetIds'),
      ]),
    );
  });
});
