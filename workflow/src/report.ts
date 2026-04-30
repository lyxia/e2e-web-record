import fs from 'fs';
import path from 'path';
import { loadManifest } from './manifest';

export interface GenerateReportOptions {
  stateDir: string;
}

export interface ReportSummary {
  totalTargetCount: number;
  confirmedTargetCount: number;
  skippedRoutes: number;
  uncoveredTargets: number;
  forcedOnlyTargets: number;
  afterPassed: number;
  afterFailed: number;
  afterNeedsDecision: number;
}

interface AfterRuntimePlanFile {
  routes?: Array<{ routeId: string }>;
  excluded?: {
    skippedRoutes?: Array<{ routeId: string; reason?: string }>;
    forcedOnlyTargetIds?: string[];
    uncoveredTargetIds?: string[];
  };
}

interface AfterClaim {
  routeId: string;
  status?: 'passed' | 'failed' | 'needs-decision';
  missingTargetIds?: string[];
}

interface BaselineCoverage {
  routeId: string;
  confirmedTargetIds?: string[];
  remainingTargetIds?: string[];
  reviewStatus?: string;
  skipped?: boolean;
  forceConfirmReason?: string | null;
  skippedReason?: string;
}

export function generateReport(options: GenerateReportOptions): ReportSummary {
  const stateDir = path.resolve(options.stateDir);
  const manifest = loadManifest(stateDir);
  const baselineVersion = manifest.baseline?.version ?? 'unknown';

  const targets = readJson<{ targets?: Array<{ targetId: string }> }>(
    path.join(stateDir, 'coverage-targets.json'),
  ).targets ?? [];

  const plan: AfterRuntimePlanFile = readJsonOrEmpty(path.join(stateDir, 'after-runtime-plan.json'), {});
  const baselineCoverages = collectBaselineCoverages(stateDir, baselineVersion);
  const afterClaims = collectAfterClaims(stateDir);

  const confirmedTargetIds = new Set<string>();
  for (const cov of baselineCoverages.values()) {
    for (const id of cov.confirmedTargetIds ?? []) confirmedTargetIds.add(id);
  }

  const skippedRoutes = plan.excluded?.skippedRoutes ?? [];
  const forcedOnlyTargets = plan.excluded?.forcedOnlyTargetIds ?? [];
  const uncoveredTargets = plan.excluded?.uncoveredTargetIds ?? [];

  let afterPassed = 0;
  let afterFailed = 0;
  let afterNeedsDecision = 0;
  for (const claim of afterClaims) {
    if (claim.status === 'passed') afterPassed += 1;
    else if (claim.status === 'failed') afterFailed += 1;
    else if (claim.status === 'needs-decision') afterNeedsDecision += 1;
  }

  const reportDir = path.join(stateDir, 'report');
  fs.mkdirSync(reportDir, { recursive: true });

  const summary: ReportSummary = {
    totalTargetCount: targets.length,
    confirmedTargetCount: confirmedTargetIds.size,
    skippedRoutes: skippedRoutes.length,
    uncoveredTargets: uncoveredTargets.length,
    forcedOnlyTargets: forcedOnlyTargets.length,
    afterPassed,
    afterFailed,
    afterNeedsDecision,
  };

  fs.writeFileSync(
    path.join(reportDir, 'coverage-summary.json'),
    `${JSON.stringify(
      {
        totalTargetCount: summary.totalTargetCount,
        confirmedTargetCount: summary.confirmedTargetCount,
        skippedRoutes,
        uncoveredTargetIds: uncoveredTargets,
        forcedOnlyTargetIds: forcedOnlyTargets,
      },
      null,
      2,
    )}\n`,
  );

  fs.writeFileSync(
    path.join(reportDir, 'runtime-diff.json'),
    `${JSON.stringify(
      {
        afterPassed,
        afterFailed,
        afterNeedsDecision,
        claims: afterClaims,
      },
      null,
      2,
    )}\n`,
  );

  const apiDiffRel = path.join('api-diff', 'dts-diff.md');
  const apiImpactRel = path.join('api-diff', 'dts-impact.md');
  const buildFixesRel = path.join('build', 'build-fixes.md');
  fs.writeFileSync(
    path.join(reportDir, 'api-impact.json'),
    `${JSON.stringify(
      {
        dtsDiffPath: apiDiffRel,
        dtsImpactPath: apiImpactRel,
        buildFixesPath: buildFixesRel,
      },
      null,
      2,
    )}\n`,
  );

  fs.writeFileSync(path.join(reportDir, 'summary.md'), renderSummary(manifest, summary, skippedRoutes, afterClaims));

  return summary;
}

function collectBaselineCoverages(stateDir: string, baselineVersion: string): Map<string, BaselineCoverage> {
  const out = new Map<string, BaselineCoverage>();
  const dir = path.join(stateDir, 'runs', `baseline-${baselineVersion}`, 'routes');
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'coverage.json');
    if (!fs.existsSync(file)) continue;
    out.set(entry.name, readJson<BaselineCoverage>(file));
  }
  return out;
}

function collectAfterClaims(stateDir: string): AfterClaim[] {
  const dir = path.join(stateDir, 'runs', 'after', 'routes');
  if (!fs.existsSync(dir)) return [];
  const claims: AfterClaim[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const finalClaim = path.join(dir, entry.name, 'final', 'claims.json');
    if (fs.existsSync(finalClaim)) {
      claims.push(readJson<AfterClaim>(finalClaim));
      continue;
    }
    const result = path.join(dir, entry.name, 'result.json');
    if (fs.existsSync(result)) claims.push(readJson<AfterClaim>(result));
  }
  return claims;
}

function renderSummary(
  manifest: ReturnType<typeof loadManifest>,
  summary: ReportSummary,
  skippedRoutes: Array<{ routeId: string; reason?: string }>,
  afterClaims: AfterClaim[],
): string {
  const lines: string[] = [];
  lines.push(`# Component Upgrade Report`);
  lines.push('');
  lines.push(`Project: ${manifest.project ?? '(unset)'}`);
  lines.push(`Library: ${manifest.library ?? '(unset)'}`);
  lines.push(`Baseline: ${manifest.baseline?.version ?? '(unset)'}`);
  lines.push(`After: ${manifest.after?.version ?? '(unset)'}`);
  lines.push('');
  lines.push(`## Coverage`);
  lines.push(`- confirmed targets: ${summary.confirmedTargetCount} / ${summary.totalTargetCount}`);
  lines.push(`- forced-only targets: ${summary.forcedOnlyTargets}`);
  lines.push(`- uncovered targets: ${summary.uncoveredTargets}`);
  lines.push('');
  lines.push(`## After-runtime`);
  lines.push(`- passed: ${summary.afterPassed}`);
  lines.push(`- failed: ${summary.afterFailed}`);
  lines.push(`- needs-decision: ${summary.afterNeedsDecision}`);
  for (const claim of afterClaims) {
    lines.push(`  - ${claim.routeId}: ${claim.status ?? 'unknown'}`);
  }
  lines.push('');
  lines.push(`## Skipped routes`);
  if (skippedRoutes.length === 0) lines.push('- (none)');
  for (const route of skippedRoutes) {
    lines.push(`- ${route.routeId}: ${route.reason ?? 'no reason given'}`);
  }
  lines.push('');
  lines.push(`## Linked artifacts`);
  lines.push(`- api-diff: api-diff/dts-diff.md, api-diff/dts-impact.md`);
  lines.push(`- build fixes: build/build-fixes.md`);
  lines.push('');
  return lines.join('\n');
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function readJsonOrEmpty<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return readJson<T>(file);
  } catch {
    return fallback;
  }
}
