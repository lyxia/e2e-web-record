import { resolveStateDir } from './manifest';
import { buildAfterRuntimePlan } from './afterRuntimePlan';

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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir(args.stateDir);
  const plan = buildAfterRuntimePlan({ stateDir });

  process.stdout.write(
    `${JSON.stringify(
      {
        stateDir,
        routeCount: plan.routes.length,
        skippedRoutes: plan.excluded.skippedRoutes.length,
        forcedOnlyTargetIds: plan.excluded.forcedOnlyTargetIds.length,
        uncoveredTargetIds: plan.excluded.uncoveredTargetIds.length,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
