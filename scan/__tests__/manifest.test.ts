import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadManifest, resolveStateDir, validateTargetPackages } from '../src/manifest';

describe('manifest helpers', () => {
  const originalEnv = process.env.STATE_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STATE_DIR;
    } else {
      process.env.STATE_DIR = originalEnv;
    }
  });

  it('resolves state directory with arg taking priority over env and default', () => {
    process.env.STATE_DIR = 'env-state';

    expect(resolveStateDir('arg-state')).toBe(path.resolve('arg-state'));
  });

  it('resolves state directory from env before default', () => {
    process.env.STATE_DIR = 'env-state';

    expect(resolveStateDir()).toBe(path.resolve('env-state'));
  });

  it('defaults state directory to coverage-state', () => {
    delete process.env.STATE_DIR;

    expect(resolveStateDir()).toBe(path.resolve('coverage-state'));
  });

  it('loads manifest.json from state directory', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
    fs.writeFileSync(
      path.join(stateDir, 'manifest.json'),
      JSON.stringify({ baseUrl: 'http://example.test', runtime: { targetPackages: ['@example/ui'] } }),
    );

    expect(loadManifest(stateDir)).toEqual({
      baseUrl: 'http://example.test',
      runtime: { targetPackages: ['@example/ui'] },
    });
  });

  it('validates non-empty string target package arrays', () => {
    expect(validateTargetPackages(['@example/ui'])).toEqual(['@example/ui']);
    expect(() => validateTargetPackages([])).toThrow(/targetPackages/);
    expect(() => validateTargetPackages('@example/ui')).toThrow(/targetPackages/);
    expect(() => validateTargetPackages(['@example/ui', 1])).toThrow(/targetPackages/);
  });
});
