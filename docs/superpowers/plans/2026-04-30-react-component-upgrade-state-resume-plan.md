# React Component Upgrade State Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local state and resume foundation for the complete `react-component-upgrade` skill.

**Architecture:** Add state utilities inside the existing `scan` workspace so the same TypeScript toolchain can build distributable Node scripts. `state.ts` owns manifest/progress types, atomic JSON writes, phase snapshots, and progress updates. `resume.ts` reconciles artifacts against progress and prints the next action as machine-readable JSON plus a short human summary.

**Tech Stack:** TypeScript 4.6, Node 16, Jest/ts-jest, esbuild, existing yarn workspaces.

---

## Scope

This is Plan 1 of the full skill implementation. It implements only the state-localization base required by later phases:

- New `coverage-state` manifest/progress schema.
- Atomic JSON writes with `.bak`.
- Progress initialization and phase/item updates.
- Artifact reconciliation for scan, baseline coverage, and after runtime.
- `resume.js` CLI bundled into the skill.

It does not implement api diff, action timeline capture, after-runtime subagent prompts, or final report generation.

## File Structure

- `scan/src/manifest.ts`: expand manifest schema while keeping current scan helpers.
- `scan/src/state.ts`: progress schema, atomic JSON write, snapshots, initialization, updates.
- `scan/src/reconcile.ts`: pure artifact checks and resume decision logic.
- `scan/src/resume.ts`: CLI entry that runs reconcile and prints the next action.
- `scan/__tests__/state.test.ts`: unit tests for atomic writes, initialization, snapshots.
- `scan/__tests__/reconcile.test.ts`: unit tests for artifact drift and stale heartbeat behavior.
- `scan/__tests__/resumeCli.test.ts`: CLI-level tests for stdout and exit behavior.
- `scan/package.json`: add `build:resume` script.
- `scripts/build-skill.ts`: copy `resume.js` to the distributable skill.
- `skill-template/SKILL.md.tpl`: require running `resume.js` at skill activation.

## Task 1: Expand Manifest Schema

**Files:**
- Modify: `scan/src/manifest.ts`
- Modify: `scan/__tests__/manifest.test.ts`

- [ ] **Step 1: Write failing tests for full manifest fields**

Add these tests to `scan/__tests__/manifest.test.ts`:

```ts
it('loads complete upgrade manifest fields without dropping data', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  const manifest = {
    schemaVersion: 1,
    project: 'demo-app',
    library: '@example/ui',
    baseline: {
      version: '1.0.0',
      commit: 'abc123',
      worktreePath: '/tmp/demo-baseline',
    },
    after: {
      version: '1.1.0',
      branch: 'feature/upgrade-ui',
    },
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

it('reads baseUrl from runtime before legacy top-level baseUrl', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    JSON.stringify({
      baseUrl: 'https://legacy.example.test',
      runtime: {
        baseUrl: 'https://runtime.example.test',
        targetPackages: ['@example/ui'],
      },
    }),
  );

  expect(resolveManifestBaseUrl(loadManifest(stateDir))).toBe('https://runtime.example.test');
});
```

- [ ] **Step 2: Run manifest tests and verify failure**

Run:

```bash
yarn workspace scan test --runInBand __tests__/manifest.test.ts
```

Expected: FAIL with `resolveManifestBaseUrl is not a function` or TypeScript compile failure.

- [ ] **Step 3: Implement manifest interfaces and base URL resolver**

Replace `scan/src/manifest.ts` with:

```ts
import fs from 'fs';
import path from 'path';

export interface CoverageManifest {
  schemaVersion?: number;
  project?: string;
  library?: string;
  baseUrl?: string;
  baseline?: {
    version?: string;
    commit?: string;
    worktreePath?: string;
  };
  after?: {
    version?: string;
    branch?: string;
  };
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
  const manifestPath = path.join(stateDir, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CoverageManifest;
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

  return targetPackages;
}
```

- [ ] **Step 4: Update scan CLI to use runtime baseUrl**

Modify `scan/src/index.ts`:

```ts
import { loadManifest, resolveManifestBaseUrl, resolveStateDir, validateTargetPackages } from './manifest';
```

