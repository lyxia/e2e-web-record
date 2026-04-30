import { resolveStateDir } from './manifest';
import { runScanPhase } from './runScanPhase';

interface CliArgs {
  stateDir?: string;
  projectRoot?: string;
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
    if (arg === '--project-root') {
      args.projectRoot = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--project-root=')) {
      args.projectRoot = arg.slice('--project-root='.length);
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
  const projectRoot = args.projectRoot ?? process.cwd();
  const result = runScanPhase({ stateDir, projectRoot });
  process.stdout.write(`${JSON.stringify({ stateDir: result.stateDir, summary: result.summary }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
