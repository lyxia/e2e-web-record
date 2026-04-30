import { loadManifest, resolveStateDir, validateTargetPackages } from './manifest';
import { runScan } from './runScan';

interface CliArgs {
  stateDir?: string;
  report: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { report: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') {
      args.report = true;
      continue;
    }

    if (arg === '--state-dir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--state-dir requires a value');
      }
      args.stateDir = value;
      index += 1;
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir(args.stateDir);
  const manifest = loadManifest(stateDir);
  const targetPackages = validateTargetPackages(manifest.runtime?.targetPackages);
  const summary = runScan({
    projectRoot: process.cwd(),
    outDir: stateDir,
    baseUrl: manifest.baseUrl,
    targetPackages,
  });

  if (args.report) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
