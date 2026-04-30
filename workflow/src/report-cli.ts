import { resolveStateDir } from './manifest';
import { generateReport } from './report';
import {
  loadOrCreateProgress,
  markPhaseDone,
  writeProgress,
  writeProgressSnapshot,
} from './state';

interface CliArgs {
  stateDir?: string;
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
  const summary = generateReport({ stateDir });

  const progress = loadOrCreateProgress(stateDir, nowIso());
  const next = markPhaseDone(progress, 'report', 'done', nowIso());
  writeProgress(stateDir, next);
  writeProgressSnapshot(stateDir, 'report', next);

  process.stdout.write(`${JSON.stringify({ stateDir, summary }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
