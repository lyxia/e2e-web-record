---
name: react-component-upgrade
description: Use when running, resuming, or auditing a component-library upgrade that needs JSX-call-site coverage evidence. Triggered by mentions of "组件升级覆盖", "升级回归覆盖", "coverage recorder". Drives a Phase 0 + Phase 2 workflow with file-based state for resume.
---

# React Component Upgrade Coverage

This skill orchestrates a baseline-vs-after coverage workflow for a React
component-library upgrade. The main agent runs the phases below in order and
is the single writer of `<state-dir>/progress.json`.

## Single Source of Truth

There is **exactly one** coverage-state directory: the **after** project's
`coverage-state/`. The baseline worktree never owns its own coverage-state;
it only reads the after project's manifest at compile time via the
`STATE_DIR` env var. Every CLI in this skill (resume / scan / api-diff /
after-runtime-plan / report) and the recorder run against this same
`<state-dir>`. Do not duplicate manifests across worktrees.

## Bootstrap

The state dir is `<after-project>/coverage-state/` by default.

### manifest.json

`<state-dir>/manifest.json` MUST contain:

```json
{
  "schemaVersion": 1,
  "project": "demo-app",
  "library": "@example/ui",
  "baseline": {
    "version": "1.0.0",
    "commit": "abc123",
    "worktreePath": "/abs/path/to/baseline-worktree"
  },
  "after": { "version": "1.1.0", "branch": "feature/upgrade-ui" },
  "runtime": {
    "targetPackages": ["@example/ui"],
    "devCommand": "yarn start",
    "devPort": 3033,
    "baseUrl": "https://example.test/app",
    "proxy": "http://127.0.0.1:8899",
    "playwrightProfile": "coverage-state/.playwright-profile",
    "pythonPath": "/abs/path/to/python-with-playwright/bin/python3",
    "playwrightPackagePath": "/abs/path/to/site-packages/playwright"
  }
}
```

`runtime.targetPackages` is read by scan, the babel marker, and the recorder.
`runtime.baseUrl` is the URL the operator opens in the browser; if the dev
server runs on `127.0.0.1` and a proxy maps the business domain, set
`runtime.proxy` to the proxy address. `runtime.pythonPath` is the exact Python
interpreter used to start the recorder. `runtime.playwrightPackagePath` is the
Playwright Python package directory imported by that interpreter; it is used as
a preflight guard against accidentally launching the recorder with another
Python on PATH.

### Baseline worktree setup

The baseline worktree is the source tree at the **pre-upgrade** commit, with
its own `node_modules` containing the **baseline** package version. It is
needed so api-diff can read baseline `*.d.ts` files and so baseline-coverage
can run a baseline dev server.

```bash
# from inside the after project
git worktree add /abs/path/to/baseline-worktree <baseline-commit>
( cd /abs/path/to/baseline-worktree && yarn install )
```

After this, `manifest.baseline.worktreePath` MUST point to the absolute path,
and `<baseline-worktree>/node_modules/<package>` MUST exist with the baseline
version.

The baseline worktree intentionally does NOT receive a `coverage-state/`
directory. See "Baseline dev server" below for how it reads the after
project's manifest.

### Install

In the **after** project (one-off):

```bash
yarn add -D @odc/coverage-marker@^{{coverageMarkerVersion}}
pip install playwright pytest
playwright install chromium
```

### craco.config.js

Wire the babel marker plugin so that **both the after project and the
baseline worktree** can load the after project's manifest.json by setting
`STATE_DIR` to an absolute path:

```js
const fs = require('fs');
const path = require('path');

function loadCoverageTargetPackages() {
  if (process.env.COVERAGE_MODE !== '1') return null;
  const envStateDir = process.env.STATE_DIR;
  const stateDir = envStateDir
    ? (path.isAbsolute(envStateDir) ? envStateDir : path.resolve(__dirname, envStateDir))
    : path.join(__dirname, 'coverage-state');
  const manifest = JSON.parse(fs.readFileSync(path.join(stateDir, 'manifest.json'), 'utf8'));
  const pkgs = manifest && manifest.runtime && manifest.runtime.targetPackages;
  if (!Array.isArray(pkgs) || pkgs.length === 0) {
    throw new Error('manifest.runtime.targetPackages must be a non-empty array');
  }
  return pkgs;
}
const __coverageTargets = loadCoverageTargetPackages();

module.exports = {
  babel: {
    plugins: [
      ...(__coverageTargets
        ? [[require('@odc/coverage-marker').default, { targetPackages: __coverageTargets }]]
        : []),
    ],
  },
};
```

