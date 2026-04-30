import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { buildImportGraph, resolveImport, walkReachable } from './buildImportGraph';
import { findJsxCallSites, JsxCallSite } from './findJsxCallSites';
import { greedyCover } from './greedyCover';
import { parseRouter, ParsedRoute } from './parseRouter';
import { walkSourceFiles } from './walkSourceFiles';

export interface RunScanOptions {
  projectRoot: string;
  outDir: string;
  baseUrl?: string;
  targetPackages: string[];
}

export interface RunScanSummary {
  pageCount: number;
  targetCount: number;
  selectedRouteCount: number;
  unmappedTargetCount: number;
}

interface CoverageTarget extends JsxCallSite {
  targetId: string;
  routeCandidates: RouteCandidate[];
  status: 'undetected';
  confirmedEvidenceId: null;
}

interface RouteCandidate {
  routeId: string;
  path: string;
  url: string;
}

interface RouteCoverage {
  route: ParsedRoute;
  routeId: string;
  componentFile: string | null;
  targetIds: string[];
}

export function runScan(options: RunScanOptions): RunScanSummary {
  const projectRoot = path.resolve(options.projectRoot);
  const scannedAt = new Date().toISOString();
  const sourceRoot = path.join(projectRoot, 'src');
  const routerRoot = path.join(projectRoot, 'src/router/routers');
  const sourceFiles = walkSourceFiles(sourceRoot);
  const routeFiles = walkSourceFiles(routerRoot);
  const routes = parseRouter(routeFiles);
  const importGraph = buildImportGraph(sourceFiles, projectRoot);
  const targets = collectTargets(sourceFiles, projectRoot, options.targetPackages);
  const routeCoverage = buildRouteCoverage(routes, importGraph, projectRoot, targets, options.baseUrl);
  const cover = greedyCover(
    routeCoverage.map((route) => ({ routeId: route.routeId, targetIds: route.targetIds })),
    targets.map((target) => target.targetId),
  );

  const routeCoverageById = new Map(routeCoverage.map((route) => [route.routeId, route]));
  const selectedRouteCoverages = cover.selectedRouteIds
    .map((routeId) => routeCoverageById.get(routeId))
    .filter((route): route is RouteCoverage => Boolean(route));

  writeJson(path.join(options.outDir, 'coverage-targets.json'), {
    schemaVersion: 1,
    scannedAt,
    targets,
  });

  writeJson(path.join(options.outDir, 'route-checklist.json'), {
    schemaVersion: 1,
    scannedAt,
    selectedRoutes: selectedRouteCoverages.map((route) => ({
      routeId: route.routeId,
      path: route.route.path,
      url: joinUrl(options.baseUrl, route.route.path),
      targetIds: route.targetIds,
      confirmedCount: 0,
      targetCount: route.targetIds.length,
    })),
    unmappedTargetIds: cover.unmappedTargetIds,
  });

  writeJson(path.join(options.outDir, 'pages.json'), {
    schemaVersion: 1,
    scannedAt,
    config: {
      baseUrl: options.baseUrl,
    },
    summary: {
      pageCount: routes.length,
      targetCount: targets.length,
      mappedTargetCount: new Set(routeCoverage.flatMap((route) => route.targetIds)).size,
    },
    pages: routeCoverage.map((route) => buildPage(route, targets, projectRoot, options.baseUrl)),
  });

  return {
    pageCount: routes.length,
    targetCount: targets.length,
    selectedRouteCount: selectedRouteCoverages.length,
    unmappedTargetCount: cover.unmappedTargetIds.length,
  };
}

function collectTargets(sourceFiles: string[], projectRoot: string, targetPackages: string[]): CoverageTarget[] {
  const targets: CoverageTarget[] = [];

  for (const file of sourceFiles) {
    const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, getScriptKind(file));
    const relativeFile = toPosixRelative(projectRoot, file);

    for (const site of findJsxCallSites(sourceFile, targetPackages, relativeFile)) {
      targets.push({
        ...site,
        targetId: `${relativeFile}#${site.importedName}#L${site.line}#C${site.column}`,
        routeCandidates: [],
        status: 'undetected',
        confirmedEvidenceId: null,
      });
    }
  }

  return targets.sort((a, b) => a.targetId.localeCompare(b.targetId));
}