and change the `runScan` call:

```ts
  const summary = runScan({
    projectRoot: process.cwd(),
    outDir: stateDir,
    baseUrl: resolveManifestBaseUrl(manifest),
    targetPackages,
  });
```

- [ ] **Step 5: Run tests**

Run:

```bash
yarn workspace scan test --runInBand __tests__/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scan/src/manifest.ts scan/src/index.ts scan/__tests__/manifest.test.ts
git commit -m "feat(state): expand manifest schema for upgrade workflow"
```

## Task 2: Add Atomic State Utilities

**Files:**
- Create: `scan/src/state.ts`
- Create: `scan/__tests__/state.test.ts`

- [ ] **Step 1: Write failing tests for atomic JSON writes and progress initialization**

Create `scan/__tests__/state.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  atomicWriteJson,
  createInitialProgress,
  isoNow,
  readJsonFile,
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
    expect(fs.readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('creates initial progress with all phases pending except bootstrap done', () => {
    const now = '2026-04-30T00:00:00Z';
    expect(createInitialProgress(now)).toMatchObject({
      schemaVersion: 1,
      currentPhase: 'scan',
      phases: {
        bootstrap: { status: 'done', completedAt: now },
        scan: { status: 'pending' },
        apiDiff: { status: 'pending' },
        build: { status: 'pending' },
        baselineCoverage: { status: 'pending' },
        afterRuntime: { status: 'pending' },
        report: { status: 'pending' },
      },
      items: {
        baselineCoverage: { routes: {} },
        afterRuntime: { routes: {} },
      },
    });
  });

  it('writes phase snapshots using canonical filenames', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const progress = createInitialProgress('2026-04-30T00:00:00Z');

    writeProgressSnapshot(dir, 'scan', progress);

    expect(readJsonFile(path.join(dir, 'progress.scan.snapshot.json'))).toEqual(progress);
  });

  it('formats current timestamps as ISO strings', () => {
    expect(isoNow()).toMatch(/^\\d{4}-\\d{2}-\\d{2}T/);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
yarn workspace scan test --runInBand __tests__/state.test.ts
```

Expected: FAIL because `scan/src/state.ts` does not exist.

- [ ] **Step 3: Implement state utilities**

Create `scan/src/state.ts`:

```ts
import fs from 'fs';
import path from 'path';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked';
export type ItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked' | 'stale';
export type PhaseName = 'bootstrap' | 'scan' | 'apiDiff' | 'build' | 'baselineCoverage' | 'afterRuntime' | 'report';

export interface PhaseProgress {
  status: PhaseStatus;
  startedAt?: string;
  completedAt?: string;
  reason?: string;
}

export interface RouteItemProgress {
  status: ItemStatus;
  routePath?: string;
  coveragePath?: string;
  resultPath?: string;
  resumeAction?: string;
  reason?: string;
  commit?: string;
}

export interface ResumeInstruction {
  nextAction: string;
  phase: PhaseName;
  itemId?: string;
  reason: string;
  command?: string;
}

export interface UpgradeProgress {
  schemaVersion: 1;
  currentPhase: PhaseName | 'done';
  phases: Record<PhaseName, PhaseProgress>;
  items: {
    baselineCoverage: { routes: Record<string, RouteItemProgress> };
    afterRuntime: { routes: Record<string, RouteItemProgress> };
  };
  resume: ResumeInstruction;
  lastUpdate: string;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function readJsonFile<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\\n`, 'utf8');
  const fd = fs.openSync(tmpPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, `${filePath}.bak`);
  }
  fs.renameSync(tmpPath, filePath);
}

export function createInitialProgress(now = isoNow()): UpgradeProgress {
  return {
    schemaVersion: 1,
    currentPhase: 'scan',
    phases: {
      bootstrap: { status: 'done', completedAt: now },
      scan: { status: 'pending' },
      apiDiff: { status: 'pending' },
      build: { status: 'pending' },
      baselineCoverage: { status: 'pending' },
      afterRuntime: { status: 'pending' },
      report: { status: 'pending' },
    },
    items: {
      baselineCoverage: { routes: {} },
      afterRuntime: { routes: {} },
    },
    resume: {
      nextAction: 'run-scan',
      phase: 'scan',
      reason: 'scan phase has not started',
      command: 'node $SKILL_DIR/scripts/scan.js --state-dir coverage-state',
    },
    lastUpdate: now,
  };
}

