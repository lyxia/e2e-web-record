import fs from 'fs';
import path from 'path';
import { loadManifest } from './manifest';

export interface AfterRuntimePlanOptions {
  stateDir: string;
}

export interface AfterRuntimePlanRoute {
  routeId: string;
  routePath: string;
  url?: string;
  expectedTargetIds: string[];
  baselineEvidenceDir: string;
  interactionContextPath: string;
}

export interface AfterRuntimePlan {
  schemaVersion: 1;
  generatedAt: string;
  routes: AfterRuntimePlanRoute[];
  excluded: {
    skippedRoutes: { routeId: string; reason?: string }[];
    forcedOnlyTargetIds: string[];
    uncoveredTargetIds: string[];
  };
}

interface BaselineCoverage {
  routeId: string;
  routePath?: string;
  url?: string;
  expectedTargetIds?: string[];
  confirmedTargetIds?: string[];
  remainingTargetIds?: string[];
  forceConfirmReason?: string | null;
  reviewStatus?: string;
  skipped?: boolean;
  skippedReason?: string;
}

interface RouteChecklistEntry {
  routeId: string;
  path: string;
  url: string;
  targetIds: string[];
}

export function buildAfterRuntimePlan(options: AfterRuntimePlanOptions): AfterRuntimePlan {
  const stateDir = path.resolve(options.stateDir);
  const manifest = loadManifest(stateDir);
  const baselineVersion = manifest.baseline?.version ?? 'unknown';

  const targets = readJson<{ targets?: Array<{ targetId: string }> }>(
    path.join(stateDir, 'coverage-targets.json'),
  ).targets ?? [];
  const allTargetIds = new Set(targets.map((t) => t.targetId));

  const routeChecklist = readJson<{ selectedRoutes?: RouteChecklistEntry[] }>(
    path.join(stateDir, 'route-checklist.json'),
  ).selectedRoutes ?? [];

  const baselineDir = path.join(stateDir, 'runs', `baseline-${baselineVersion}`, 'routes');
  const baselineCoverages = new Map<string, BaselineCoverage>();
  if (fs.existsSync(baselineDir)) {
    for (const entry of fs.readdirSync(baselineDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const coveragePath = path.join(baselineDir, entry.name, 'coverage.json');
      if (!fs.existsSync(coveragePath)) continue;
      const coverage = readJson<BaselineCoverage>(coveragePath);
      baselineCoverages.set(entry.name, coverage);
    }
  }

  const routes: AfterRuntimePlanRoute[] = [];
  const skippedRoutes: { routeId: string; reason?: string }[] = [];
  const forcedOnlyTargetIds = new Set<string>();
  const confirmedTargetIds = new Set<string>();
  const skippedTargetIds = new Set<string>();
  const targetsAttachedToRoute = new Set<string>();

  for (const entry of routeChecklist) {
    for (const id of entry.targetIds) targetsAttachedToRoute.add(id);
  }

  for (const checklistEntry of routeChecklist) {
    const coverage = baselineCoverages.get(checklistEntry.routeId);
    if (!coverage) continue;

    if (coverage.skipped) {
      skippedRoutes.push({ routeId: checklistEntry.routeId, reason: coverage.skippedReason });
      for (const id of checklistEntry.targetIds) skippedTargetIds.add(id);
      continue;
    }

    const confirmed = coverage.confirmedTargetIds ?? [];
    if (confirmed.length === 0) {
      if (coverage.forceConfirmReason) {
        for (const id of coverage.expectedTargetIds ?? []) forcedOnlyTargetIds.add(id);
      }
      continue;
    }

    for (const id of confirmed) confirmedTargetIds.add(id);

    if (coverage.forceConfirmReason && coverage.remainingTargetIds) {
      for (const id of coverage.remainingTargetIds) forcedOnlyTargetIds.add(id);
    }

    const baselineEvidenceDir = path.join('runs', `baseline-${baselineVersion}`, 'routes', checklistEntry.routeId);
    routes.push({
      routeId: checklistEntry.routeId,
      routePath: coverage.routePath ?? checklistEntry.path,
      url: coverage.url ?? checklistEntry.url,
      expectedTargetIds: confirmed,
      baselineEvidenceDir,
      interactionContextPath: path.join(baselineEvidenceDir, 'interaction-context.json'),
    });
  }

  const uncoveredTargetIds = Array.from(allTargetIds).filter((id) => {
    if (confirmedTargetIds.has(id)) return false;
    if (forcedOnlyTargetIds.has(id)) return false;
    if (skippedTargetIds.has(id)) return false;
    return !targetsAttachedToRoute.has(id);
  });

  const plan: AfterRuntimePlan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    routes,
    excluded: {
      skippedRoutes,
      forcedOnlyTargetIds: Array.from(forcedOnlyTargetIds).sort(),
      uncoveredTargetIds: uncoveredTargetIds.sort(),
    },
  };

  fs.writeFileSync(path.join(stateDir, 'after-runtime-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
