import path from 'path';
import { runScan } from './runScan';

interface CliArgs {
  projectRoot: string;
  outDir: string;
  baseUrl?: string;
  targetPackages: string[];
  report: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projectRoot: process.cwd(),
    outDir: '',
    targetPackages: [],
    report: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') {
      args.report = true;
      continue;
    }

    if (arg === '--project-root') {
      args.projectRoot = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--project-root=')) {
      args.projectRoot = arg.slice('--project-root='.length);
      continue;
    }

    if (arg === '--out-dir') {
      args.outDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      args.outDir = arg.slice('--out-dir='.length);
      continue;
    }

    if (arg === '--base-url') {
      args.baseUrl = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (arg === '--target-package') {
      args.targetPackages.push(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--target-package=')) {
      args.targetPackages.push(arg.slice('--target-package='.length));
      continue;
    }

    if (arg === '--target-packages') {
      const csv = readValue(argv, index, arg);
      args.targetPackages.push(...splitCsv(csv));
      index += 1;
      continue;
    }
    if (arg.startsWith('--target-packages=')) {
      args.targetPackages.push(...splitCsv(arg.slice('--target-packages='.length)));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.outDir) {
    throw new Error('--out-dir is required');
  }
  if (args.targetPackages.length === 0) {
    throw new Error('--target-package or --target-packages is required');
  }
  return args;
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const summary = runScan({
    projectRoot: path.resolve(args.projectRoot),
    outDir: path.resolve(args.outDir),
    baseUrl: args.baseUrl,
    targetPackages: args.targetPackages,
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
