# react-component-upgrade 完整 Skill 实现计划

> **给执行 agent：** 实施本计划前必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 基于已确认设计 `docs/superpowers/specs/2026-04-30-react-component-upgrade-skill-design.md`，把当前 MVP 采集器扩展为完整可分发的 `react-component-upgrade` skill。

**架构：** 在现有 monorepo 内继续演进：`scan/` 只做纯静态扫描，不读取 manifest/progress；新增 `workflow/` workspace 负责 manifest、state/resume、api-diff、after-runtime plan、report 等流程编排脚本；`recorder/` 承载 Playwright Python 长跑采集进程，`panel/` 承载人工操作面板，`packages/coverage-marker/` 承载 Babel marker 注入。main agent 只编排和更新本地状态；Phase build 与 after-runtime 的 LLM 判断工作通过串行 subagent 完成。

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
│   ├── runScan.ts            # 纯 AST scan，输入显式参数，输出 scan artifacts
│   ├── findJsxCallSites.ts
│   ├── parseRouter.ts
│   ├── buildImportGraph.ts
│   ├── greedyCover.ts
│   └── index.ts              # 纯 scan CLI，不读 manifest/progress
├── __tests__/
│   └── runScan.test.ts
└── package.json

workflow/
├── src/
│   ├── manifest.ts           # manifest schema 与解析
│   ├── state.ts              # progress schema、原子写、snapshot、状态更新
│   ├── reconcile.ts          # artifact 与 progress 对账
│   ├── resume.ts             # resume CLI
│   ├── runScanPhase.ts       # 读取 manifest/progress 后调用 scan workspace
│   ├── run-scan-cli.ts       # scan phase CLI
│   ├── apiDiff.ts            # d.ts diff 与 impact 分析
│   ├── api-diff-cli.ts       # api-diff CLI
│   ├── afterRuntimePlan.ts   # 根据 baseline evidence 生成 after-runtime-plan.json
│   ├── after-runtime-plan-cli.ts
│   ├── report.ts             # 汇总报告
│   └── report-cli.ts
├── __tests__/
│   ├── state.test.ts
│   ├── reconcile.test.ts
│   ├── resumeCli.test.ts
│   ├── runScanPhase.test.ts
│   ├── apiDiff.test.ts
│   ├── afterRuntimePlan.test.ts
│   └── report.test.ts
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
- Modify: `package.json`
- Create: `workflow/package.json`
- Create: `workflow/tsconfig.json`
- Modify: `workflow/src/manifest.ts`
- Create: `workflow/src/state.ts`
- Create: `workflow/src/reconcile.ts`
- Create: `workflow/src/resume.ts`
- Create: `workflow/__tests__/state.test.ts`
- Create: `workflow/__tests__/reconcile.test.ts`
- Create: `workflow/__tests__/resumeCli.test.ts`
- Create: `workflow/__tests__/manifest.test.ts`

- [ ] **Step 1：新增 workflow workspace**

修改根 `package.json`：

```json
{
  "name": "component-upgrade-coverage-recorder",
  "private": true,
  "workspaces": ["packages/*", "scan", "panel", "workflow"],
  "scripts": {
    "build:skill": "ts-node scripts/build-skill.ts",
    "test": "yarn workspaces run test"
  },
  "devDependencies": {
    "ts-node": "^10.9.0",
    "typescript": "^4.6.3"
  }
}
```

创建 `workflow/package.json`：

```json
{
  "name": "workflow",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "build": "yarn build:resume",
    "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
    "test": "jest"
  },
  "dependencies": {
    "scan": "0.0.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/node": "^16.18.126",
    "esbuild": "^0.20.2",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.5"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.ts"]
  }
}
```

创建 `workflow/tsconfig.json`：

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["jest", "node"]
  },
  "include": ["src", "__tests__"]
}
```

- [ ] **Step 2：扩展 manifest 测试**

在 `workflow/__tests__/manifest.test.ts` 写入：

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadManifest, resolveManifestBaseUrl } from '../src/manifest';

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
yarn workspace workflow test --runInBand __tests__/manifest.test.ts
```

预期：失败，提示 `resolveManifestBaseUrl` 未定义。

- [ ] **Step 3：实现 manifest schema**

