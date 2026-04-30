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
  routes?: Array<{ routeId: string; routePath?: string; url?: string; expectedTargetIds?: string[] }>;
  excluded?: {
    skippedRoutes?: Array<{ routeId: string; reason?: string }>;
    forcedOnlyTargetIds?: string[];
    uncoveredTargetIds?: string[];
  };
}

interface AfterClaim {
  routeId: string;
  status?: 'passed' | 'failed' | 'needs-decision';
  expectedTargetIds?: string[];
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

interface RouteChecklistFile {
  selectedRoutes?: Array<{ routeId: string; url?: string }>;
}

export function generateReport(options: GenerateReportOptions): ReportSummary {
  const stateDir = path.resolve(options.stateDir);
  const manifest = loadManifest(stateDir);
  const baselineVersion = manifest.baseline?.version ?? 'unknown';

  const targets = readJson<{ targets?: Array<{ targetId: string }> }>(
    path.join(stateDir, 'coverage-targets.json'),
  ).targets ?? [];

  const plan: AfterRuntimePlanFile = readJsonOrEmpty(path.join(stateDir, 'after-runtime-plan.json'), {});
  const routeUrls = collectRouteUrls(stateDir, plan);
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

  fs.writeFileSync(path.join(reportDir, 'summary.md'), renderSummary(manifest, summary, skippedRoutes, afterClaims, routeUrls));
  fs.writeFileSync(
    path.join(reportDir, 'index.html'),
    renderHtmlReport({
      manifest,
      summary,
      plan,
      skippedRoutes,
      afterClaims,
      baselineVersion,
      routeUrls,
    }),
  );

  return summary;
}

function collectRouteUrls(stateDir: string, plan: AfterRuntimePlanFile): Map<string, string> {
  const urls = new Map<string, string>();
  for (const route of plan.routes ?? []) {
    if (route.url) urls.set(route.routeId, route.url);
  }
  const checklist = readJsonOrEmpty<RouteChecklistFile>(path.join(stateDir, 'route-checklist.json'), {});
  for (const route of checklist.selectedRoutes ?? []) {
    if (route.url && !urls.has(route.routeId)) urls.set(route.routeId, route.url);
  }
  return urls;
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
      const claim = readJson<AfterClaim>(finalClaim);
      claims.push({ ...claim, routeId: claim.routeId ?? entry.name });
      continue;
    }
    const result = path.join(dir, entry.name, 'result.json');
    if (fs.existsSync(result)) {
      const claim = readJson<AfterClaim>(result);
      claims.push({ ...claim, routeId: claim.routeId ?? entry.name });
    }
  }
  return claims;
}

function renderSummary(
  manifest: ReturnType<typeof loadManifest>,
  summary: ReportSummary,
  skippedRoutes: Array<{ routeId: string; reason?: string }>,
  afterClaims: AfterClaim[],
  routeUrls: Map<string, string>,
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
    const url = routeUrls.get(route.routeId);
    lines.push(`- ${route.routeId}${url ? ` (${url})` : ''}: ${route.reason ?? 'no reason given'}`);
  }
  lines.push('');
  lines.push(`## Linked artifacts`);
  lines.push(`- api-diff: api-diff/dts-diff.md, api-diff/dts-impact.md`);
  lines.push(`- build fixes: build/build-fixes.md`);
  lines.push('');
  return lines.join('\n');
}

