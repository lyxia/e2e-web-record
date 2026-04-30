import fs from 'fs';
import path from 'path';

export interface CoverageManifest {
  schemaVersion?: number;
  project?: string;
  library?: string;
  baseUrl?: string;
  baseline?: { version?: string; commit?: string; worktreePath?: string };
  after?: { version?: string; branch?: string };
  runtime?: {
    targetPackages?: unknown;
    devCommand?: string;
    devPort?: number;
    baseUrl?: string;
    proxy?: string | null;
    playwrightProfile?: string;
  };
  startedAt?: string;
  operator?: string;
}

export function resolveStateDir(argStateDir?: string): string {
  return path.resolve(argStateDir || process.env.STATE_DIR || 'coverage-state');
}

export function loadManifest(stateDir: string): CoverageManifest {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'manifest.json'), 'utf8')) as CoverageManifest;
}

export function resolveManifestBaseUrl(manifest: CoverageManifest): string | undefined {
  return manifest.runtime?.baseUrl || manifest.baseUrl;
}

export function validateTargetPackages(targetPackages: unknown): string[] {
  if (
    !Array.isArray(targetPackages) ||
    targetPackages.length === 0 ||
    targetPackages.some((packageName) => typeof packageName !== 'string' || packageName.length === 0)
  ) {
    throw new Error('manifest runtime.targetPackages must be a non-empty array of strings');
  }
  return targetPackages as string[];
}