将 `workflow/src/manifest.ts` 扩展为：

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

运行：

```bash
yarn workspace workflow test --runInBand __tests__/manifest.test.ts
```

预期：通过。

- [ ] **Step 4：写 state/reconcile/resume 测试**

新增 `workflow/__tests__/state.test.ts`，覆盖：

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

新增 `workflow/__tests__/reconcile.test.ts`，覆盖 scan artifact 缺失回退、baseline heartbeat stale、after fixes 未 commit 阻塞。

新增 `workflow/__tests__/resumeCli.test.ts`，用 `node -r ts-node/register src/resume.ts --state-dir <tmp>` 验证输出包含 `Next action: run-scan`。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/state.test.ts __tests__/reconcile.test.ts __tests__/resumeCli.test.ts
```

预期：失败，因为实现未写。

- [ ] **Step 5：实现 state/reconcile/resume**

实现 `workflow/src/state.ts`，包含：

- `UpgradeProgress`、`PhaseName`、`RouteItemProgress` 类型。
- `atomicWriteJson()`，写 `.tmp`、fsync、已有文件改名 `.bak`、rename。
- `createInitialProgress()`。
- `loadOrCreateProgress()`。
- `markPhaseDone()`。
- `updateBaselineRoute()` / `updateAfterRoute()`。
- `writeProgressSnapshot()`。

实现 `workflow/src/reconcile.ts`，包含：

- scan done 但缺 `coverage-targets.json` / `route-checklist.json` / `pages.json` 时回退 scan。
- baseline route running 且 `runtime-state.json` heartbeat 超过 120 秒时标记 stale。
- after route 有 `fixes.json` 且未记录 commit 时标记 blocked。

实现 `workflow/src/resume.ts`，包含：

- `--state-dir` 参数。
- `loadOrCreateProgress()`。
- `reconcileProgress()`。
- 有变更时写回 `progress.json`。
- stdout 输出 JSON payload 和简短 human summary。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/state.test.ts __tests__/reconcile.test.ts __tests__/resumeCli.test.ts
```

预期：通过。

- [ ] **Step 6：打包 resume.js**

确认 `workflow/package.json` 包含：

```json
"scripts": {
  "build": "yarn build:resume",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace workflow build
```

预期：`workflow/dist/resume.js` 存在。

- [ ] **Step 7：提交**

```bash
git add package.json workflow/package.json workflow/tsconfig.json workflow/src/manifest.ts workflow/src/state.ts workflow/src/reconcile.ts workflow/src/resume.ts workflow/__tests__/manifest.test.ts workflow/__tests__/state.test.ts workflow/__tests__/reconcile.test.ts workflow/__tests__/resumeCli.test.ts
git commit -m "feat(skill): add local state and resume foundation"
```

## 3. Task 2：Scan 纯工具化与 Workflow Scan Phase

**Files:**
- Modify: `scan/src/runScan.ts`
- Modify: `scan/src/index.ts`
- Modify: `scan/__tests__/runScan.test.ts`
- Create: `workflow/src/runScanPhase.ts`
- Create: `workflow/src/run-scan-cli.ts`
- Create: `workflow/__tests__/runScanPhase.test.ts`
- Modify: `workflow/package.json`

- [ ] **Step 1：补 scan 纯 CLI 测试**

在 `scan/__tests__/runScan.test.ts` 增加测试，断言 scan CLI 只接受显式参数，不读取 `coverage-state/manifest.json` 或 `progress.json`：

- 写出 `coverage-targets.json`、`route-checklist.json`、`pages.json`。
- `coverage-targets.json.targets[].targetId` 稳定。
- `route-checklist.json.selectedRoutes[].targetIds` 来自 coverage targets。
- CLI 参数包括 `--project-root`、`--out-dir`、`--base-url`、`--target-package`。
- 输出目录没有 `progress.json`。

示例断言：

```ts
expect(fs.existsSync(path.join(outDir, 'coverage-targets.json'))).toBe(true);
expect(fs.existsSync(path.join(outDir, 'route-checklist.json'))).toBe(true);
expect(fs.existsSync(path.join(outDir, 'pages.json'))).toBe(true);
expect(fs.existsSync(path.join(outDir, 'progress.json'))).toBe(false);
```