export function writeProgressSnapshot(stateDir: string, phase: PhaseName, progress: UpgradeProgress): void {
  atomicWriteJson(path.join(stateDir, `progress.${phaseNameToFilePart(phase)}.snapshot.json`), progress);
}

export function phaseNameToFilePart(phase: PhaseName): string {
  return phase
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^api-diff$/, 'api-diff');
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
yarn workspace scan test --runInBand __tests__/state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scan/src/state.ts scan/__tests__/state.test.ts
git commit -m "feat(state): add atomic progress utilities"
```

## Task 3: Add Progress Load and Update Operations

**Files:**
- Modify: `scan/src/state.ts`
- Modify: `scan/__tests__/state.test.ts`

- [ ] **Step 1: Write failing tests for loading and updating progress**

Update the existing import from `../src/state` in `scan/__tests__/state.test.ts` so it includes the new functions:

```ts
import {
  atomicWriteJson,
  createInitialProgress,
  isoNow,
  loadOrCreateProgress,
  markPhaseDone,
  readJsonFile,
  updateBaselineRoute,
  writeProgressSnapshot,
} from '../src/state';
```

Then append these tests to `scan/__tests__/state.test.ts`:

```ts
it('creates progress.json when missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));

  const progress = loadOrCreateProgress(dir, '2026-04-30T00:00:00Z');

  expect(progress.currentPhase).toBe('scan');
  expect(readJsonFile(path.join(dir, 'progress.json'))).toEqual(progress);
});

it('loads existing progress.json without changing it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
  const initial = createInitialProgress('2026-04-30T00:00:00Z');
  atomicWriteJson(path.join(dir, 'progress.json'), initial);

  expect(loadOrCreateProgress(dir, '2026-04-30T01:00:00Z')).toEqual(initial);
});

it('marks a phase done and advances currentPhase', () => {
  const progress = createInitialProgress('2026-04-30T00:00:00Z');

  const next = markPhaseDone(progress, 'scan', 'apiDiff', '2026-04-30T00:10:00Z');

  expect(next.phases.scan.status).toBe('done');
  expect(next.phases.scan.completedAt).toBe('2026-04-30T00:10:00Z');
  expect(next.currentPhase).toBe('apiDiff');
  expect(next.resume.nextAction).toBe('run-api-diff');
});

