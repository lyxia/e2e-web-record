import path from 'path';
import { runScan, RunScanSummary } from '../../scan/src/runScan';
import { loadManifest, resolveManifestBaseUrl, validateTargetPackages } from './manifest';
import {
  loadOrCreateProgress,
  markPhaseDone,
  writeProgress,
  writeProgressSnapshot,
} from './state';

export interface RunScanPhaseOptions {
  stateDir: string;
  projectRoot: string;
  nowIso?: string;
}

export interface RunScanPhaseResult {
  summary: RunScanSummary;
  stateDir: string;
}

export function runScanPhase(options: RunScanPhaseOptions): RunScanPhaseResult {
  const stateDir = path.resolve(options.stateDir);
  const projectRoot = path.resolve(options.projectRoot);
  const nowIso = options.nowIso ?? new Date().toISOString();

  const manifest = loadManifest(stateDir);
  const targetPackages = validateTargetPackages(manifest.runtime?.targetPackages);
  const baseUrl = resolveManifestBaseUrl(manifest);

  const summary = runScan({
    projectRoot,
    outDir: stateDir,
    baseUrl,
    targetPackages,
  });

  const initial = loadOrCreateProgress(stateDir, nowIso);
  const updated = markPhaseDone(initial, 'scan', 'apiDiff', nowIso);
  writeProgress(stateDir, updated);
  writeProgressSnapshot(stateDir, 'scan', updated);

  return { summary, stateDir };
}