运行：

```bash
yarn workspace scan test --runInBand __tests__/runScan.test.ts
```

预期：如果当前 CLI 仍读取 manifest，测试失败。

- [ ] **Step 2：实现纯 scan CLI**

修改 `scan/src/index.ts`：

- 移除 manifest/progress 读取。
- 支持 `--project-root <path>`，默认 `process.cwd()`。
- 支持 `--out-dir <path>`，必填。
- 支持重复 `--target-package <pkg>` 或逗号分隔 `--target-packages <a,b>`。
- 支持 `--base-url <url>`。
- 调用 `runScan({ projectRoot, outDir, baseUrl, targetPackages })`。

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

- [ ] **Step 4：写 workflow run-scan phase 测试**

创建 `workflow/__tests__/runScanPhase.test.ts`：

- 构造临时项目和 `coverage-state/manifest.json`。
- 调用 `runScanPhase(stateDir, projectRoot)`。
- 断言 scan artifacts 写到 `coverage-state/`。
- 断言 `progress.json.phases.scan.status === "done"`。
- 断言 `progress.scan.snapshot.json` 存在。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/runScanPhase.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 5：实现 workflow scan phase**

实现 `workflow/src/runScanPhase.ts`：

- 读取 manifest。
- `validateTargetPackages(manifest.runtime.targetPackages)`。
- `resolveManifestBaseUrl(manifest)`。
- 调用从 `scan` workspace 导出的 `runScan()`。
- 成功后更新 progress：scan done，next phase `apiDiff`。
- 写 `progress.scan.snapshot.json`。

实现 `workflow/src/run-scan-cli.ts`：

- 支持 `--state-dir` 和 `--project-root`。
- 调用 `runScanPhase()`。
- stdout 输出 scan summary。

修改 `workflow/package.json` 增加：

```json
"build": "yarn build:resume && yarn build:run-scan",
"build:run-scan": "esbuild src/run-scan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/run-scan.js"
```

运行：

```bash
yarn workspace workflow test --runInBand __tests__/runScanPhase.test.ts
yarn workspace workflow build:run-scan
yarn workspace workflow build
```

预期：通过，生成 `workflow/dist/run-scan.js`。

- [ ] **Step 6：提交**

```bash
git add scan/src/runScan.ts scan/src/index.ts scan/__tests__/runScan.test.ts workflow/src/runScanPhase.ts workflow/src/run-scan-cli.ts workflow/__tests__/runScanPhase.test.ts workflow/package.json
git commit -m "feat(skill): split pure scan from workflow scan phase"
```

## 4. Task 3：API Diff Phase

**Files:**
- Create: `workflow/src/apiDiff.ts`
- Create: `workflow/src/api-diff-cli.ts`
- Create: `workflow/__tests__/apiDiff.test.ts`
- Modify: `workflow/package.json`

- [ ] **Step 1：写 apiDiff 纯函数测试**

创建 `workflow/__tests__/apiDiff.test.ts`，构造两个临时包：

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
yarn workspace workflow test --runInBand __tests__/apiDiff.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 apiDiff**

`workflow/src/apiDiff.ts` 实现：

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

`workflow/src/api-diff-cli.ts` 实现：

