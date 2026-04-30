import fs from 'fs';
import path from 'path';

export type PhaseName =
  | 'bootstrap'
  | 'scan'
  | 'apiDiff'
  | 'build'
  | 'baselineCoverage'
  | 'afterRuntime'
  | 'report';

export type PhaseStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface PhaseProgress {
  status: PhaseStatus;
  completedAt?: string;
  startedAt?: string;
}

export type RouteStatus = 'pending' | 'running' | 'done' | 'skipped' | 'stale' | 'blocked';

export interface RouteItemProgress {
  status: RouteStatus;
  routePath?: string;
  routeId?: string;
  commit?: string;
  blockReason?: string;
  startedAt?: string;
  completedAt?: string;
  remainingTargetIds?: string[];
}

export interface ResumeHint {
  nextAction: string;
  description?: string;
}

export interface UpgradeProgress {
  schemaVersion: 1;
  startedAt: string;
  updatedAt: string;
  currentPhase: PhaseName | 'done';
  phases: Record<PhaseName, PhaseProgress>;
  items: {
    baselineCoverage: { routes: Record<string, RouteItemProgress> };
    afterRuntime: { routes: Record<string, RouteItemProgress> };
  };
  resume: ResumeHint;
}

const PHASE_ORDER: PhaseName[] = [
  'bootstrap',
  'scan',
  'apiDiff',
  'build',
  'baselineCoverage',
  'afterRuntime',
  'report',
];

const PHASE_TO_ACTION: Record<PhaseName, string> = {
  bootstrap: 'bootstrap',
  scan: 'run-scan',
  apiDiff: 'run-api-diff',
  build: 'run-build',
  baselineCoverage: 'run-baseline-recorder',
  afterRuntime: 'run-after-runtime',
  report: 'run-report',
};

export function readJsonFile<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(filePath)) {
    const bak = `${filePath}.bak`;
    if (fs.existsSync(bak)) fs.rmSync(bak);
    fs.renameSync(filePath, bak);
  }
  fs.renameSync(tmp, filePath);
}

export function createInitialProgress(startedAt: string): UpgradeProgress {
  const phases = PHASE_ORDER.reduce<Record<PhaseName, PhaseProgress>>((acc, phase) => {
    acc[phase] = { status: 'pending' };
    return acc;
  }, {} as Record<PhaseName, PhaseProgress>);
  phases.bootstrap = { status: 'done', completedAt: startedAt };

  return {
    schemaVersion: 1,
    startedAt,
    updatedAt: startedAt,
    currentPhase: 'scan',
    phases,
    items: {
      baselineCoverage: { routes: {} },
      afterRuntime: { routes: {} },
    },
    resume: {
      nextAction: PHASE_TO_ACTION.scan,
      description: 'Run static scan to produce coverage targets and route checklist.',
    },
  };
}

export function loadOrCreateProgress(stateDir: string, startedAt: string): UpgradeProgress {
  const file = path.join(stateDir, 'progress.json');
  if (fs.existsSync(file)) {
    return readJsonFile<UpgradeProgress>(file);
  }
  const progress = createInitialProgress(startedAt);
  atomicWriteJson(file, progress);
  return progress;
}

export function markPhaseDone(
  progress: UpgradeProgress,
  phase: PhaseName,
  nextPhase: PhaseName | 'done',
  completedAt: string,
): UpgradeProgress {
  const next = cloneProgress(progress);
  next.phases[phase] = { ...next.phases[phase], status: 'done', completedAt };
  next.currentPhase = nextPhase;
  next.updatedAt = completedAt;
  if (nextPhase === 'done') {
    next.resume = { nextAction: 'done', description: 'All phases complete.' };
  } else {
    next.resume = {
      nextAction: PHASE_TO_ACTION[nextPhase],
      description: `Run phase ${nextPhase}.`,
    };
  }
  return next;
}

export function updateBaselineRoute(
  progress: UpgradeProgress,
  routeId: string,
  partial: Partial<RouteItemProgress>,
): UpgradeProgress {
  const next = cloneProgress(progress);
  const existing = next.items.baselineCoverage.routes[routeId] ?? { status: 'pending' };
  next.items.baselineCoverage.routes[routeId] = { ...existing, ...partial };
  return next;
}

export function updateAfterRoute(
  progress: UpgradeProgress,
  routeId: string,
  partial: Partial<RouteItemProgress>,
): UpgradeProgress {
  const next = cloneProgress(progress);
  const existing = next.items.afterRuntime.routes[routeId] ?? { status: 'pending' };
  next.items.afterRuntime.routes[routeId] = { ...existing, ...partial };
  return next;
}

export function writeProgressSnapshot(stateDir: string, phase: PhaseName, progress: UpgradeProgress): void {
  atomicWriteJson(path.join(stateDir, `progress.${phase}.snapshot.json`), progress);
}

export function writeProgress(stateDir: string, progress: UpgradeProgress): void {
  atomicWriteJson(path.join(stateDir, 'progress.json'), progress);
}

export function getPhaseAction(phase: PhaseName | 'done'): string {
  if (phase === 'done') return 'done';
  return PHASE_TO_ACTION[phase];
}

function cloneProgress(progress: UpgradeProgress): UpgradeProgress {
  return JSON.parse(JSON.stringify(progress)) as UpgradeProgress;
}
