import fs from 'fs';
import path from 'path';

export interface CoverageManifest {
  baseUrl?: string;
  runtime?: {
    targetPackages?: unknown;
  };
}

export function resolveStateDir(argStateDir?: string): string {
  return path.resolve(argStateDir || process.env.STATE_DIR || 'coverage-state');
}

export function loadManifest(stateDir: string): CoverageManifest {
  const manifestPath = path.join(stateDir, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CoverageManifest;
}

export function validateTargetPackages(targetPackages: unknown): string[] {
  if (
    !Array.isArray(targetPackages) ||
    targetPackages.length === 0 ||
    targetPackages.some((packageName) => typeof packageName !== 'string' || packageName.length === 0)
  ) {
    throw new Error('manifest runtime.targetPackages must be a non-empty array of strings');
  }

  return targetPackages;
}
