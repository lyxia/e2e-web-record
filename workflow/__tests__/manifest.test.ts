import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadManifest, resolveManifestBaseUrl } from '../src/manifest';

it('loads complete upgrade manifest fields without dropping data', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  const manifest = {
    schemaVersion: 1,
    project: 'demo-app',
    library: '@example/ui',
    baseline: { version: '1.0.0', commit: 'abc123', worktreePath: '/tmp/demo-baseline' },
    after: { version: '1.1.0', branch: 'feature/upgrade-ui' },
    runtime: {
      targetPackages: ['@example/ui'],
      devCommand: 'yarn start',
      devPort: 3033,
      baseUrl: 'https://example.test/app',
      proxy: 'http://127.0.0.1:8899',
      playwrightProfile: 'coverage-state/.playwright-profile',
    },
    startedAt: '2026-04-30T00:00:00Z',
    operator: 'tester',
  };
  fs.writeFileSync(path.join(stateDir, 'manifest.json'), JSON.stringify(manifest));

  expect(loadManifest(stateDir)).toEqual(manifest);
});

it('resolves baseUrl from runtime before legacy top-level baseUrl', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    JSON.stringify({
      baseUrl: 'https://legacy.example.test',
      runtime: { baseUrl: 'https://runtime.example.test', targetPackages: ['@example/ui'] },
    }),
  );

  expect(resolveManifestBaseUrl(loadManifest(stateDir))).toBe('https://runtime.example.test');
});

it('falls back to legacy baseUrl when runtime.baseUrl is missing', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    JSON.stringify({
      baseUrl: 'https://legacy.example.test',
      runtime: { targetPackages: ['@example/ui'] },
    }),
  );

  expect(resolveManifestBaseUrl(loadManifest(stateDir))).toBe('https://legacy.example.test');
});
