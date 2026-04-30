---
name: react-component-upgrade
description: Use when running, resuming, or auditing a component-library upgrade that needs JSX-call-site coverage evidence. Triggered by mentions of "组件升级覆盖", "升级回归覆盖", "coverage recorder". Drives a Phase 0 + Phase 2 workflow with file-based state for resume.
---

# React Component Upgrade Coverage

This skill orchestrates a baseline-vs-after coverage workflow for a React
component-library upgrade. The main agent runs the phases below in order and
is the single writer of `<state-dir>/progress.json`.

## Bootstrap

The state dir is `<project-root>/coverage-state/` by default. Only the new
state layout is supported — the legacy `e2e-xui-pro/` directory is not read
or migrated.

`<state-dir>/manifest.json` MUST contain:

```json
{
  "schemaVersion": 1,
  "project": "demo-app",
  "library": "@example/ui",
  "baseline": { "version": "1.0.0", "commit": "abc123", "worktreePath": "/abs/path/to/baseline-worktree" },
  "after": { "version": "1.1.0", "branch": "feature/upgrade-ui" },
  "runtime": {
    "targetPackages": ["@example/ui"],
    "devCommand": "yarn start",
    "devPort": 3033,
    "baseUrl": "https://example.test/app",
    "proxy": "http://127.0.0.1:8899",
    "playwrightProfile": "coverage-state/.playwright-profile"
  }
}
```

`runtime.targetPackages` is read by scan, the babel marker, and the recorder.
`runtime.baseUrl` is the URL the operator opens in the browser; if the dev
server runs on `127.0.0.1` and a proxy maps the business domain, set
`runtime.proxy` to the proxy address.

Install once in the target project:

```bash
yarn add -D @odc/coverage-marker@^{{coverageMarkerVersion}}
pip install playwright pytest
playwright install chromium
```

Wire the babel marker plugin in `craco.config.js`:

```js
const fs = require('fs');
const path = require('path');

function loadCoverageTargetPackages() {
  if (process.env.COVERAGE_MODE !== '1') return null;
  const stateDir = process.env.STATE_DIR || 'coverage-state';
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, stateDir, 'manifest.json'), 'utf8'));
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

## Resume First

Always call resume before any other phase. It creates or repairs
`progress.json`, reconciles missing artifacts, and prints the next action.

```bash
node $SKILL_DIR/scripts/workflow/resume.js --state-dir coverage-state
```

The output line `Next action: <name>` decides which command to run next.

## Phases

The phases are linear: `bootstrap → scan → apiDiff → build →
baselineCoverage → afterRuntime → report`. The main agent updates
`progress.json` after each phase via the corresponding CLI, which writes a
`progress.<phase>.snapshot.json`.

### scan

Pure static scan — does not read manifest at the scan layer. The workflow
phase wraps it.

```bash
node $SKILL_DIR/scripts/workflow/scan.js --state-dir coverage-state --project-root .
```

Outputs `coverage-targets.json`, `route-checklist.json`, `pages.json`. After
this phase, **checkpoint** with the user before kicking off api-diff.

### apiDiff

Reads `<baseline-worktree>/node_modules/<pkg>/{lib,es,dist,types}/*.d.ts` vs
the after project's copies, classifies changes RED/YELLOW/GREEN, and writes
`api-diff/dts-diff.md` + `api-diff/dts-impact.md`.

```bash
node $SKILL_DIR/scripts/workflow/api-diff.js --state-dir coverage-state
```

### build

Swap to the after package version, run the project build, and dispatch the
`build-fix` subagent (see `subagent-prompts.md`) for any failures. The
subagent writes results into `build/attempts/<n>/result.json` but DOES NOT
update progress; the main agent records the outcome.

If a fix touches a shared component, the subagent emits `needs-decision`.
**Checkpoint** with the user before continuing.

### baselineCoverage (no subagent)

Start the dev server in coverage mode, then run the recorder. The user
operates the browser directly while marker hits accumulate.

```bash
COVERAGE_MODE=1 BROWSER=none yarn start
```

Before opening the recorder, manually verify the babel marker is live: in
the business page's DevTools console run `Array.from(window.__coverageMark__ || [])`
and confirm it returns at least one target id corresponding to the current
route. If the array is empty, fix the marker injection before continuing.

```bash
python3 $SKILL_DIR/scripts/recorder/recorder.py --state-dir coverage-state
# resume from a specific route after a crash:
python3 $SKILL_DIR/scripts/recorder/recorder.py --state-dir coverage-state --route course-center
```

The recorder spawns two Chromium windows (business app + panel) and writes
each route's evidence under `runs/baseline-<version>/routes/<routeId>/`.
**Checkpoint** with the user once the recorder reports `phase=done`.

### afterRuntime

Generate the plan, then dispatch the `after-runtime-route` subagent serially
per route.

```bash
node $SKILL_DIR/scripts/workflow/after-runtime-plan.js --state-dir coverage-state
```

For every route in `after-runtime-plan.json`, dispatch one subagent (see
`subagent-prompts.md`). Each subagent writes into
`runs/after/routes/<routeId>/` only. The main agent reviews each
`result.json`, records commits, and updates `progress.json`.

If any subagent emits `needs-decision`, **checkpoint** with the user.

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
- All paths in this skill are relative to `$SKILL_DIR`:
  - `scripts/workflow/{resume,scan,api-diff,after-runtime-plan,report}.js`
  - `scripts/recorder/{recorder,runner,action_timeline,evidence,panel_state}.py`
  - `scripts/panel/index.html`
- See `subagent-prompts.md` for the full subagent contracts.
