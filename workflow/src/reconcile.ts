import fs from 'fs';
import path from 'path';
import {
  PhaseName,
  UpgradeProgress,
  getPhaseAction,
  readJsonFile,
} from './state';

export interface ReconcileResult {
  changed: boolean;
  progress: UpgradeProgress;
  notes: string[];
}

const HEARTBEAT_STALE_MS = 120 * 1000;
const SCAN_REQUIRED_FILES = ['coverage-targets.json', 'route-checklist.json', 'pages.json'];

export function reconcileProgress(
  stateDir: string,
  progress: UpgradeProgress,
  nowIso: string,
): ReconcileResult {
  const next = clone(progress);
  const notes: string[] = [];
  let changed = false;

  if (next.phases.scan.status === 'done') {
    const missing = SCAN_REQUIRED_FILES.filter(
      (file) => !fs.existsSync(path.join(stateDir, file)),
    );
    if (missing.length > 0) {
      next.phases.scan = { status: 'pending' };
      next.currentPhase = 'scan';
      next.resume = {
        nextAction: getPhaseAction('scan'),
        description: `Scan artifacts missing: ${missing.join(', ')}`,
      };
      notes.push(`scan reverted: missing ${missing.join(', ')}`);
      changed = true;
    }
  }

  const runtimeStatePath = path.join(stateDir, 'runtime-state.json');
  let runtimeState: { heartbeatAt?: string; currentRouteId?: string; phase?: string } | null = null;
  if (fs.existsSync(runtimeStatePath)) {
    try {
      runtimeState = readJsonFile(runtimeStatePath);
    } catch {
      runtimeState = null;
    }
  }
  const nowMs = Date.parse(nowIso);
  const baselineRoutes = next.items.baselineCoverage.routes;
  for (const [routeId, route] of Object.entries(baselineRoutes)) {
    if (route.status !== 'running') continue;
    const heartbeatIso = runtimeState && runtimeState.currentRouteId === routeId
      ? runtimeState.heartbeatAt
      : undefined;
    const heartbeatMs = heartbeatIso ? Date.parse(heartbeatIso) : NaN;
    const ageMs = Number.isFinite(heartbeatMs) ? nowMs - heartbeatMs : Infinity;
    if (ageMs > HEARTBEAT_STALE_MS) {
      baselineRoutes[routeId] = { ...route, status: 'stale' };
      notes.push(`baseline route ${routeId} marked stale (heartbeat age ${Math.round(ageMs / 1000)}s)`);
      changed = true;
    }
  }

  const afterRoutes = next.items.afterRuntime.routes;
  for (const [routeId, route] of Object.entries(afterRoutes)) {
    if (route.status === 'blocked' || route.status === 'done') continue;
    const fixesPath = path.join(stateDir, 'runs', 'after', 'routes', routeId, 'fixes.json');
    if (!fs.existsSync(fixesPath)) continue;
    if (!route.commit) {
      afterRoutes[routeId] = {
        ...route,
        status: 'blocked',
        blockReason: 'fixes.json present but no commit recorded for after route',
      };
      notes.push(`after route ${routeId} blocked: no commit recorded`);
      changed = true;
    }
  }

  if (changed) next.updatedAt = nowIso;

  return { changed, progress: next, notes };
}

function clone(progress: UpgradeProgress): UpgradeProgress {
  return JSON.parse(JSON.stringify(progress)) as UpgradeProgress;
}

export function nextPhaseAction(progress: UpgradeProgress): string {
  if (progress.currentPhase === 'done') return 'done';
  return getPhaseAction(progress.currentPhase as PhaseName);
}
