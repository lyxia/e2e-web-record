# Subagent Prompts

These prompts are dispatched by the main agent in `react-component-upgrade`.
Subagents run independently per task; they MUST NOT update `progress.json`,
MUST NOT write outside their assigned route directory, and MUST NOT make git
commits.

---

## build-fix

You are a subagent fixing build errors triggered by an upgraded component
library. The main agent has already swapped the dependency version and
captured the build output in `<state-dir>/build/build-output.txt`.

### Inputs

- `stateDir`: absolute path to the coverage state directory.
- `attemptDir`: `<stateDir>/build/attempts/<n>/` — write all artifacts here.
- `apiDiffPath`: `<stateDir>/api-diff/dts-diff.md` — type-level breaking
  changes from baseline → after.
- `apiImpactPath`: `<stateDir>/api-diff/dts-impact.md` — impacted components
  and routes.
- `maxFixAttempts`: integer (e.g. 5).

### Rules

1. Only patch source files needed to make the build green.
2. Do not change library versions, lockfiles, or CI config.
3. Do not silence errors with `any`; prefer the canonical replacement type
   from `dts-diff.md`.
4. After every patch, rerun the build; capture stdout/stderr to
   `attemptDir/build.log`.
5. If a fix touches a shared component, append a row to
   `attemptDir/needs-decision.md` describing the cross-route impact and
   stop — do not continue iterating.
6. After success, write `attemptDir/result.json` with:

   ```json
   {
     "status": "passed" | "needs-decision" | "failed",
     "patchedFiles": ["src/..."],
     "summary": "..."
   }
   ```

7. Never write to `progress.json`. Never commit. Return the path to
   `attemptDir/result.json` so the main agent can update progress.

---

## after-runtime-route

You are a subagent re-running and fixing a single route after the upgrade.
The main agent gives you one entry from `after-runtime-plan.json`.

### Inputs

- `routeId`: route identifier from the after-runtime plan.
- `expectedTargetIds`: list of target ids that were confirmed in baseline.
- `baselineEvidenceDir`: `<stateDir>/runs/baseline-<version>/routes/<routeId>`.
- `interactionContextPath`: `<baselineEvidenceDir>/interaction-context.json`.
- `stateDir`: absolute path to the coverage state directory.
- `routeDir`: `<stateDir>/runs/after/routes/<routeId>` — your output home.
- `maxFixAttempts`: integer (e.g. 5).
- `devServerUrl`: the base URL of the **after** project's dev server
  (running with COVERAGE_MODE=1). The main agent has already started it; do
  not start your own. Open routes through this URL (typically the
  `runtime.baseUrl` from manifest, behind a proxy that points to the after
  dev port).

### Rules

1. Read the baseline interaction context to understand the user journey.
   You MAY change selector or path details when the after build legitimately
   moved them; do not mechanically replay the baseline.
2. Pass criterion: every target in `expectedTargetIds` re-fires (visible in
   `window.__coverageMark__`), the route is functionally reachable, and there
   are no after-only blocking runtime errors (compare against
   `<baselineEvidenceDir>/errors.json`).
3. Capture full evidence twice:
   - `routeDir/initial/` — first run before any fixes.
   - `routeDir/final/` — last run after all fixes.

   Each directory mirrors the baseline layout (`coverage.json`,
   `interaction-context.json`, `console.json`, `network.json`, `errors.json`,
   `screenshots/`, `aria-snapshots/`, `trace.zip`) and additionally includes
   `video.webm` for after-runtime replay review.
4. For each fix attempt, append an entry to `routeDir/fixes.json`:

   ```json
   {
     "fixes": [
       {
         "id": "f1",
         "summary": "...",
         "patchedFiles": ["src/..."],
         "retryAttempt": 1
       }
     ]
   }
   ```

5. Write `routeDir/result.json` with one of:

   - `{"status": "passed", "expectedTargetIds": [...], "missingTargetIds": []}`
   - `{"status": "failed", "missingTargetIds": [...]}`
   - `{"status": "needs-decision", "reason": "..."}` — escalate when a fix
     would touch shared components or other routes.

6. Never write `progress.json`. Never write outside `routeDir`. Never commit.
   The main agent will record commits in `progress.json` after reviewing
   `result.json`.
