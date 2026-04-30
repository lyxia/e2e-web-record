# component-upgrade-coverage-recorder

React 组件库升级覆盖证据采集工具。它会扫描业务代码里的目标组件调用点，录制 baseline 覆盖证据，再在升级后的代码里验证这些覆盖点是否仍然可达，最后生成报告。

## 1. 构建 skill

在本仓库运行：

```bash
yarn install
yarn build:skill
```

生成产物在：

```text
dist/skills/react-component-upgrade/
```

后续命令里的 `$SKILL_DIR` 指向这个目录。

## 2. 准备业务项目

在升级后的业务项目里创建：

```text
coverage-state/manifest.json
```

示例：

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

安装运行依赖：

```bash
yarn add -D @odc/coverage-marker
pip install playwright pytest
playwright install chromium
```

业务项目的 babel/craco 需要在 `COVERAGE_MODE=1` 时加载 `@odc/coverage-marker`，并从 `coverage-state/manifest.json` 读取 `runtime.targetPackages`。

## 3. 准备 baseline worktree

在升级后的业务项目旁边创建 baseline worktree：

```bash
git worktree add /abs/path/to/baseline-worktree <baseline-commit>
( cd /abs/path/to/baseline-worktree && yarn install )
```

`manifest.baseline.worktreePath` 必须指向这个目录。

## 4. 运行 scan

在升级后的业务项目里运行：

```bash
node $SKILL_DIR/scripts/workflow/scan.js --state-dir coverage-state --project-root .
```

输出：

```text
coverage-state/coverage-targets.json
coverage-state/route-checklist.json
coverage-state/pages.json
```

## 5. 运行 API diff

```bash
node $SKILL_DIR/scripts/workflow/api-diff.js --state-dir coverage-state
```

输出：

```text
coverage-state/api-diff/dts-diff.md
coverage-state/api-diff/dts-impact.md
```

## 6. 录制 baseline 覆盖

先在 baseline worktree 启动业务：

```bash
cd "$(jq -r '.baseline.worktreePath' <after-project>/coverage-state/manifest.json)"
STATE_DIR="<after-project>/coverage-state" \
  COVERAGE_MODE=1 BROWSER=none yarn start
```

再在升级后的业务项目里启动 recorder：

```bash
cd <after-project>
RECORDER_PYTHON="$(jq -r '.runtime.pythonPath' coverage-state/manifest.json)"
"$RECORDER_PYTHON" $SKILL_DIR/scripts/recorder/recorder.py \
  --state-dir coverage-state \
  --panel-html $SKILL_DIR/scripts/panel/index.html
```

如果要从某条 route 恢复：

```bash
"$RECORDER_PYTHON" $SKILL_DIR/scripts/recorder/recorder.py \
  --state-dir coverage-state \
  --panel-html $SKILL_DIR/scripts/panel/index.html \
  --route <routeId>
```

baseline 证据输出到：

```text
coverage-state/runs/baseline-<version>/routes/<routeId>/
```

每条 route 包含 `coverage.json`、`interaction-context.json`、日志、截图、aria snapshot 和 `trace.zip`。

## 7. 运行 after-runtime 验证

先生成 after-runtime 计划：

```bash
node $SKILL_DIR/scripts/workflow/after-runtime-plan.js --state-dir coverage-state
```

启动升级后的业务项目：

```bash
COVERAGE_MODE=1 BROWSER=none yarn start
```

对单条 route 运行固定 recorder：

```bash
python3 $SKILL_DIR/scripts/recorder/after_runtime_recorder.py \
  --state-dir coverage-state \
  --route-id <routeId>
```

可以多次传 `--route-id`。如果某条 route 需要额外交互，在运行前写：

```text
coverage-state/runs/after/routes/<routeId>/playbook.json
```

示例：

```json
{
  "steps": [
    { "type": "click", "texts": ["新增", "Add"], "timeout": 3000 },
    { "type": "wait", "ms": 1000 },
    { "type": "clickTabs", "max": 3 }
  ]
}
```

after-runtime 证据输出到：

```text
coverage-state/runs/after/routes/<routeId>/
  initial/
  final/
  result.json
  fixes.json
```

`initial/` 和 `final/` 都包含截图、视频、trace 和运行时日志。

## 8. 质量门

after-runtime 完成后运行：

```bash
node $SKILL_DIR/scripts/workflow/after-runtime-quality-gate.js --state-dir coverage-state
```

它会检查每条 planned route 的 `result.json`、final coverage、`trace.zip`、`video.webm` 和 expected targets 是否一致。

## 9. 生成报告

```bash
node $SKILL_DIR/scripts/workflow/report.js --state-dir coverage-state
```

输出：

```text
coverage-state/report/summary.md
coverage-state/report/index.html
coverage-state/report/coverage-summary.json
coverage-state/report/runtime-diff.json
coverage-state/report/api-impact.json
```

优先打开：

```text
coverage-state/report/index.html
```

里面有 baseline / after initial / after final 的截图、视频、trace 和 route 级对比。

## 常用检查

查看下一步：

```bash
node $SKILL_DIR/scripts/workflow/resume.js --state-dir coverage-state
```

检查 marker 是否生效，在业务页面 DevTools 里执行：

```js
Array.from(window.__coverageMark__ || [])
```

测试本仓库：

```bash
~/.pyenv/versions/3.11.9/bin/python -m pytest -q
yarn workspace workflow test --runInBand
```
