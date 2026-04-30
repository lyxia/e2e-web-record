import fs from 'fs';
import os from 'os';
import path from 'path';
import { runScanPhase } from '../src/runScanPhase';

const fixtureRoot = path.resolve(__dirname, '..', '..', 'scan', '__tests__', 'fixtures', 'mini-app');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

describe('runScanPhase', () => {
  it('writes scan artifacts and updates progress to apiDiff', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-phase-'));
    fs.writeFileSync(
      path.join(stateDir, 'manifest.json'),
      JSON.stringify({
        runtime: {
          baseUrl: 'http://x/',
          targetPackages: ['@example/ui'],
        },
      }),
    );

    const result = runScanPhase({ stateDir, projectRoot: fixtureRoot, nowIso: '2026-04-30T00:00:00Z' });

    expect(fs.existsSync(path.join(stateDir, 'coverage-targets.json'))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, 'route-checklist.json'))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, 'pages.json'))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, 'progress.scan.snapshot.json'))).toBe(true);

    const progress = readJson<any>(path.join(stateDir, 'progress.json'));
    expect(progress.phases.scan.status).toBe('done');
    expect(progress.currentPhase).toBe('apiDiff');
    expect(progress.resume.nextAction).toBe('run-api-diff');
    expect(result.summary.targetCount).toBeGreaterThan(0);
  });

  it('throws when manifest target packages are missing', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-phase-bad-'));
    fs.writeFileSync(path.join(stateDir, 'manifest.json'), JSON.stringify({ runtime: {} }));

    expect(() => runScanPhase({ stateDir, projectRoot: fixtureRoot, nowIso: '2026-04-30T00:00:00Z' })).toThrow(
      /targetPackages/,
    );
  });
});
