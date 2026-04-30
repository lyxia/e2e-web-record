# react-component-upgrade 完整 Skill 实现计划

> **给执行 agent：** 实施本计划前必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 基于已确认设计 `docs/superpowers/specs/2026-04-30-react-component-upgrade-skill-design.md`，把当前 MVP 采集器扩展为完整可分发的 `react-component-upgrade` skill。

**架构：** 在现有 monorepo 内继续演进：`scan/` 承载 Node/TypeScript 确定性脚本，`recorder/` 承载 Playwright Python 长跑采集进程，`panel/` 承载人工操作面板，`packages/coverage-marker/` 承载 Babel marker 注入。main agent 只编排和更新本地状态；Phase build 与 after-runtime 的 LLM 判断工作通过串行 subagent 完成。

**技术栈：** TypeScript 4.6、Node 16、Jest/ts-jest、esbuild、Python 3.10+、Playwright、pytest、React 17、Vite、yarn workspaces。

---

## 0. 执行原则

- 只支持新状态目录 `coverage-state/`；不读取、不迁移、不兼容旧 `e2e-xui-pro/`。
- 每个任务先写测试，再实现，再运行验证，再提交。
- 所有状态写入必须本地化、可恢复、可审计。
- Phase baseline-coverage 不派 subagent，由 main agent 启动 dev server 和 `recorder.py`，用户在真实浏览器窗口操作。
- Phase build 和 Phase after-runtime 的修复判断由 subagent 串行执行，subagent 不提交、不写 `progress.json`。
- 目标组件包、版本、baseUrl、proxy、dev server、worktree 等均从 `coverage-state/manifest.json` 读取，不硬编码。

## 1. 文件结构总览

计划完成后，新增或修改的主要文件如下：

```text
scan/
├── src/
│   ├── manifest.ts           # manifest schema 与解析
│   ├── state.ts              # progress schema、原子写、snapshot、状态更新
│   ├── reconcile.ts          # artifact 与 progress 对账
│   ├── resume.ts             # resume CLI
│   ├── apiDiff.ts            # d.ts diff 与 impact 分析
│   ├── api-diff-cli.ts       # api-diff CLI
│   ├── afterRuntimePlan.ts   # 根据 baseline evidence 生成 after-runtime-plan.json
│   ├── after-runtime-plan-cli.ts
│   ├── report.ts             # 汇总报告
│   ├── report-cli.ts
│   ├── runScan.ts            # 接入新 schema/progress
│   └── index.ts              # scan CLI
├── __tests__/
│   ├── state.test.ts
│   ├── reconcile.test.ts
│   ├── resumeCli.test.ts
│   ├── apiDiff.test.ts
│   ├── afterRuntimePlan.test.ts
│   ├── report.test.ts
│   └── runScan.test.ts
└── package.json

recorder/
├── src/
│   ├── runner.py             # Phase baseline-coverage 主循环增强
│   ├── action_timeline.py    # action timeline 与日志归因
│   ├── evidence.py           # coverage/context/log artifact 写入
│   └── panel_state.py
└── tests/
    ├── test_action_timeline.py
    ├── test_evidence.py
    └── test_recorder_dry_run.py

panel/src/
├── App.tsx                   # 保持主交互不变，textarea 语义升级为 routeNote
└── types.ts

skill-template/
├── SKILL.md.tpl              # 完整 skill 编排入口
└── subagent-prompts.md.tpl   # build fix / after runtime prompts

scripts/build-skill.ts        # 打包全部 scripts/templates
```

## 2. Task 1：状态本地化与 Resume 基座

**Files:**
- Modify: `scan/src/manifest.ts`
- Create: `scan/src/state.ts`
- Create: `scan/src/reconcile.ts`
- Create: `scan/src/resume.ts`
- Modify: `scan/src/index.ts`
- Create: `scan/__tests__/state.test.ts`
- Create: `scan/__tests__/reconcile.test.ts`
- Create: `scan/__tests__/resumeCli.test.ts`
- Modify: `scan/__tests__/manifest.test.ts`
- Modify: `scan/package.json`

- [ ] **Step 1：扩展 manifest 测试**