The `path.isAbsolute` branch is critical: `path.join(__dirname, '/abs')`
silently produces `<__dirname>/abs`, which would mis-locate the manifest.
With `path.resolve`, an absolute STATE_DIR is honoured as-is, and a relative
STATE_DIR is resolved against `__dirname` (so the same craco.config.js works
in both worktrees). If your existing craco uses `path.join(__dirname,
process.env.STATE_DIR || 'coverage-state', ...)`, update it to the snippet
above before running baseline-coverage from a separate worktree.

The same `craco.config.js` is committed to the after branch and inherited by
the baseline worktree (since it lives at the same path in both checkouts).

## Resume First

Always call resume before any other phase. It creates or repairs
`progress.json`, reconciles missing artifacts, and prints the next action.

```bash
node $SKILL_DIR/scripts/workflow/resume.js --state-dir coverage-state
```

The output line `Next action: <name>` decides which command to run next.

## Phases

Linear order: `bootstrap → scan → apiDiff → build → baselineCoverage →
afterRuntime → report`.

### Who advances `progress.json`?

- **scan, apiDiff, report** are mechanical phases. Their CLIs do the work
  and `markPhaseDone` themselves. The main agent only invokes them.
- **build, baselineCoverage, afterRuntime** are orchestrated phases — they
  involve subagent dispatching, the operator-driven recorder, and fix
  loops. No CLI can decide they are done. The **main agent** advances
  `progress.json` directly with a small JSON edit when the phase
  completes. See "Phase transition cheat sheet" below for the exact
  fields to set.

### Phase transition cheat sheet

For each orchestrated phase, write the same shape into
`<state-dir>/progress.json`:

```jsonc
{
  "currentPhase": "<next-phase>",
  "phases": {
    "<this-phase>": { "status": "done", "completedAt": "<iso>" }
  },
  "resume": {
    "nextAction": "<next-action>",
    "description": "<short>"
  },
  "updatedAt": "<iso>"
}
```

| Just finished | `<this-phase>` | `<next-phase>` | `<next-action>` |
|---------------|----------------|----------------|-----------------|
| build green | `build` | `baselineCoverage` | `run-baseline-recorder` |
| recorder reports `phase=done` | `baselineCoverage` | `afterRuntime` | `run-after-runtime` |
| every after route has `result.json` accepted | `afterRuntime` | `report` | `run-report` |

Practical jq one-liner (build → baselineCoverage):

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
jq --arg now "$NOW" '
  .currentPhase = "baselineCoverage"
  | .phases.build = { status: "done", completedAt: $now }
  | .resume = { nextAction: "run-baseline-recorder", description: "Run the baseline recorder; see SKILL.md baselineCoverage section." }
  | .updatedAt = $now
' coverage-state/progress.json > coverage-state/progress.json.tmp \
  && mv coverage-state/progress.json.tmp coverage-state/progress.json
