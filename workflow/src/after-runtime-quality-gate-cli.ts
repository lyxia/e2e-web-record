import { resolveStateDir } from './manifest';
import { validateAfterRuntimeQualityGate } from './afterRuntimeQualityGate';

interface CliArgs {
  stateDir?: string;
  ffprobe?: string;
  minVideoBytes?: number;
  minVideoSeconds?: number;
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
    if (arg === '--ffprobe') {
      args.ffprobe = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--ffprobe=')) {
      args.ffprobe = arg.slice('--ffprobe='.length);
      continue;
    }
    if (arg === '--min-video-bytes') {
      args.minVideoBytes = Number(readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith('--min-video-bytes=')) {
      args.minVideoBytes = Number(arg.slice('--min-video-bytes='.length));
      continue;
    }
    if (arg === '--min-video-seconds') {
      args.minVideoSeconds = Number(readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith('--min-video-seconds=')) {
      args.minVideoSeconds = Number(arg.slice('--min-video-seconds='.length));
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir(args.stateDir);
  const result = validateAfterRuntimeQualityGate({
    stateDir,
    ffprobePath: args.ffprobe,
    minVideoBytes: args.minVideoBytes,
    minVideoSeconds: args.minVideoSeconds,
  });

  process.stdout.write(`${JSON.stringify({ stateDir, ...result }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