function buildRouteCoverage(
  routes: ParsedRoute[],
  importGraph: ReturnType<typeof buildImportGraph>,
  projectRoot: string,
  targets: CoverageTarget[],
  baseUrl?: string,
): RouteCoverage[] {
  const targetsByFile = new Map<string, CoverageTarget[]>();
  for (const target of targets) {
    const absoluteFile = path.join(projectRoot, target.file);
    const fileTargets = targetsByFile.get(absoluteFile) ?? [];
    fileTargets.push(target);
    targetsByFile.set(absoluteFile, fileTargets);
  }

  const routeIdCounts = new Map<string, number>();

  return routes.map((route) => {
    const componentFile = resolveImport(route.componentImportPath, route.file, projectRoot);
    const reachable = componentFile ? walkReachable(importGraph, componentFile) : new Set<string>();
    const targetIds: string[] = [];
    const routeId = uniqueRouteId(pageIdFromRoutePath(route.path), routeIdCounts);
    const routeCandidate = { routeId, path: route.path, url: joinUrl(baseUrl, route.path) };

    for (const file of reachable) {
      for (const target of targetsByFile.get(file) ?? []) {
        targetIds.push(target.targetId);
        target.routeCandidates.push(routeCandidate);
      }
    }

    targetIds.sort();
    return {
      route,
      routeId,
      componentFile,
      targetIds,
    };
  });
}

function uniqueRouteId(baseRouteId: string, counts: Map<string, number>): string {
  const current = counts.get(baseRouteId) ?? 0;
  counts.set(baseRouteId, current + 1);
  return current === 0 ? baseRouteId : `${baseRouteId}-${current + 1}`;
}

function buildPage(routeCoverage: RouteCoverage, targets: CoverageTarget[], projectRoot: string, baseUrl?: string) {
  const targetById = new Map(targets.map((target) => [target.targetId, target]));
  const routeTargets = routeCoverage.targetIds
    .map((targetId) => targetById.get(targetId))
    .filter((target): target is CoverageTarget => Boolean(target));
  const components = Array.from(new Set(routeTargets.map((target) => target.importedName))).sort();
  const needsParams = routeCoverage.route.path.includes(':');
  const url = joinUrl(baseUrl, routeCoverage.route.path);

  return {
    id: routeCoverage.routeId,
    path: routeCoverage.route.path,
    urlTemplate: needsParams ? null : url,
    resolvedUrl: needsParams ? null : url,
    file: routeCoverage.componentFile ? toPosixRelative(projectRoot, routeCoverage.componentFile) : null,
    components,
    risk: 'low',
    riskReason: '',
    needsAuth: false,
    needsParams,
    params: extractParams(routeCoverage.route.path),
  };
}

function pageIdFromRoutePath(routePath: string): string {
  const id = routePath.replace(/^\//, '').replace(/\//g, '-').replace(/:/g, '');
  return id || 'root';
}

function extractParams(routePath: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const segment of routePath.split('/')) {
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = '';
    }
  }
  return params;
}

function joinUrl(baseUrl: string | undefined, routePath: string): string {
  if (!baseUrl) {
    return routePath;
  }

  const base = baseUrl.replace(/\/+$/, '');
  const baseParts = base.split('/');
  const routeParts = routePath.split('/');
  let dropFromRoute = 0;

  for (let take = Math.min(baseParts.length, routeParts.length); take > 0; take -= 1) {
    const baseSuffix = baseParts.slice(baseParts.length - take).join('/');
    const routePrefix = routeParts.slice(1, 1 + take).join('/');
    if (baseSuffix && baseSuffix === routePrefix) {
      dropFromRoute = take;
      break;
    }
  }

  if (dropFromRoute > 0) {
    const remaining = `/${routeParts.slice(1 + dropFromRoute).join('/')}`;
    return base + (remaining === '/' ? '' : remaining);
  }

  return `${base}/${routePath.replace(/^\/+/, '')}`;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function toPosixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function getScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