在 `scan/__tests__/manifest.test.ts` 增加：

```ts
it('loads complete upgrade manifest fields without dropping data', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  const manifest = {
    schemaVersion: 1,
    project: 'demo-app',
    library: '@example/ui',
    baseline: { version: '1.0.0', commit: 'abc123', worktreePath: '/tmp/demo-baseline' },
    after: { version: '1.1.0', branch: 'feature/upgrade-ui' },
    runtime: {
      targetPackages: ['@example/ui'],
      devCommand: 'yarn start',
      devPort: 3033,
      baseUrl: 'https://example.test/app',
      proxy: 'http://127.0.0.1:8899',
      playwrightProfile: 'coverage-state/.playwright-profile',
    },
    startedAt: '2026-04-30T00:00:00Z',
    operator: 'tester',
  };
  fs.writeFileSync(path.join(stateDir, 'manifest.json'), JSON.stringify(manifest));

  expect(loadManifest(stateDir)).toEqual(manifest);
});

it('resolves baseUrl from runtime before legacy top-level baseUrl', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-'));
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    JSON.stringify({
      baseUrl: 'https://legacy.example.test',
      runtime: { baseUrl: 'https://runtime.example.test', targetPackages: ['@example/ui'] },
    }),
  );

  expect(resolveManifestBaseUrl(loadManifest(stateDir))).toBe('https://runtime.example.test');
});
```

运行：

```bash
yarn workspace scan test --runInBand __tests__/manifest.test.ts
```

预期：失败，提示 `resolveManifestBaseUrl` 未定义。

- [ ] **Step 2：实现 manifest schema**

将 `scan/src/manifest.ts` 扩展为：

```ts
import fs from 'fs';
import path from 'path';

export interface CoverageManifest {
  schemaVersion?: number;
  project?: string;
  library?: string;
  baseUrl?: string;
  baseline?: { version?: string; commit?: string; worktreePath?: string };
  after?: { version?: string; branch?: string };
  runtime?: {
    targetPackages?: unknown;
    devCommand?: string;
    devPort?: number;
    baseUrl?: string;
    proxy?: string | null;
    playwrightProfile?: string;
  };
  startedAt?: string;
  operator?: string;
}

export function resolveStateDir(argStateDir?: string): string {
  return path.resolve(argStateDir || process.env.STATE_DIR || 'coverage-state');
}

export function loadManifest(stateDir: string): CoverageManifest {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'manifest.json'), 'utf8')) as CoverageManifest;
}

export function resolveManifestBaseUrl(manifest: CoverageManifest): string | undefined {
  return manifest.runtime?.baseUrl || manifest.baseUrl;
}

export function validateTargetPackages(targetPackages: unknown): string[] {
  if (
    !Array.isArray(targetPackages) ||
    targetPackages.length === 0 ||
    targetPackages.some((packageName) => typeof packageName !== 'string' || packageName.length === 0)
  ) {
    throw new Error('manifest runtime.targetPackages must be a non-empty array of strings');
  }
  return targetPackages;
}
```

在 `scan/src/index.ts` 改用 `resolveManifestBaseUrl(manifest)` 传给 `runScan`。

运行：

```bash
yarn workspace scan test --runInBand __tests__/manifest.test.ts
```

预期：通过。

- [ ] **Step 3：写 state/reconcile/resume 测试**

新增 `scan/__tests__/state.test.ts`，覆盖：

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  atomicWriteJson,
  createInitialProgress,
  loadOrCreateProgress,
  markPhaseDone,
  readJsonFile,
  updateBaselineRoute,
  writeProgressSnapshot,
} from '../src/state';