- 解析 `--state-dir`。
- 读取 manifest/progress。
- 调用 apiDiff。
- 成功后 mark `apiDiff` done，next phase 为 `build`。
- 写 snapshot。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/apiDiff.test.ts
```

预期：通过。

- [ ] **Step 3：打包 api-diff CLI**

修改 `workflow/package.json`：

```json
"scripts": {
  "build": "yarn build:resume && yarn build:run-scan && yarn build:api-diff",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "build:run-scan": "esbuild src/run-scan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/run-scan.js",
  "build:api-diff": "esbuild src/api-diff-cli.ts --bundle --platform=node --target=node16 --outfile=dist/api-diff.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace workflow build:api-diff
node workflow/dist/api-diff.js --state-dir /tmp/nonexistent-state
```

预期：第二条命令失败并输出缺 manifest/progress 的明确错误，不出现 stack trace。

- [ ] **Step 4：提交**

```bash
git add workflow/src/apiDiff.ts workflow/src/api-diff-cli.ts workflow/__tests__/apiDiff.test.ts workflow/package.json
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
- Create: `workflow/src/afterRuntimePlan.ts`
- Create: `workflow/src/after-runtime-plan-cli.ts`
- Create: `workflow/__tests__/afterRuntimePlan.test.ts`
- Create: `skill-template/subagent-prompts.md.tpl`
- Modify: `workflow/package.json`

- [ ] **Step 1：写 after-runtime-plan 测试**

创建 `workflow/__tests__/afterRuntimePlan.test.ts`：

- baseline route 有 `coverage.json.confirmedTargetIds` 非空时，进入 `routes[]`。
- skipped route 进入 `excluded.skippedRoutes`。
- uncovered target 进入 `excluded.uncoveredTargetIds`。
- forced-only target 不作为自动断言，进入 `excluded.forcedOnlyTargetIds`。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/afterRuntimePlan.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 after runtime plan**

`workflow/src/afterRuntimePlan.ts` 实现：

- 读取 `coverage-targets.json`。
- 读取 `runtime-state.json` 或 baseline route evidence。
- 只收集 baseline confirmed route/target。
- 输出 `after-runtime-plan.json`。

`workflow/src/after-runtime-plan-cli.ts` 实现：

- `--state-dir` 参数。
- 成功生成 plan 后，确保 progress current phase 为 `afterRuntime`。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/afterRuntimePlan.test.ts
```

预期：通过。

- [ ] **Step 3：写 after-runtime subagent prompt 模板**

修改 `workflow/package.json`：

```json
"scripts": {
  "build": "yarn build:resume && yarn build:run-scan && yarn build:api-diff && yarn build:after-runtime-plan",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "build:run-scan": "esbuild src/run-scan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/run-scan.js",
  "build:api-diff": "esbuild src/api-diff-cli.ts --bundle --platform=node --target=node16 --outfile=dist/api-diff.js",
  "build:after-runtime-plan": "esbuild src/after-runtime-plan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/after-runtime-plan.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace workflow build:after-runtime-plan
yarn workspace workflow build
```

预期：通过，并生成 `workflow/dist/after-runtime-plan.js`。

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
git add workflow/src/afterRuntimePlan.ts workflow/src/after-runtime-plan-cli.ts workflow/__tests__/afterRuntimePlan.test.ts workflow/package.json skill-template/subagent-prompts.md.tpl
git commit -m "feat(skill): add after runtime planning and prompts"
```

## 7. Task 6：Report Phase

**Files:**
- Create: `workflow/src/report.ts`
- Create: `workflow/src/report-cli.ts`
- Create: `workflow/__tests__/report.test.ts`
- Modify: `workflow/package.json`

- [ ] **Step 1：写 report 测试**

创建 `workflow/__tests__/report.test.ts`，构造临时 `coverage-state`：

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
yarn workspace workflow test --runInBand __tests__/report.test.ts
```

预期：失败，模块不存在。

- [ ] **Step 2：实现 report**

`workflow/src/report.ts` 实现：

- 汇总 scan coverage。
- 汇总 baseline skipped/uncovered/forced。
- 汇总 after claims 状态。
- 汇总 build fixes 与 api impact 链接。
- 写 markdown 与 JSON。

`workflow/src/report-cli.ts` 实现：

- `--state-dir` 参数。
- report 成功后 mark `report` done，currentPhase `done`。
- 写 `progress.report.snapshot.json`。

运行：

```bash
yarn workspace workflow test --runInBand __tests__/report.test.ts
```

预期：通过。

- [ ] **Step 3：提交**

修改 `workflow/package.json`：

```json
"scripts": {
  "build": "yarn build:resume && yarn build:run-scan && yarn build:api-diff && yarn build:after-runtime-plan && yarn build:report",
  "build:resume": "esbuild src/resume.ts --bundle --platform=node --target=node16 --outfile=dist/resume.js",
  "build:run-scan": "esbuild src/run-scan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/run-scan.js",
  "build:api-diff": "esbuild src/api-diff-cli.ts --bundle --platform=node --target=node16 --outfile=dist/api-diff.js",
  "build:after-runtime-plan": "esbuild src/after-runtime-plan-cli.ts --bundle --platform=node --target=node16 --outfile=dist/after-runtime-plan.js",
  "build:report": "esbuild src/report-cli.ts --bundle --platform=node --target=node16 --outfile=dist/report.js",
  "test": "jest"
}
```

运行：

```bash
yarn workspace workflow build:report
yarn workspace workflow build
```

预期：通过，并生成 `workflow/dist/report.js`。

- [ ] **Step 4：提交**

```bash
git add workflow/src/report.ts workflow/src/report-cli.ts workflow/__tests__/report.test.ts workflow/package.json
git commit -m "feat(skill): add final report phase"
```

## 8. Task 7：SKILL.md 编排与 Build Skill

**Files:**
- Modify: `skill-template/SKILL.md.tpl`
- Modify: `scripts/build-skill.ts`
- Modify: `workflow/package.json`

- [ ] **Step 1：更新 SKILL 模板**

`skill-template/SKILL.md.tpl` 必须包含：

- 激活后第一步运行 `scripts/workflow/resume.js`。
- Phase 顺序：bootstrap、scan、api-diff、build、baseline-coverage、after-runtime、report。
- 不兼容旧 `e2e-xui-pro/`。
- Phase baseline-coverage 不派 subagent。
- Phase build / after-runtime 使用 subagent prompts。
- 所有命令路径使用功能子目录：
  - `node $SKILL_DIR/scripts/workflow/resume.js`
  - `node $SKILL_DIR/scripts/workflow/scan.js`
  - `node $SKILL_DIR/scripts/workflow/api-diff.js`
  - `node $SKILL_DIR/scripts/workflow/after-runtime-plan.js`
  - `node $SKILL_DIR/scripts/workflow/report.js`
  - `python3 $SKILL_DIR/scripts/recorder/recorder.py`
  - panel HTML 路径为 `$SKILL_DIR/scripts/panel/index.html`
- checkpoint：scan 后、build needs-decision、baseline 完成后、after needs-decision、report 后。
- main agent 是 `progress.json` 唯一 writer。

- [ ] **Step 2：更新 build-skill**

`scripts/build-skill.ts` 需要复制：

```text
workflow/dist/run-scan.js           -> scripts/workflow/scan.js
workflow/dist/resume.js             -> scripts/workflow/resume.js
workflow/dist/api-diff.js           -> scripts/workflow/api-diff.js
workflow/dist/after-runtime-plan.js -> scripts/workflow/after-runtime-plan.js
workflow/dist/report.js             -> scripts/workflow/report.js
panel/dist/index.html          -> scripts/panel/index.html
recorder/src/*.py              -> scripts/recorder/
skill-template/subagent-prompts.md.tpl -> subagent-prompts.md
```

- [ ] **Step 3：构建 skill**

运行：

```bash
yarn workspace scan build
yarn workspace workflow build
yarn workspace panel build
yarn build:skill
```

预期：

```text
dist/skills/react-component-upgrade/SKILL.md
dist/skills/react-component-upgrade/subagent-prompts.md
dist/skills/react-component-upgrade/scripts/workflow/scan.js
dist/skills/react-component-upgrade/scripts/workflow/resume.js
dist/skills/react-component-upgrade/scripts/workflow/api-diff.js
dist/skills/react-component-upgrade/scripts/workflow/after-runtime-plan.js
dist/skills/react-component-upgrade/scripts/workflow/report.js
dist/skills/react-component-upgrade/scripts/recorder/recorder.py
dist/skills/react-component-upgrade/scripts/recorder/runner.py
dist/skills/react-component-upgrade/scripts/recorder/action_timeline.py
dist/skills/react-component-upgrade/scripts/recorder/evidence.py
dist/skills/react-component-upgrade/scripts/panel/index.html
```

- [ ] **Step 4：提交**

```bash
git add skill-template/SKILL.md.tpl skill-template/subagent-prompts.md.tpl scripts/build-skill.ts workflow/package.json
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
(cd "$tmpdir" && node /Users/liuyunxia/Documents/odc_workspace/scepter-smart-trains-xui-pro-update/component-upgrade-coverage-recorder/dist/skills/react-component-upgrade/scripts/workflow/resume.js --state-dir coverage-state)
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