function renderHtmlReport(args: {
  manifest: ReturnType<typeof loadManifest>;
  summary: ReportSummary;
  plan: AfterRuntimePlanFile;
  skippedRoutes: Array<{ routeId: string; reason?: string }>;
  afterClaims: AfterClaim[];
  baselineVersion: string;
  routeUrls: Map<string, string>;
}): string {
  const claimByRoute = new Map(args.afterClaims.map((claim) => [claim.routeId, claim]));
  const plannedRoutes = args.plan.routes ?? [];
  const verdict = args.summary.afterFailed > 0 || args.summary.afterNeedsDecision > 0 ? 'NEEDS REVIEW' : 'PASS';
  const routeCards = plannedRoutes.map((route) => renderRouteCard(route, claimByRoute.get(route.routeId), args.baselineVersion)).join('\n');
  const skippedRows = args.skippedRoutes
    .map((route) => `<tr><td>${escapeHtml(route.routeId)}</td><td>${renderUrl(args.routeUrls.get(route.routeId))}</td><td>${escapeHtml(route.reason ?? '')}</td></tr>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Upgrade Evidence Review</title>
  <style>
    :root { color-scheme: light; --bg: #f6f7f9; --panel: #fff; --text: #20242a; --muted: #667085; --line: #d9dee7; --ok: #0f7b45; --warn: #a15c00; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 24px 28px 18px; background: var(--panel); border-bottom: 1px solid var(--line); }
    h1 { margin: 0 0 10px; font-size: 26px; }
    h2 { margin: 28px 0 12px; font-size: 18px; }
    h3 { margin: 0 0 8px; font-size: 15px; }
    .meta { color: var(--muted); display: flex; gap: 18px; flex-wrap: wrap; }
    main { padding: 22px 28px 40px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .stat, .route { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .stat b { display: block; font-size: 22px; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 600; background: #e8f5ee; color: var(--ok); }
    .badge.review { background: #fff4e5; color: var(--warn); }
    .route { margin-bottom: 16px; }
    .route-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
    .url { color: var(--muted); word-break: break-all; font-size: 12px; }
    .compare { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .pane { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #fbfcfe; }
    .pane h3 { padding: 10px 12px; border-bottom: 1px solid var(--line); background: #f0f3f8; }
    .pane-body { padding: 12px; }
    img, video { width: 100%; max-height: 320px; object-fit: contain; background: #eef1f5; border: 1px solid var(--line); border-radius: 6px; }
    .links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    a { color: #175cd3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-size: 12px; word-break: break-all; }
    table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #f0f3f8; }
    @media (max-width: 980px) { .compare { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Upgrade Evidence Review <span class="badge ${verdict === 'PASS' ? '' : 'review'}">${verdict}</span></h1>
    <div class="meta">
      <span>Project: ${escapeHtml(args.manifest.project ?? '(unset)')}</span>
      <span>Library: ${escapeHtml(args.manifest.library ?? '(unset)')}</span>
      <span>Baseline: ${escapeHtml(args.manifest.baseline?.version ?? '(unset)')}</span>
      <span>After: ${escapeHtml(args.manifest.after?.version ?? '(unset)')}</span>
    </div>
  </header>
  <main>
    <section class="stats">
      <div class="stat">Confirmed targets <b>${args.summary.confirmedTargetCount} / ${args.summary.totalTargetCount}</b></div>
      <div class="stat">After routes passed <b>${args.summary.afterPassed}</b></div>
      <div class="stat">After failures <b>${args.summary.afterFailed}</b></div>
      <div class="stat">Needs decision <b>${args.summary.afterNeedsDecision}</b></div>
      <div class="stat">Skipped routes <b>${args.summary.skippedRoutes}</b></div>
      <div class="stat">Forced / uncovered <b>${args.summary.forcedOnlyTargets} / ${args.summary.uncoveredTargets}</b></div>
    </section>

    <h2>Route Evidence</h2>
    ${routeCards || '<p>No after-runtime routes planned.</p>'}

    <h2>Skipped Routes</h2>
    <table>
      <thead><tr><th>Route</th><th>URL</th><th>Reason</th></tr></thead>
      <tbody>${skippedRows || '<tr><td colspan="3">(none)</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>
`;
}

function renderUrl(url: string | undefined): string {
  if (!url) return '';
  return `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
}

function renderRouteCard(
  route: { routeId: string; routePath?: string; url?: string; expectedTargetIds?: string[] },
  claim: AfterClaim | undefined,
  baselineVersion: string,
): string {
  const routeId = route.routeId;
  const expected = route.expectedTargetIds ?? claim?.expectedTargetIds ?? [];
  const missing = claim?.missingTargetIds ?? [];
  const baselineDir = `runs/baseline-${baselineVersion}/routes/${routeId}`;
  const afterDir = `runs/after/routes/${routeId}`;
  const status = claim?.status ?? 'missing-result';
  return `<article class="route">
  <div class="route-head">
    <div>
      <h2>${escapeHtml(routeId)} <span class="badge ${status === 'passed' ? '' : 'review'}">${escapeHtml(status)}</span></h2>
      <div class="url">${escapeHtml(route.url ?? route.routePath ?? '')}</div>
    </div>
    <div>${expected.length} targets${missing.length ? `, ${missing.length} missing` : ''}</div>
  </div>
  <div class="compare">
    ${renderPane('Baseline', `${baselineDir}/screenshots/route-confirm.png`, undefined, `${baselineDir}/trace.zip`, baselineDir)}
    ${renderPane('After Initial', `${afterDir}/initial/screenshots/final.png`, `${afterDir}/initial/video.webm`, `${afterDir}/initial/trace.zip`, `${afterDir}/initial`)}
    ${renderPane('After Final', `${afterDir}/final/screenshots/final.png`, `${afterDir}/final/video.webm`, `${afterDir}/final/trace.zip`, `${afterDir}/final`)}
  </div>
  <details>
    <summary>Expected targets</summary>
    <ul>${expected.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join('')}</ul>
  </details>
  ${missing.length ? `<details open><summary>Missing targets</summary><ul>${missing.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join('')}</ul></details>` : ''}
</article>`;
}

function renderPane(title: string, imagePath: string, videoPath: string | undefined, tracePath: string, evidenceDir: string): string {
  return `<section class="pane">
    <h3>${escapeHtml(title)}</h3>
    <div class="pane-body">
      <a href="../${escapeAttr(imagePath)}"><img src="../${escapeAttr(imagePath)}" alt="${escapeAttr(title)} screenshot" /></a>
      ${videoPath ? `<video controls src="../${escapeAttr(videoPath)}"></video>` : ''}
      <div class="links">
        <a href="../${escapeAttr(tracePath)}">trace.zip</a>
        <a href="../${escapeAttr(evidenceDir)}/coverage.json">coverage.json</a>
        <a href="../${escapeAttr(evidenceDir)}/errors.json">errors.json</a>
      </div>
    </div>
  </section>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
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
