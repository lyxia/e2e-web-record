import path from 'path';
import { resolveStateDir } from './manifest';
import {
  UpgradeProgress,
  loadOrCreateProgress,
  writeProgress,
} from './state';
import { reconcileProgress } from './reconcile';

interface CliArgs {
  stateDir?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--state-dir') {
      const value = argv[i + 1];
      if (!value) throw new Error('--state-dir requires a value');
      args.stateDir = value;
      i += 1;
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

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(progress: UpgradeProgress): string {
  const phases = Object.entries(progress.phases)
    .map(([name, value]) => `${name}=${value.status}`)
    .join(', ');
  const lines = [
    `Current phase: ${progress.currentPhase}`,
    `Next action: ${progress.resume.nextAction}`,
    `Phases: ${phases}`,
  ];
  if (progress.resume.description) lines.push(`Hint: ${progress.resume.description}`);
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir(args.stateDir);
  const initial = loadOrCreateProgress(stateDir, nowIso());
  const result = reconcileProgress(stateDir, initial, nowIso());
  if (result.changed) {
    writeProgress(stateDir, result.progress);
  }

  const payload = {
    stateDir,
    progressFile: path.join(stateDir, 'progress.json'),
    currentPhase: result.progress.currentPhase,
    nextAction: result.progress.resume.nextAction,
    notes: result.notes,
    progress: result.progress,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${summarize(result.progress)}\n`);
    if (result.notes.length > 0) {
      process.stdout.write(`Reconcile notes:\n${result.notes.map((n) => ` - ${n}`).join('\n')}\n`);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