it('updates baseline route progress immutably', () => {
  const progress = createInitialProgress('2026-04-30T00:00:00Z');

  const next = updateBaselineRoute(progress, 'course-center', {
    status: 'done',
    routePath: '/course-center',
    coveragePath: 'runs/baseline-1.0.0/routes/course-center/coverage.json',
  });

  expect(progress.items.baselineCoverage.routes['course-center']).toBeUndefined();
  expect(next.items.baselineCoverage.routes['course-center']).toMatchObject({
    status: 'done',
    routePath: '/course-center',
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
yarn workspace scan test --runInBand __tests__/state.test.ts
```

Expected: FAIL because the new functions are not exported.

- [ ] **Step 3: Implement progress operations**

Append to `scan/src/state.ts`:

```ts
export function loadOrCreateProgress(stateDir: string, now = isoNow()): UpgradeProgress {
  const progressPath = path.join(stateDir, 'progress.json');
  if (fs.existsSync(progressPath)) {
    return readJsonFile<UpgradeProgress>(progressPath);
  }
  const progress = createInitialProgress(now);
  atomicWriteJson(progressPath, progress);
  return progress;
}

export function markPhaseDone(
  progress: UpgradeProgress,
  phase: PhaseName,
  nextPhase: PhaseName | 'done',
  now = isoNow(),
): UpgradeProgress {
  const next = cloneProgress(progress);
  next.phases[phase] = {
    ...next.phases[phase],
    status: 'done',
    completedAt: now,
  };
  next.currentPhase = nextPhase;
  next.lastUpdate = now;
  next.resume = nextPhase === 'done'
    ? {
        nextAction: 'workflow-complete',
        phase,
        reason: 'all phases are complete',
      }
    : resumeForPhase(nextPhase);
  return next;
}

export function updateBaselineRoute(
  progress: UpgradeProgress,
  routeId: string,
  patch: RouteItemProgress,
  now = isoNow(),
): UpgradeProgress {
  const next = cloneProgress(progress);
  next.items.baselineCoverage.routes[routeId] = {
    ...(next.items.baselineCoverage.routes[routeId] ?? { status: 'pending' }),
    ...patch,
  };
  next.lastUpdate = now;
  return next;
}

export function updateAfterRoute(
  progress: UpgradeProgress,
  routeId: string,
  patch: RouteItemProgress,
  now = isoNow(),
): UpgradeProgress {
  const next = cloneProgress(progress);
  next.items.afterRuntime.routes[routeId] = {
    ...(next.items.afterRuntime.routes[routeId] ?? { status: 'pending' }),
    ...patch,
  };
  next.lastUpdate = now;
  return next;
}

function cloneProgress(progress: UpgradeProgress): UpgradeProgress {
  return JSON.parse(JSON.stringify(progress)) as UpgradeProgress;
}

function resumeForPhase(phase: PhaseName): ResumeInstruction {
  const table: Record<PhaseName, ResumeInstruction> = {
    bootstrap: {
      nextAction: 'bootstrap',
      phase: 'bootstrap',
      reason: 'bootstrap is not complete',
    },
    scan: {
      nextAction: 'run-scan',
      phase: 'scan',
      reason: 'scan phase has not completed',
      command: 'node $SKILL_DIR/scripts/scan.js --state-dir coverage-state',
    },
    apiDiff: {
      nextAction: 'run-api-diff',
      phase: 'apiDiff',
      reason: 'api diff phase has not completed',
      command: 'node $SKILL_DIR/scripts/api-diff.js --state-dir coverage-state',
    },
    build: {
      nextAction: 'run-build-check',
      phase: 'build',
      reason: 'build phase has not completed',
    },
    baselineCoverage: {
      nextAction: 'start-baseline-recorder',
      phase: 'baselineCoverage',
      reason: 'baseline coverage phase has not completed',
      command: 'STATE_DIR=coverage-state python3 $SKILL_DIR/scripts/recorder.py',
    },
    afterRuntime: {
      nextAction: 'run-after-runtime-plan',
      phase: 'afterRuntime',
      reason: 'after runtime phase has not completed',
      command: 'node $SKILL_DIR/scripts/plan-after-runtime.js --state-dir coverage-state',
    },
    report: {
      nextAction: 'run-report',
      phase: 'report',
      reason: 'report phase has not completed',
      command: 'node $SKILL_DIR/scripts/diff-report.js --state-dir coverage-state',
    },
  };
  return table[phase];
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
yarn workspace scan test --runInBand __tests__/state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scan/src/state.ts scan/__tests__/state.test.ts
git commit -m "feat(state): add progress update operations"
```

## Task 4: Implement Artifact Reconciliation

**Files:**
- Create: `scan/src/reconcile.ts`
- Create: `scan/__tests__/reconcile.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Create `scan/__tests__/reconcile.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createInitialProgress, UpgradeProgress } from '../src/state';
import { reconcileProgress } from '../src/reconcile';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe('reconcileProgress', () => {
  it('rolls scan back to pending when scan artifacts are missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress.currentPhase = 'apiDiff';
    progress.phases.scan.status = 'done';

    const result = reconcileProgress(dir, progress, '2026-04-30T00:05:00Z');

    expect(result.progress.currentPhase).toBe('scan');
    expect(result.progress.phases.scan.status).toBe('pending');
    expect(result.progress.resume.nextAction).toBe('run-scan');
    expect(result.changes).toContain('scan artifacts missing; scan marked pending');
  });

  it('keeps scan done when all scan artifacts exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
    writeJson(path.join(dir, 'coverage-targets.json'), { targets: [] });
    writeJson(path.join(dir, 'route-checklist.json'), { selectedRoutes: [] });
    writeJson(path.join(dir, 'pages.json'), { pages: [] });
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress.currentPhase = 'apiDiff';
    progress.phases.scan.status = 'done';

    const result = reconcileProgress(dir, progress, '2026-04-30T00:05:00Z');

    expect(result.progress.phases.scan.status).toBe('done');
    expect(result.changes).toEqual([]);
  });

  it('marks stale baseline route when heartbeat is older than timeout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
    const progress = createInitialProgress('2026-04-30T00:00:00Z') as UpgradeProgress;
    progress.currentPhase = 'baselineCoverage';
    progress.items.baselineCoverage.routes['p1'] = {
      status: 'running',
      routePath: '/p1',
    };
    writeJson(path.join(dir, 'runtime-state.json'), {
      heartbeatAt: '2026-04-30T00:00:00Z',
      phase: 'baseline',
    });

    const result = reconcileProgress(dir, progress, '2026-04-30T00:02:01Z');

    expect(result.progress.items.baselineCoverage.routes.p1.status).toBe('stale');
    expect(result.progress.resume).toMatchObject({
      nextAction: 'restart-recorder-at-route',
      phase: 'baselineCoverage',
      itemId: 'p1',
    });
  });

  it('requires commit before continuing when after fixes exist without commit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress.currentPhase = 'afterRuntime';
    progress.items.afterRuntime.routes['p1'] = {
      status: 'done',
      resultPath: 'runs/after-1.1.0/routes/p1/result.json',
    };
    writeJson(path.join(dir, 'runs/after-1.1.0/routes/p1/fixes.json'), [{ file: 'src/P1.tsx' }]);
    writeJson(path.join(dir, 'runs/after-1.1.0/routes/p1/result.json'), { result: 'pass' });

    const result = reconcileProgress(dir, progress, '2026-04-30T00:05:00Z');

    expect(result.progress.items.afterRuntime.routes.p1.status).toBe('blocked');
    expect(result.progress.resume.nextAction).toBe('commit-after-route-fixes');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
yarn workspace scan test --runInBand __tests__/reconcile.test.ts
```

Expected: FAIL because `scan/src/reconcile.ts` does not exist.

- [ ] **Step 3: Implement reconcile logic**

Create `scan/src/reconcile.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { ResumeInstruction, UpgradeProgress } from './state';

const STALE_HEARTBEAT_MS = 120_000;

export interface ReconcileResult {
  progress: UpgradeProgress;
  changes: string[];
}

export function reconcileProgress(stateDir: string, input: UpgradeProgress, nowIso = new Date().toISOString()): ReconcileResult {
  const progress = clone(input);
  const changes: string[] = [];

  if (progress.phases.scan.status === 'done' && !hasAllScanArtifacts(stateDir)) {
    progress.phases.scan.status = 'pending';
    progress.currentPhase = 'scan';
    progress.resume = {
      nextAction: 'run-scan',
      phase: 'scan',
      reason: 'scan is marked done but one or more scan artifacts are missing',
      command: 'node $SKILL_DIR/scripts/scan.js --state-dir coverage-state',
    };
    changes.push('scan artifacts missing; scan marked pending');
  }

  markStaleBaselineRoutes(stateDir, progress, nowIso, changes);
  blockAfterRoutesWithUncommittedFixes(stateDir, progress, changes);

  if (changes.length > 0) {
    progress.lastUpdate = nowIso;
  }

  return { progress, changes };
}

function hasAllScanArtifacts(stateDir: string): boolean {
  return ['coverage-targets.json', 'route-checklist.json', 'pages.json'].every((fileName) =>
    fs.existsSync(path.join(stateDir, fileName)),
  );
}

function markStaleBaselineRoutes(stateDir: string, progress: UpgradeProgress, nowIso: string, changes: string[]): void {
  const runningRoute = Object.entries(progress.items.baselineCoverage.routes).find(([, route]) => route.status === 'running');
  if (!runningRoute) return;

  const runtimeStatePath = path.join(stateDir, 'runtime-state.json');
  if (!fs.existsSync(runtimeStatePath)) return;

  const runtimeState = JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8')) as { heartbeatAt?: string; lastUpdate?: string };
  const heartbeat = runtimeState.heartbeatAt || runtimeState.lastUpdate;
  if (!heartbeat) return;

  const elapsed = Date.parse(nowIso) - Date.parse(heartbeat);
  if (elapsed <= STALE_HEARTBEAT_MS) return;

  const [routeId, route] = runningRoute;
  route.status = 'stale';
  route.resumeAction = 'restart-recorder-at-route';
  progress.resume = {
    nextAction: 'restart-recorder-at-route',
    phase: 'baselineCoverage',
    itemId: routeId,
    reason: 'baseline recorder heartbeat is stale',
    command: `STATE_DIR=coverage-state python3 $SKILL_DIR/scripts/recorder.py --route ${routeId}`,
  };
  changes.push(`baseline route ${routeId} marked stale`);
}

function blockAfterRoutesWithUncommittedFixes(stateDir: string, progress: UpgradeProgress, changes: string[]): void {
  for (const [routeId, route] of Object.entries(progress.items.afterRuntime.routes)) {
    if (!route.resultPath || route.commit) continue;
    const resultPath = path.join(stateDir, route.resultPath);
    const fixesPath = path.join(path.dirname(resultPath), 'fixes.json');
    if (!fs.existsSync(fixesPath)) continue;

    const fixes = JSON.parse(fs.readFileSync(fixesPath, 'utf8')) as unknown[];
    if (fixes.length === 0) continue;

    route.status = 'blocked';
    route.resumeAction = 'commit-after-route-fixes';
    progress.resume = commitFixesResume(routeId, route.resultPath);
    changes.push(`after route ${routeId} has fixes without commit`);
    return;
  }
}

function commitFixesResume(routeId: string, resultPath: string): ResumeInstruction {
  return {
    nextAction: 'commit-after-route-fixes',
    phase: 'afterRuntime',
    itemId: routeId,
    reason: 'after runtime fixes exist but no commit hash is recorded',
    command: `read coverage-state/${resultPath}, git add listed files, git commit, then update progress`,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
yarn workspace scan test --runInBand __tests__/reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scan/src/reconcile.ts scan/__tests__/reconcile.test.ts
git commit -m "feat(state): reconcile progress with artifacts"
```

## Task 5: Add Resume CLI

**Files:**
- Create: `scan/src/resume.ts`
- Create: `scan/__tests__/resumeCli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create `scan/__tests__/resumeCli.test.ts`:

```ts
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteJson, createInitialProgress } from '../src/state';

function runResume(stateDir: string): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync('node', ['-r', 'ts-node/register', 'src/resume.ts', '--state-dir', stateDir], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
}

describe('resume CLI', () => {
  it('creates progress and prints run-scan action when progress is missing', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
    atomicWriteJson(path.join(stateDir, 'manifest.json'), {
      runtime: { targetPackages: ['@example/ui'], baseUrl: 'https://example.test' },
    });

    const result = runResume(stateDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"nextAction": "run-scan"');
    expect(result.stdout).toContain('Next action: run-scan');
    expect(fs.existsSync(path.join(stateDir, 'progress.json'))).toBe(true);
  });

  it('prints reconcile changes when artifacts are missing', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    progress.currentPhase = 'apiDiff';
    progress.phases.scan.status = 'done';
    atomicWriteJson(path.join(stateDir, 'progress.json'), progress);

    const result = runResume(stateDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('scan artifacts missing; scan marked pending');
    expect(result.stdout).toContain('"phase": "scan"');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
yarn workspace scan test --runInBand __tests__/resumeCli.test.ts
```

Expected: FAIL because `scan/src/resume.ts` does not exist.

- [ ] **Step 3: Implement resume CLI**

Create `scan/src/resume.ts`:

```ts
import path from 'path';
import { reconcileProgress } from './reconcile';
import { atomicWriteJson, loadOrCreateProgress } from './state';
import { resolveStateDir } from './manifest';

interface Args {
  stateDir?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--state-dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('--state-dir requires a value');
      args.stateDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--state-dir=')) {
      args.stateDir = arg.slice('--state-dir='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function runResumeCli(argv: string[], now = new Date().toISOString()): void {
  const args = parseArgs(argv);
  const stateDir = resolveStateDir(args.stateDir);
  const progress = loadOrCreateProgress(stateDir, now);
  const result = reconcileProgress(stateDir, progress, now);

  if (result.changes.length > 0) {
    atomicWriteJson(path.join(stateDir, 'progress.json'), result.progress);
  }

  const payload = {
    stateDir,
    resume: result.progress.resume,
    changes: result.changes,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\\n`);
  process.stdout.write(`Next action: ${result.progress.resume.nextAction}\\n`);
  process.stdout.write(`Reason: ${result.progress.resume.reason}\\n`);
  if (result.progress.resume.command) {
    process.stdout.write(`Command: ${result.progress.resume.command}\\n`);
  }
}

try {
  runResumeCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
yarn workspace scan test --runInBand __tests__/resumeCli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scan/src/resume.ts scan/__tests__/resumeCli.test.ts
git commit -m "feat(state): add resume cli"
```

## Task 6: Bundle and Distribute resume.js

**Files:**
- Modify: `scan/package.json`
- Modify: `scripts/build-skill.ts`
- Modify: `skill-template/SKILL.md.tpl`

- [ ] **Step 1: Add build script for resume.js**

Modify `scan/package.json` scripts:

```json
"scripts": {
  "build": "yarn build:scan && yarn build:resume",
  "build:scan": "esbuild src/index.ts --bundle --platform=node --target=node16 --outfile=dist/scan.js",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "test": "jest"
}
```

- [ ] **Step 2: Copy resume.js into skill dist**

Modify `scripts/build-skill.ts` after copying `scan.js`:

```ts
  copyFile(
    path.join(rootDir, "scan", "dist", "resume.js"),
    path.join(skillScriptsDir, "resume.js")
  );
```

- [ ] **Step 3: Update SKILL template resume protocol**

In `skill-template/SKILL.md.tpl`, replace the current resume section with:

````md
## Resume 协议

每次激活 skill 后，先运行：

```bash
node $SKILL_DIR/scripts/resume.js --state-dir "${STATE_DIR:-coverage-state}"
```

以该命令输出的 `nextAction`、`reason`、`command` 为准继续流程。不要凭聊天上下文判断下一步。
````

- [ ] **Step 4: Build skill**

Run:

```bash
yarn workspace scan build
yarn build:skill
```

Expected:

- `scan/dist/scan.js` exists.
- `scan/dist/resume.js` exists.
- `dist/skills/react-component-upgrade/scripts/scan.js` exists.
- `dist/skills/react-component-upgrade/scripts/resume.js` exists.

- [ ] **Step 5: Smoke test bundled resume**

Run:

```bash
tmpdir="$(mktemp -d)"
mkdir -p "$tmpdir/coverage-state"
printf '{"runtime":{"targetPackages":["@example/ui"],"baseUrl":"https://example.test"}}\n' > "$tmpdir/coverage-state/manifest.json"
(cd "$tmpdir" && node /Users/liuyunxia/Documents/odc_workspace/scepter-smart-trains-xui-pro-update/component-upgrade-coverage-recorder/dist/skills/react-component-upgrade/scripts/resume.js --state-dir coverage-state)
```

Expected stdout contains:

```text
Next action: run-scan
```

- [ ] **Step 6: Commit**

```bash
git add scan/package.json scripts/build-skill.ts skill-template/SKILL.md.tpl
git commit -m "feat(state): distribute resume script with skill"
```

## Task 7: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run scan workspace tests**

Run:

```bash
yarn workspace scan test --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run full workspace tests**

Run:

```bash
yarn test
```

Expected: all workspace tests pass.

- [ ] **Step 3: Build distributable skill**

Run:

```bash
yarn build:skill
```

Expected: build completes and `dist/skills/react-component-upgrade/scripts/resume.js` exists.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree after all task commits.