describe('state utilities', () => {
  it('writes json atomically and preserves previous content as .bak', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const file = path.join(dir, 'progress.json');
    atomicWriteJson(file, { version: 1 });
    atomicWriteJson(file, { version: 2 });
    expect(readJsonFile(file)).toEqual({ version: 2 });
    expect(readJsonFile(`${file}.bak`)).toEqual({ version: 1 });
  });

  it('creates initial progress with local resume instruction', () => {
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    expect(progress.currentPhase).toBe('scan');
    expect(progress.phases.bootstrap.status).toBe('done');
    expect(progress.resume.nextAction).toBe('run-scan');
  });

  it('loads or creates progress.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const progress = loadOrCreateProgress(dir, '2026-04-30T00:00:00Z');
    expect(readJsonFile(path.join(dir, 'progress.json'))).toEqual(progress);
  });

  it('marks phase done and writes snapshots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
    const progress = markPhaseDone(createInitialProgress('2026-04-30T00:00:00Z'), 'scan', 'apiDiff', '2026-04-30T00:01:00Z');
    writeProgressSnapshot(dir, 'scan', progress);
    expect(progress.currentPhase).toBe('apiDiff');
    expect(readJsonFile(path.join(dir, 'progress.scan.snapshot.json'))).toEqual(progress);
  });

  it('updates baseline route progress immutably', () => {
    const progress = createInitialProgress('2026-04-30T00:00:00Z');
    const next = updateBaselineRoute(progress, 'course-center', { status: 'done', routePath: '/course-center' });
    expect(progress.items.baselineCoverage.routes['course-center']).toBeUndefined();
    expect(next.items.baselineCoverage.routes['course-center'].status).toBe('done');
  });
});
```

新增 `scan/__tests__/reconcile.test.ts`，覆盖 scan artifact 缺失回退、baseline heartbeat stale、after fixes 未 commit 阻塞。

新增 `scan/__tests__/resumeCli.test.ts`，用 `node -r ts-node/register src/resume.ts --state-dir <tmp>` 验证输出包含 `Next action: run-scan`。

运行：

```bash
yarn workspace scan test --runInBand __tests__/state.test.ts __tests__/reconcile.test.ts __tests__/resumeCli.test.ts
```

预期：失败，因为实现未写。

- [ ] **Step 4：实现 state/reconcile/resume**

实现 `scan/src/state.ts`，包含：

- `UpgradeProgress`、`PhaseName`、`RouteItemProgress` 类型。
- `atomicWriteJson()`，写 `.tmp`、fsync、已有文件改名 `.bak`、rename。
- `createInitialProgress()`。
- `loadOrCreateProgress()`。
- `markPhaseDone()`。
- `updateBaselineRoute()` / `updateAfterRoute()`。
- `writeProgressSnapshot()`。

实现 `scan/src/reconcile.ts`，包含：

- scan done 但缺 `coverage-targets.json` / `route-checklist.json` / `pages.json` 时回退 scan。
- baseline route running 且 `runtime-state.json` heartbeat 超过 120 秒时标记 stale。
- after route 有 `fixes.json` 且未记录 commit 时标记 blocked。

实现 `scan/src/resume.ts`，包含：

- `--state-dir` 参数。
- `loadOrCreateProgress()`。
- `reconcileProgress()`。
- 有变更时写回 `progress.json`。
- stdout 输出 JSON payload 和简短 human summary。

运行：

```bash
yarn workspace scan test --runInBand __tests__/state.test.ts __tests__/reconcile.test.ts __tests__/resumeCli.test.ts
```

预期：通过。

- [ ] **Step 5：打包 resume.js**

修改 `scan/package.json`：

```json
"scripts": {
  "build": "yarn build:scan && yarn build:resume",
  "build:scan": "esbuild src/index.ts --bundle --platform=node --target=node16 --outfile=dist/scan.js",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace scan build:resume
yarn workspace scan build
```

预期：`scan/dist/scan.js` 和 `scan/dist/resume.js` 都存在。

- [ ] **Step 6：提交**

```bash
git add scan/src/manifest.ts scan/src/index.ts scan/src/state.ts scan/src/reconcile.ts scan/src/resume.ts scan/__tests__/manifest.test.ts scan/__tests__/state.test.ts scan/__tests__/reconcile.test.ts scan/__tests__/resumeCli.test.ts scan/package.json
git commit -m "feat(skill): add local state and resume foundation"
```

## 3. Task 2：Scan 接入新状态与产物 Schema

**Files:**
- Modify: `scan/src/runScan.ts`
- Modify: `scan/src/index.ts`
- Modify: `scan/__tests__/runScan.test.ts`
- Modify: `scan/__tests__/manifest.test.ts`

- [ ] **Step 1：补 scan progress 测试**

在 `scan/__tests__/runScan.test.ts` 增加测试，断言运行 scan 后：

- 写出 `coverage-targets.json`、`route-checklist.json`、`pages.json`。
- `coverage-targets.json.targets[].targetId` 稳定。
- `route-checklist.json.selectedRoutes[].targetIds` 来自 coverage targets。
- CLI 运行后 `progress.json.phases.scan.status === "done"`。
- 写出 `progress.scan.snapshot.json`。

示例断言：

```ts
expect(readJson(path.join(stateDir, 'progress.json')).phases.scan.status).toBe('done');
expect(fs.existsSync(path.join(stateDir, 'progress.scan.snapshot.json'))).toBe(true);
```

运行：

```bash
yarn workspace scan test --runInBand __tests__/runScan.test.ts
```

预期：progress 相关断言失败。

- [ ] **Step 2：实现 scan 状态更新**

在 `scan/src/index.ts` 的 `main()` 中：

- 先 `loadOrCreateProgress(stateDir)`。
- 成功 `runScan()` 后调用 `markPhaseDone(progress, 'scan', 'apiDiff')`。
- `atomicWriteJson(stateDir/progress.json, nextProgress)`。
- `writeProgressSnapshot(stateDir, 'scan', nextProgress)`。

运行：

```bash
yarn workspace scan test --runInBand __tests__/runScan.test.ts
```

预期：通过。

- [ ] **Step 3：确保 route-checklist 支持 after-runtime 输入**

修改 `route-checklist.json` selected route 项，保留：

```json
{
  "routeId": "paper-edit-id",
  "path": "/paper/edit/:id",
  "url": "https://example.test/paper/edit/:id",
  "targetIds": ["src/pages/Paper/Edit.tsx#ModalForm#L88#C12"],
  "confirmedCount": 0,
  "targetCount": 3
}
```

动态参数仍允许 `url` 是模板，真正业务参数由 baseline 人工操作阶段通过实际 URL 和 context 捕获。

运行：

```bash
yarn workspace scan test --runInBand
```

预期：通过。

- [ ] **Step 4：提交**

```bash
git add scan/src/runScan.ts scan/src/index.ts scan/__tests__/runScan.test.ts
git commit -m "feat(skill): wire scan into progress state"
```

## 4. Task 3：API Diff Phase

**Files:**
- Create: `scan/src/apiDiff.ts`
- Create: `scan/src/api-diff-cli.ts`
- Create: `scan/__tests__/apiDiff.test.ts`
- Modify: `scan/package.json`

- [ ] **Step 1：写 apiDiff 纯函数测试**

创建 `scan/__tests__/apiDiff.test.ts`，构造两个临时包：

```text
baseline/node_modules/@example/ui/lib/Button.d.ts
after/node_modules/@example/ui/lib/Button.d.ts
coverage-state/pages.json
```

baseline:

```ts
export interface ButtonProps {
  oldName?: string;
  mode?: 'a' | 'b';
}
export declare function Button(props: ButtonProps): JSX.Element;
```

after:

```ts
export interface ButtonProps {
  newName?: string;
  mode?: 'a';
  requiredLabel: string;
}
export declare function Button(props: ButtonProps): JSX.Element;
```

断言：

- `dts-diff.md` 包含 `Button`、`oldName`、`newName`、`requiredLabel`。
- `dts-impact.md` 包含使用 `Button` 的 route。
- 返回 summary 包含 red/yellow/green 计数。

运行：

```bash
yarn workspace scan test --runInBand __tests__/apiDiff.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 apiDiff**

`scan/src/apiDiff.ts` 实现：

- 从 `manifest.baseline.worktreePath` 和当前项目 root 定位目标包。
- 递归查找 `lib/`、`es/`、`dist/`、`types/` 下 `.d.ts`。
- 对同名 `.d.ts` 文件做行级 diff。
- 简单分类：
  - 删除 prop/export：RED。
  - 新增 required prop：RED。
  - union 成员减少：YELLOW。
  - 新增 optional prop：GREEN。
- 读取 `pages.json`，按 component 名映射影响 route。
- 写 `api-diff/dts-diff.md`、`api-diff/dts-impact.md`。

`scan/src/api-diff-cli.ts` 实现：

- 解析 `--state-dir`。
- 读取 manifest/progress。
- 调用 apiDiff。
- 成功后 mark `apiDiff` done，next phase 为 `build`。
- 写 snapshot。

运行：

```bash
yarn workspace scan test --runInBand __tests__/apiDiff.test.ts
```

预期：通过。

- [ ] **Step 3：打包 api-diff CLI**

修改 `scan/package.json`：

```json
"scripts": {
  "build": "yarn build:scan && yarn build:resume && yarn build:api-diff",
  "build:scan": "esbuild src/index.ts --bundle --platform=node --target=node16 --outfile=dist/scan.js",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "build:api-diff": "esbuild src/api-diff-cli.ts --bundle --platform=node --target=node16 --outfile=dist/api-diff.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace scan build:api-diff
node scan/dist/api-diff.js --state-dir /tmp/nonexistent-state
```

预期：第二条命令失败并输出缺 manifest/progress 的明确错误，不出现 stack trace。

- [ ] **Step 4：提交**

```bash
git add scan/src/apiDiff.ts scan/src/api-diff-cli.ts scan/__tests__/apiDiff.test.ts scan/package.json
git commit -m "feat(skill): add api diff phase"
```

## 5. Task 4：Baseline Coverage Context

**Files:**
- Create: `recorder/src/action_timeline.py`
- Create: `recorder/src/evidence.py`
- Modify: `recorder/src/runner.py`
- Modify: `recorder/src/panel_state.py`
- Modify: `panel/src/App.tsx`
- Modify: `panel/src/types.ts`
- Create: `recorder/tests/test_action_timeline.py`
- Create: `recorder/tests/test_evidence.py`
- Modify: `recorder/tests/test_recorder_dry_run.py`

- [ ] **Step 1：写 action timeline 测试**

创建 `recorder/tests/test_action_timeline.py`：

```py
from action_timeline import assign_events_to_actions, create_target_context

def test_assigns_console_and_network_events_to_action_window():
    actions = [{"actionId": "a1", "startedAtMs": 1000, "endedAtMs": 1500}]
    console = [{"id": "c1", "atMs": 1200}, {"id": "c2", "atMs": 3000}]
    network = [{"id": "n1", "atMs": 1510}]
    assigned = assign_events_to_actions(actions, console, network, [], grace_ms=100)
    assert assigned[0]["consoleEventIds"] == ["c1"]
    assert assigned[0]["networkEventIds"] == ["n1"]

def test_target_context_records_first_seen_action():
    context = create_target_context(
        target_id="src/A.tsx#ModalForm#L8#C1",
        action={"actionId": "a2", "endedAtMs": 2400, "urlAfter": "https://example.test/a"},
        screenshot="screenshots/a2.png",
        aria_snapshot="aria-snapshots/a2.yml",
    )
    assert context["firstSeenActionId"] == "a2"
    assert context["firstSeenUrl"] == "https://example.test/a"
```

运行：

```bash
cd recorder && pytest tests/test_action_timeline.py
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 action_timeline.py**

实现：

- `assign_events_to_actions(actions, console_events, network_events, error_events, grace_ms=1000)`。
- `create_target_context(target_id, action, screenshot, aria_snapshot)`。
- 对敏感 input 不保存原始 value，只保存 `valueKind` 和长度。

运行：

```bash
cd recorder && pytest tests/test_action_timeline.py
```

预期：通过。

- [ ] **Step 3：写 evidence 测试**

创建 `recorder/tests/test_evidence.py`，断言 `write_route_evidence()` 写出：

```text
coverage.json
interaction-context.json
console.json
network.json
errors.json
screenshots/
aria-snapshots/
```

`coverage.json` 必须包含：

- `confirmedTargetIds`
- `remainingTargetIds`
- `targetContexts`
- `operatorNote` 或 `forceConfirmReason`

运行：

```bash
cd recorder && pytest tests/test_evidence.py
```

预期：失败，模块不存在。

- [ ] **Step 4：实现 evidence.py**

实现：

- `atomic_write_json(path, value)`。
- `write_route_evidence(state_dir, baseline_version, route, confirmed_target_ids, remaining_target_ids, target_contexts, interaction_context, console_events, network_events, error_events, route_note, screenshot_files, aria_snapshot_files)`。
- session logs 全量写入，action 中只引用 event ids。
- 目录名使用 `routes/<route-id>`，不再使用旧 `pages/<route-id>`。

运行：

```bash
cd recorder && pytest tests/test_evidence.py
```

预期：通过。

- [ ] **Step 5：增强 runner.py**

修改 `recorder/src/runner.py`：

- 保留现有用户交互：`Confirm current route`、`Skip current route`。
- 保留 `route_seen_target_ids` union 语义。
- 注入浏览器 action listener，记录 click/input/change/select/key/navigation/idle。
- 注册 console/network/pageerror listener，写 session 级事件。
- 每次 marker 新 target 首次出现时，关联最近 action，保存 screenshot 和 aria snapshot。
- confirm 时调用 `write_route_evidence()`。
- 写 `runtime-state.json` 时增加 `heartbeatAt`。
- 支持 `--route <route-id>` 从指定 route 启动，用于 resume。

运行：

```bash
cd recorder && pytest
```

预期：通过。

- [ ] **Step 6：调整 panel routeNote 语义**

修改 `panel/src/App.tsx` 与 `panel/src/types.ts`：

- UI 仍显示同一个 textarea。
- placeholder 改成 `Optional note; required when forcing confirm or skipping`。
- `confirmRoute(reason)` 改名或类型语义调整为 `confirmRoute(routeNote?: string)`。
- 如果 remaining 非空仍强制要求填写。
- skip 仍要求填写。

运行：

```bash
yarn workspace panel build
```

预期：通过。

- [ ] **Step 7：提交**

```bash
git add recorder/src/action_timeline.py recorder/src/evidence.py recorder/src/runner.py recorder/src/panel_state.py recorder/tests/test_action_timeline.py recorder/tests/test_evidence.py recorder/tests/test_recorder_dry_run.py panel/src/App.tsx panel/src/types.ts
git commit -m "feat(skill): capture baseline interaction context"
```

## 6. Task 5：After Runtime Plan 与 Subagent Prompt

**Files:**
- Create: `scan/src/afterRuntimePlan.ts`
- Create: `scan/src/after-runtime-plan-cli.ts`
- Create: `scan/__tests__/afterRuntimePlan.test.ts`
- Create: `skill-template/subagent-prompts.md.tpl`
- Modify: `scan/package.json`

- [ ] **Step 1：写 after-runtime-plan 测试**

创建 `scan/__tests__/afterRuntimePlan.test.ts`：

- baseline route 有 `coverage.json.confirmedTargetIds` 非空时，进入 `routes[]`。
- skipped route 进入 `excluded.skippedRoutes`。
- uncovered target 进入 `excluded.uncoveredTargetIds`。
- forced-only target 不作为自动断言，进入 `excluded.forcedOnlyTargetIds`。

运行：

```bash
yarn workspace scan test --runInBand __tests__/afterRuntimePlan.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 after runtime plan**

`scan/src/afterRuntimePlan.ts` 实现：

- 读取 `coverage-targets.json`。
- 读取 `runtime-state.json` 或 baseline route evidence。
- 只收集 baseline confirmed route/target。
- 输出 `after-runtime-plan.json`。

`scan/src/after-runtime-plan-cli.ts` 实现：

- `--state-dir` 参数。
- 成功生成 plan 后，确保 progress current phase 为 `afterRuntime`。

运行：

```bash
yarn workspace scan test --runInBand __tests__/afterRuntimePlan.test.ts
```

预期：通过。

- [ ] **Step 3：写 after-runtime subagent prompt 模板**

修改 `scan/package.json`：

```json
"scripts": {
  "build": "yarn build:scan && yarn build:resume && yarn build:api-diff && yarn build:after-runtime-plan",
  "build:scan": "esbuild src/index.ts --bundle --platform=node --target=node16 --outfile=dist/scan.js",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "build:api-diff": "esbuild src/api-diff-cli.ts --bundle --platform=node --target=node16 --outfile=dist/api-diff.js",
  "build:after-runtime-plan": "esbuild src/after-runtime-plan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/after-runtime-plan.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace scan build:after-runtime-plan
yarn workspace scan build
```

预期：通过，并生成 `scan/dist/after-runtime-plan.js`。

创建 `skill-template/subagent-prompts.md.tpl`，包含两个 prompt：

1. `build-fix`
2. `after-runtime-route`

`after-runtime-route` 必须明确：

- 输入：routeId、expectedTargetIds、baselineEvidenceDir、interactionContextPath、stateDir、maxFixAttempts。
- 可以根据 baseline context 改路径，不必机械 replay。
- 通过标准：target marker 再次命中、功能语义可达、无 after-only blocking runtime error。
- 输出：`initial/`、`final/`、`fixes.json`、`result.json`。
- 不得更新 `progress.json`。
- 不得提交。
- shared component 或跨 route 风险进入 `needs-decision`。

- [ ] **Step 4：提交**

```bash
git add scan/src/afterRuntimePlan.ts scan/src/after-runtime-plan-cli.ts scan/__tests__/afterRuntimePlan.test.ts scan/package.json skill-template/subagent-prompts.md.tpl
git commit -m "feat(skill): add after runtime planning and prompts"
```

## 7. Task 6：Report Phase

**Files:**
- Create: `scan/src/report.ts`
- Create: `scan/src/report-cli.ts`
- Create: `scan/__tests__/report.test.ts`
- Modify: `scan/package.json`

- [ ] **Step 1：写 report 测试**

创建 `scan/__tests__/report.test.ts`，构造临时 `coverage-state`：

- `coverage-targets.json`
- baseline route `coverage.json`
- `after-runtime-plan.json`
- after route `final/claims.json`
- `api-diff/dts-impact.md`
- `build/build-fixes.md`

断言生成：

```text
report/summary.md
report/coverage-summary.json
report/runtime-diff.json
report/api-impact.json
```

`summary.md` 必须包含：

- confirmed targets count
- after passed/failed/needs-decision count
- skipped routes
- uncovered targets
- accepted exceptions

运行：

```bash
yarn workspace scan test --runInBand __tests__/report.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 report**

`scan/src/report.ts` 实现：

- 汇总 scan coverage。
- 汇总 baseline skipped/uncovered/forced。
- 汇总 after claims 状态。
- 汇总 build fixes 与 api impact 链接。
- 写 markdown 与 JSON。

`scan/src/report-cli.ts` 实现：

- `--state-dir` 参数。
- report 成功后 mark `report` done，currentPhase `done`。
- 写 `progress.report.snapshot.json`。

运行：

```bash
yarn workspace scan test --runInBand __tests__/report.test.ts
```

预期：通过。

- [ ] **Step 3：提交**

修改 `scan/package.json`：

```json
"scripts": {
  "build": "yarn build:scan && yarn build:resume && yarn build:api-diff && yarn build:after-runtime-plan && yarn build:report",
  "build:scan": "esbuild src/index.ts --bundle --platform=node --target=node16 --outfile=dist/scan.js",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "build:api-diff": "esbuild src/api-diff-cli.ts --bundle --platform=node --target=node16 --outfile=dist/api-diff.js",
  "build:after-runtime-plan": "esbuild src/after-runtime-plan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/after-runtime-plan.js",
  "build:report": "esbuild src/report-cli.ts --bundle --platform=node --target=node16 --outfile=dist/report.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace scan build:report
yarn workspace scan build
```

预期：通过，并生成 `scan/dist/report.js`。

- [ ] **Step 4：提交**

```bash
git add scan/src/report.ts scan/src/report-cli.ts scan/__tests__/report.test.ts scan/package.json
git commit -m "feat(skill): add final report phase"
```

## 8. Task 7：SKILL.md 编排与 Build Skill

**Files:**
- Modify: `skill-template/SKILL.md.tpl`
- Modify: `scripts/build-skill.ts`
- Modify: `scan/package.json`

- [ ] **Step 1：更新 SKILL 模板**

`skill-template/SKILL.md.tpl` 必须包含：

- 激活后第一步运行 `resume.js`。
- Phase 顺序：bootstrap、scan、api-diff、build、baseline-coverage、after-runtime、report。
- 不兼容旧 `e2e-xui-pro/`。
- Phase baseline-coverage 不派 subagent。
- Phase build / after-runtime 使用 subagent prompts。
- checkpoint：scan 后、build needs-decision、baseline 完成后、after needs-decision、report 后。
- main agent 是 `progress.json` 唯一 writer。

- [ ] **Step 2：更新 build-skill**

`scripts/build-skill.ts` 需要复制：

```text
scan/dist/scan.js              -> scripts/scan.js
scan/dist/resume.js            -> scripts/resume.js
scan/dist/api-diff.js          -> scripts/api-diff.js
scan/dist/after-runtime-plan.js -> scripts/after-runtime-plan.js
scan/dist/report.js            -> scripts/report.js
panel/dist/index.html          -> scripts/panel/index.html
recorder/src/*.py              -> scripts/
skill-template/subagent-prompts.md.tpl -> subagent-prompts.md
```

- [ ] **Step 3：构建 skill**

运行：

```bash
yarn workspace scan build
yarn workspace panel build
yarn build:skill
```

预期：

```text
dist/skills/react-component-upgrade/SKILL.md
dist/skills/react-component-upgrade/subagent-prompts.md
dist/skills/react-component-upgrade/scripts/scan.js
dist/skills/react-component-upgrade/scripts/resume.js
dist/skills/react-component-upgrade/scripts/api-diff.js
dist/skills/react-component-upgrade/scripts/after-runtime-plan.js
dist/skills/react-component-upgrade/scripts/report.js
dist/skills/react-component-upgrade/scripts/recorder.py
dist/skills/react-component-upgrade/scripts/runner.py
dist/skills/react-component-upgrade/scripts/action_timeline.py
dist/skills/react-component-upgrade/scripts/evidence.py
dist/skills/react-component-upgrade/scripts/panel/index.html
```

- [ ] **Step 4：提交**

```bash
git add skill-template/SKILL.md.tpl skill-template/subagent-prompts.md.tpl scripts/build-skill.ts scan/package.json
git commit -m "feat(skill): orchestrate complete react component upgrade workflow"
```

## 9. Task 8：端到端验证

**Files:**
- Modify only if verification exposes bugs.

- [ ] **Step 1：运行全部测试**

```bash
yarn workspace scan test --runInBand
yarn workspace panel build
cd recorder && pytest
```

预期：全部通过。

- [ ] **Step 2：构建分发 skill**

```bash
yarn build:skill
```

预期：构建成功，dist 中包含所有脚本。

- [ ] **Step 3：临时状态目录 smoke test**

```bash
tmpdir="$(mktemp -d)"
mkdir -p "$tmpdir/coverage-state"
cat > "$tmpdir/coverage-state/manifest.json" <<'JSON'
{
  "schemaVersion": 1,
  "project": "smoke",
  "library": "@example/ui",
  "baseline": { "version": "1.0.0", "commit": "abc123", "worktreePath": "/tmp/missing-baseline" },
  "after": { "version": "1.1.0", "branch": "feature/upgrade" },
  "runtime": {
    "targetPackages": ["@example/ui"],
    "baseUrl": "https://example.test",
    "devCommand": "yarn start",
    "devPort": 3033,
    "proxy": null,
    "playwrightProfile": "coverage-state/.playwright-profile"
  }
}
JSON
(cd "$tmpdir" && node /Users/liuyunxia/Documents/odc_workspace/scepter-smart-trains-xui-pro-update/component-upgrade-coverage-recorder/dist/skills/react-component-upgrade/scripts/resume.js --state-dir coverage-state)
```

预期 stdout 包含：

```text
Next action: run-scan
```

- [ ] **Step 4：git 状态检查**

```bash
git status --short
```

预期：干净。

- [ ] **Step 5：最终提交或记录验证修复**

如果验证阶段有修复：

```bash
git add <changed-files>
git commit -m "test(skill): verify complete workflow build"
```

如果无修复，不提交。