```

Substitute the row from the table above for baseline → afterRuntime and
afterRuntime → report.

After advancing, run `resume.js` to confirm the next action printed
matches expectations.

### Snapshots are optional

The mechanical CLIs (`scan`, `api-diff`, `report`) write
`progress.<phase>.snapshot.json` for audit. If you want the same audit
trail for `build`, `baselineCoverage`, `afterRuntime`, copy
`progress.json` to `progress.<phase>.snapshot.json` after the transition
edit. Skipping the snapshot does not break resume.

### scan

Pure static scan — does not read manifest at the scan layer. The workflow
phase wraps it. Run it in the **after** project (its source is the source
of truth for both baseline and after, assuming `src/` did not change between
versions).

```bash
node $SKILL_DIR/scripts/workflow/scan.js --state-dir coverage-state --project-root .
```

Outputs `coverage-targets.json`, `route-checklist.json`, `pages.json`. After
this phase, **checkpoint** with the user before kicking off api-diff.

If `src/` did change between baseline and after, document the diff in the
report's `summary.md`; baseline-coverage can only confirm targets that exist
at both commits.

### apiDiff

Reads `<baseline-worktree>/node_modules/<pkg>/{lib,es,dist,types}/*.d.ts` vs
the after project's copies, classifies changes RED/YELLOW/GREEN, writes
`api-diff/dts-diff.md` and `api-diff/dts-impact.md`.

```bash
node $SKILL_DIR/scripts/workflow/api-diff.js --state-dir coverage-state
```

`manifest.baseline.worktreePath` must already be set and that worktree must
have `node_modules/` populated.

### build

Swap to the after package version in the after project, run the project
build, and dispatch the `build-fix` subagent (see `subagent-prompts.md`)
for any failures. The subagent writes results into
`build/attempts/<n>/result.json` but DOES NOT update progress.

When the build is green, the main agent SHOULD also write
`build/build-fixes.md` aggregating each attempt's `result.json`
(`patchedFiles`, `summary`) — `report.js` reads it later. Then advance
`progress.json` per the cheat sheet (`build → baselineCoverage`).

If any attempt is `needs-decision` (shared-component impact),
**checkpoint** with the user before continuing — do not advance the
phase.

### baselineCoverage (no subagent)

Two processes run concurrently — a baseline dev server inside the baseline
worktree, and the recorder inside the after project — sharing the after
project's coverage-state.

#### Step 1: baseline dev server (baseline worktree)

```bash
cd "$(jq -r '.baseline.worktreePath' <after-project>/coverage-state/manifest.json)"

# STATE_DIR is the ABSOLUTE path to the after project's coverage-state.
STATE_DIR="<after-project>/coverage-state" \
  COVERAGE_MODE=1 BROWSER=none yarn start
```

This loads the baseline package version under the babel marker, listening on
`runtime.devPort` (default 3033). The marker reads `targetPackages` from the
after manifest via `STATE_DIR`. No file is written into the baseline
worktree.

If your existing craco.config.js has the older `path.join(__dirname,
stateDir, ...)` pattern (which silently breaks for absolute paths), either
upgrade to the snippet in the bootstrap section or pass STATE_DIR as a path
**relative to the baseline worktree's craco.config.js dir** (e.g.
`STATE_DIR=../<after-project>/coverage-state`).

#### Step 2: marker sanity check

In the business page's DevTools console (the page is served by the baseline
dev server through the proxy), run:

```js
Array.from(window.__coverageMark__ || [])
```

You MUST see at least one id from the after project's
`coverage-targets.json`. Empty array means the babel marker did not load —
fix STATE_DIR / craco wiring before continuing.

#### Step 3: recorder (after project)

In a separate terminal:

```bash
cd <after-project>
RECORDER_PYTHON="$(jq -r '.runtime.pythonPath // empty' coverage-state/manifest.json)"
test -n "$RECORDER_PYTHON"
"$RECORDER_PYTHON" $SKILL_DIR/scripts/recorder/recorder.py \
  --state-dir coverage-state \
  --panel-html $SKILL_DIR/scripts/panel/index.html
# resume from a specific route after a crash:
"$RECORDER_PYTHON" $SKILL_DIR/scripts/recorder/recorder.py \
  --state-dir coverage-state \
  --panel-html $SKILL_DIR/scripts/panel/index.html \
  --route course-center
```

`--panel-html` is required and must point to an existing file. The
recorder no longer guesses; the skill caller is responsible for naming
the panel location.

The recorder reads the after project's manifest, opens two Chromium windows
(business app + panel), and writes evidence under
`<after-project>/coverage-state/runs/baseline-<version>/routes/<routeId>/`.
Each route evidence directory includes `trace.zip` for Playwright trace
review. Baseline does not record video.
**Checkpoint** with the user once `runtime-state.json` reports `phase=done`.

#### Step 4: stop the baseline dev server

After baseline-coverage completes, stop the baseline dev server before
moving to afterRuntime — afterRuntime starts a separate dev server in the
after project on the same port.

#### Step 5: advance progress.json

The main agent advances `progress.json` (`baselineCoverage → afterRuntime`)
per the cheat sheet above. The recorder never touches `progress.json`.

### afterRuntime

Generate the plan, then dispatch the `after-runtime-route` subagent serially
per route. The after dev server runs **in the after project**, with the
default `coverage-state` directory (no STATE_DIR override needed).

```bash
# generate-only; the main agent owns phase advance
node $SKILL_DIR/scripts/workflow/after-runtime-plan.js --state-dir coverage-state
# in another terminal, in the after project:
COVERAGE_MODE=1 BROWSER=none yarn start
# fixed recorder for one route; repeat per route or pass multiple --route-id values
python3 $SKILL_DIR/scripts/recorder/after_runtime_recorder.py \
  --state-dir coverage-state \
  --route-id <routeId>
```

For every route in `after-runtime-plan.json`, dispatch one subagent (see
`subagent-prompts.md`). Each subagent writes into
`runs/after/routes/<routeId>/` only. The main agent reviews each
`result.json`, records commits in `progress.json.items.afterRuntime.routes.<id>`,
and (if any) closes out shared-component questions.
Pass each route entry's `url` through unchanged; subagents must open that
business URL exactly and must not replace it with localhost or the dev port.
The fixed after-runtime recorder owns Playwright context setup, trace/video
capture, coverage collection, and evidence file layout. Subagents must not
create or modify Playwright runner scripts. Route-specific interactions belong
in `runs/after/routes/<routeId>/playbook.json`, consumed by the fixed runner.
After-runtime evidence must include Playwright `trace.zip` and `video.webm`
for each `initial/` and `final/` run.

Before accepting afterRuntime as complete, run the quality gate:

```bash
node $SKILL_DIR/scripts/workflow/after-runtime-quality-gate.js --state-dir coverage-state
```

The gate fails if a planned route is missing `result.json`, if passed results
do not match `expectedTargetIds`, if final coverage does not confirm every
expected target, or if any `initial/` / `final/` evidence is missing a valid
`trace.zip` or readable `video.webm`.

When every route in the plan is `passed` or accepted as `needs-decision`
by the user, the main agent advances `progress.json`
(`afterRuntime → report`) per the cheat sheet.

If any subagent emits `needs-decision`, **checkpoint** with the user — do
not advance the phase yourself.

### report

Final aggregation:

```bash
node $SKILL_DIR/scripts/workflow/report.js --state-dir coverage-state
```

Writes `report/summary.md`, `report/coverage-summary.json`,
`report/runtime-diff.json`, `report/api-impact.json`. **Checkpoint** with
the user after the report is produced.

## Resume Protocol

`resume.js` reconciles three failure modes automatically:

- scan marked done but `coverage-targets.json` etc. missing → revert to scan.
- baseline route in `running` state but `runtime-state.json.heartbeatAt`
  is older than 120s → mark route `stale`.
- after route has `fixes.json` but no commit recorded → mark route `blocked`.

In every other case, resume reads `progress.json.resume.nextAction` and
prints it.

## Authoring Rules

- The main agent is the only writer of `progress.json`.
- Subagents (build-fix, after-runtime-route) MUST NOT write `progress.json`,
  MUST NOT commit, and MUST stay inside their assigned attempt or route
  directory.
- The baseline worktree is read-only state from the skill's perspective: no
  coverage-state, no progress.json, no evidence files. The only mutation
  inside the baseline worktree is the operator's own browsing of the
  baseline dev server.
- All paths in this skill are relative to `$SKILL_DIR`:
  - `scripts/workflow/{resume,scan,api-diff,after-runtime-plan,report}.js`
  - `scripts/recorder/{recorder,runner,action_timeline,evidence,panel_state}.py`
  - `scripts/panel/index.html`
- See `subagent-prompts.md` for the full subagent contracts.
