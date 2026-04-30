import childProcess from 'child_process';
import fs from 'fs';
import path from 'path';

export interface AfterRuntimeQualityGateOptions {
  stateDir: string;
  ffprobePath?: string;
  minVideoBytes?: number;
  minVideoSeconds?: number;
}

export interface AfterRuntimeQualityGateResult {
  ok: boolean;
  failures: string[];
  checkedRoutes: number;
}

interface PlanRoute {
  routeId: string;
  expectedTargetIds?: string[];
}

interface AfterRuntimePlanFile {
  routes?: PlanRoute[];
}

interface ResultFile {
  status?: 'passed' | 'failed' | 'needs-decision';
  expectedTargetIds?: string[];
  missingTargetIds?: string[];
  reason?: string;
}

interface CoverageFile {
  confirmedTargetIds?: string[];
}

export function validateAfterRuntimeQualityGate(
  options: AfterRuntimeQualityGateOptions,
): AfterRuntimeQualityGateResult {
  const stateDir = path.resolve(options.stateDir);
  const minVideoBytes = options.minVideoBytes ?? 50 * 1024;
  const minVideoSeconds = options.minVideoSeconds ?? 1;
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const failures: string[] = [];

  const plan = readJson<AfterRuntimePlanFile>(path.join(stateDir, 'after-runtime-plan.json'));
  const routes = plan.routes ?? [];

  for (const route of routes) {
    const routeId = route.routeId;
    const expectedTargetIds = route.expectedTargetIds ?? [];
    const routeDir = path.join(stateDir, 'runs', 'after', 'routes', routeId);
    const resultPath = path.join(routeDir, 'result.json');
    if (!fs.existsSync(resultPath)) {
      failures.push(`${routeId} result.json is missing`);
      continue;
    }

    const result = readJson<ResultFile>(resultPath);
    if (!result.status) failures.push(`${routeId} result.json is missing status`);
    if (!sameStringSet(result.expectedTargetIds ?? [], expectedTargetIds)) {
      failures.push(`${routeId} result.json expectedTargetIds does not match after-runtime-plan.json`);
    }

    for (const phase of ['initial', 'final']) {
      validateEvidencePhase({
        routeId,
        phase,
        phaseDir: path.join(routeDir, phase),
        ffprobePath,
        minVideoBytes,
        minVideoSeconds,
        failures,
      });
    }

    if (result.status === 'passed') {
      if ((result.missingTargetIds ?? []).length > 0) {
        failures.push(`${routeId} result.json cannot be passed with missingTargetIds`);
      }
      const finalCoveragePath = path.join(routeDir, 'final', 'coverage.json');
      if (!fs.existsSync(finalCoveragePath)) {
        failures.push(`${routeId} final/coverage.json is missing`);
      } else {
        const finalCoverage = readJson<CoverageFile>(finalCoveragePath);
        const confirmed = new Set(finalCoverage.confirmedTargetIds ?? []);
        for (const id of expectedTargetIds) {
          if (!confirmed.has(id)) failures.push(`${routeId} final/coverage.json is missing confirmed target ${id}`);
        }
      }
    }

    if (result.status === 'needs-decision' && !result.reason) {
      failures.push(`${routeId} needs-decision result must include reason`);
    }
  }

  return { ok: failures.length === 0, failures, checkedRoutes: routes.length };
}

function validateEvidencePhase(args: {
  routeId: string;
  phase: string;
  phaseDir: string;
  ffprobePath: string;
  minVideoBytes: number;
  minVideoSeconds: number;
  failures: string[];
}): void {
  const tracePath = path.join(args.phaseDir, 'trace.zip');
  if (!fs.existsSync(tracePath)) {
    args.failures.push(`${args.routeId} ${args.phase}/trace.zip is missing`);
  } else if (!looksLikePlaywrightTraceZip(tracePath)) {
    args.failures.push(`${args.routeId} ${args.phase}/trace.zip is not a Playwright trace archive`);
  }

  const videoPath = path.join(args.phaseDir, 'video.webm');
  if (!fs.existsSync(videoPath)) {
    args.failures.push(`${args.routeId} ${args.phase}/video.webm is missing`);
    return;
  }
  const videoSize = fs.statSync(videoPath).size;
  if (videoSize < args.minVideoBytes) {
    args.failures.push(`${args.routeId} ${args.phase}/video.webm is too small (${videoSize} bytes)`);
  }
  const duration = probeVideoDurationSeconds(args.ffprobePath, videoPath);
  if (duration === null) {
    args.failures.push(`${args.routeId} ${args.phase}/video.webm duration could not be read with ffprobe`);
  } else if (duration < args.minVideoSeconds) {
    args.failures.push(`${args.routeId} ${args.phase}/video.webm is too short (${duration}s)`);
  }
}

function looksLikePlaywrightTraceZip(file: string): boolean {
  const data = fs.readFileSync(file);
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data.includes(Buffer.from('trace.trace'));
}

function probeVideoDurationSeconds(ffprobePath: string, videoPath: string): number | null {
  try {
    const stdout = childProcess.execFileSync(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', videoPath],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const duration = Number(parsed.format?.duration);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  for (const item of b) {
    if (!left.has(item)) return false;
  }
  return true;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
