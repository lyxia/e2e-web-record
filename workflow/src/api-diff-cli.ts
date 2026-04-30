import path from 'path';
import { runApiDiff } from './apiDiff';
import { loadManifest, resolveStateDir, validateTargetPackages } from './manifest';
import {
  loadOrCreateProgress,
  markPhaseDone,
  writeProgress,
  writeProgressSnapshot,
} from './state';

interface CliArgs {
  stateDir?: string;
  baselineRoot?: string;
  afterRoot?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--state-dir') {
      args.stateDir = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--state-dir=')) {
      args.stateDir = arg.slice('--state-dir='.length);
      continue;
    }
    if (arg === '--baseline-root') {
      args.baselineRoot = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--baseline-root=')) {
      args.baselineRoot = arg.slice('--baseline-root='.length);
      continue;
    }
    if (arg === '--after-root') {
      args.afterRoot = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--after-root=')) {
      args.afterRoot = arg.slice('--after-root='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir(args.stateDir);
  const manifest = loadManifest(stateDir);
  const targetPackages = validateTargetPackages(manifest.runtime?.targetPackages);

  const baselineRoot = args.baselineRoot ?? manifest.baseline?.worktreePath;
  const afterRoot = args.afterRoot ?? process.cwd();
  if (!baselineRoot) {
    throw new Error('Baseline root is missing. Provide --baseline-root or manifest.baseline.worktreePath.');
  }

  const summary = runApiDiff({
    stateDir,
    baselineRoot: path.resolve(baselineRoot),
    afterRoot: path.resolve(afterRoot),
    targetPackages,
  });

  const progress = loadOrCreateProgress(stateDir, nowIso());
  const next = markPhaseDone(progress, 'apiDiff', 'build', nowIso());
  writeProgress(stateDir, next);
  writeProgressSnapshot(stateDir, 'apiDiff', next);

  process.stdout.write(`${JSON.stringify({ stateDir, summary }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
