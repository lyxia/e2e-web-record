# react-component-upgrade 完整 skill 设计

> 创建日期：2026-04-30
> 状态：已确认设计方向，待实现计划

## 1. 目标与边界

`react-component-upgrade` 是一个全新的完整 React 组件库升级回归 skill。它不是现有 `xui-pro-upgrade-regression` 的兼容层，也不读取、不迁移、不兼容旧的 `e2e-xui-pro/` 状态目录。

旧 skill 只作为参考：沿用它的文件化状态机、resume 协议、主会话薄编排、subagent 串行隔离等经验；运行时和 schema 以本设计为准。

本 skill 的目标是：

- 以目标组件包的 JSX call-site 为覆盖单位，而不是只看 route。
- 用本地文件作为唯一真相，支持会话中断、机器重启后的恢复。
- 让 Phase 2 baseline 人工操作成为 Phase 3 after 验证和修复的上下文来源。
- 保留 subagent 边界：main agent 只编排、读写状态、启动命令、提交修复；需要 LLM 判断的编译修复和 after runtime fix loop 由 subagent 串行执行。
- 不硬编码组件包名、版本、端口、代理或路由目录；这些都来自 `coverage-state/manifest.json`。

## 2. 总体架构

完整 skill 由四层组成：

| 层 | 职责 |
|---|---|
| Skill 入口层 | `SKILL.md` 定义状态机、resume 协议、Phase 编排、checkpoint、subagent 派发规则 |
| 确定性脚本层 | `scan.js`、`api-diff.js`、`state.js`、`resume.js`、`plan-after-runtime.js`、`diff-report.js` 等 |
| 采集运行层 | `coverage-marker`、`recorder.py`、`panel/index.html`，由 main agent 启动和监控，负责 baseline coverage 和上下文采集 |
| LLM 判断层 | Phase build fix 和 Phase after-runtime fix loop 的 subagent prompts |

状态目录默认是 `coverage-state/`，可通过 `STATE_DIR` 覆盖，但只支持新 schema。

## 3. Phase 状态机

Phase 顺序固定为：

```text
bootstrap
scan
api-diff
build
baseline-coverage
after-runtime
report
```

### 3.1 bootstrap

职责：

- 校验 `coverage-state/manifest.json` 是否存在且字段完整。
- 创建 baseline worktree 并安装依赖。
- 校验 after 工作区依赖。
- 定位或构建 skill scripts。
- 初始化 `progress.json`。

### 3.2 scan

职责：

- 用 AST 扫描目标组件包的 JSX call-site。
- 输出 `coverage-targets.json`、`route-checklist.json`、`pages.json`。
- `coverage-targets.json` 是主事实源；`pages.json` 只是人读的 route 聚合视图。

### 3.3 api-diff

职责：

- 对比 baseline 和 after 中目标组件包的 `.d.ts`。
- 输出 `api-diff/dts-diff.md` 和 `api-diff/dts-impact.md`。
- 这些产物服务 Phase build fix 和 Phase after-runtime fix loop。
- 如果目标包无 d.ts 或无法解析，不静默跳过，进入 `needs-decision`。

### 3.4 build

职责：

- 串行或受控并行运行 baseline / after 编译检查。
- 比较 after-only 编译错误。
- 派 subagent 读取日志、查 installed d.ts、做最小修复。
- main agent 读取 artifact 后提交 Phase build 修复。

### 3.5 baseline-coverage

职责：

- 启动 baseline worktree dev server。
- 用 marker + recorder + panel 让用户人工操作 route。
- 这一 phase 不派 subagent。main agent 只负责编排：启动 dev server、启动 `recorder.py`、读取 `runtime-state.json` 和最终 artifacts、更新 `progress.json`。
- 用户交互保持 MVP 形态：`Confirm current route`、`Skip current route`、现有 textarea。
- 后台增强采集 action timeline、target first-seen context、action 级日志索引、screenshot、aria snapshot。
- 不默认录制视频或 trace，避免人工长时间停留导致产物失控。

### 3.6 after-runtime

职责：

- 只验证 Phase baseline-coverage 中已经 confirmed 的 route 和 target。
- Phase baseline-coverage 中 skipped route、uncovered target 不进入 after-runtime，只进入报告。
- 使用 baseline 的 `interaction-context.json` 作为功能上下文参考，不把它当必须逐步照抄的 replay script。
- Phase 3 subagent 可以改变步骤和 selector，只要能证明 baseline confirmed 的功能覆盖点在 after 中仍成立。
- after-only runtime error 可由 subagent 做最小修复；shared component 或跨页面影响进入 `needs-decision`。
- Phase 3 可录 video/trace，用于自动验证失败定位和最终审计。

### 3.7 report

职责：

- 汇总 coverage、api impact、build fixes、runtime errors、visual/aria 证据、skipped routes、uncovered targets、force confirmations、accepted exceptions。
- 输出 `report/summary.md` 和结构化 JSON。

## 4. 本地状态与 Resume

状态本地化是硬要求。main agent 每次激活 skill 的第一步必须运行：

```bash
node $SKILL_DIR/scripts/resume.js --state-dir coverage-state
```

`resume.js` 负责：

- 读取 `progress.json`。
- reconcile artifact 与 progress。
- 修复或标记 stale/running 状态。
- 打印下一步行动、原因、建议命令。

main agent 不凭聊天上下文决定下一步。

### 4.1 目录结构

```text
coverage-state/
├── manifest.json
├── progress.json
├── progress.json.bak
├── progress.scan.snapshot.json
├── progress.api-diff.snapshot.json
├── progress.build.snapshot.json
├── progress.baseline-coverage.snapshot.json
├── progress.after-runtime.snapshot.json
├── runtime-state.json
├── coverage-targets.json
├── route-checklist.json
├── pages.json
├── api-diff/
│   ├── dts-diff.md
│   └── dts-impact.md
├── build/
│   ├── baseline/tsc.log
│   ├── baseline/build.log
│   ├── after/tsc.log
│   ├── after/build.log
│   ├── build-fixes.md
│   └── needs-decision.md
├── runs/
│   ├── baseline-<version>/
│   │   ├── meta.json
│   │   ├── status.json
│   │   └── routes/<route-id>/
│   │       ├── coverage.json
│   │       ├── interaction-context.json
│   │       ├── console.json
│   │       ├── network.json
│   │       ├── errors.json
│   │       ├── screenshots/
│   │       └── aria-snapshots/
│   └── after-<version>/
│       ├── meta.json
│       ├── status.json
│       └── routes/<route-id>/
│           ├── initial/
│           ├── final/
│           ├── fixes.json
│           └── result.json
└── report/
    ├── summary.md
    ├── coverage-summary.json
    ├── runtime-diff.json
    ├── api-impact.json
    └── visual/
```

### 4.2 progress.json

`progress.json` 是唯一流程状态源。phase 和 item 状态都必须写入其中，并包含显式 resume 指令。

```json
{
  "schemaVersion": 1,
  "currentPhase": "baseline-coverage",
  "phases": {
    "scan": { "status": "done" },
    "api-diff": { "status": "done" },
    "build": { "status": "done" },
    "baseline-coverage": { "status": "running" },
    "after-runtime": { "status": "pending" },
    "report": { "status": "pending" }
  },
  "items": {
    "baselineCoverage": {
      "routes": {
        "paper-edit-id": {
          "status": "running",
          "resumeAction": "restart-recorder-at-route",
          "routePath": "/paper/edit/:id"
        }
      }
    },
    "afterRuntime": {
      "routes": {}
    }
  },
  "resume": {
    "nextAction": "restart-recorder-at-route",
    "phase": "baseline-coverage",
    "itemId": "paper-edit-id",
    "reason": "route status is running and recorder heartbeat is stale",
    "command": "STATE_DIR=coverage-state python3 $SKILL_DIR/scripts/recorder.py --route paper-edit-id"
  },
  "lastUpdate": "2026-04-30T00:00:00Z"
}
```

### 4.3 Atomic Write

这些文件必须原子写：

- `progress.json`
- `runtime-state.json`
- `coverage.json`
- `interaction-context.json`
- `result.json`
- `fixes.json`
- phase summary JSON

写入模式：

```text
write .tmp -> fsync -> rename old to .bak -> rename .tmp to current
```

### 4.4 Reconcile 规则

恢复时不能盲信 `progress.json`。`resume.js` 必须检查 artifact：

- `scan` done 但缺 `coverage-targets.json` 或 `route-checklist.json`：回退 scan 为 pending。
- route done 但缺 `coverage.json`：回退该 route 为 pending。
- baseline route running 且 `runtime-state.json` heartbeat 超时：标 stale，并建议重启 recorder。
- after route running 且 `.scratch-*` 存在：归档或删除 scratch，不作为正式结果。
- `fixes.json` 有修复但 `result.json.commit` 为空：提示 main agent 先提交并回填 commit。
- phase done 时写 `progress.<phase>.snapshot.json`。

## 5. Phase baseline-coverage 详细设计

### 5.1 用户交互

默认用户操作不变：

1. recorder 打开业务页和 panel。
2. 用户在业务页正常操作，让目标组件出现。
3. panel 显示累计 seen targets 和 remaining targets。
4. 用户点击 `Confirm current route`。
5. 或用户点击 `Skip current route` 并填写原因。
6. recorder 进入下一 route。

现有 textarea 语义调整为通用 `routeNote`：

- confirm 且无 remaining：保存为 `operatorNote`。
- confirm 且有 remaining：保存为 `forceConfirmReason`。
- skip：保存为 `skipReason`。

不新增必需操作。后台增强采集，不强迫用户按 target 或功能点逐个确认。

### 5.2 route_seen 与 target context

现有 MVP 已经用 route 级 union 保留过程性 target。完整 skill 保留这个语义：

- `window.__coverageMark__` 当前 Set 只表示活跃 marker。
- recorder 周期性读取 marker。
- `routeSeenTargetIds = routeSeenTargetIds ∪ currentMarks`。
- target 出现后即使卸载，也不会从 route seen 中丢失。

新增的是给每个 target 记录首次出现上下文：

```json
{
  "targetId": "src/pages/Paper/Edit.tsx#ModalForm#L88",
  "firstSeenActionId": "a005",
  "firstSeenUrl": "https://example.com/paper/edit/123",
  "firstSeenAtMs": 8420,
  "screenshot": "screenshots/a005.png",
  "ariaSnapshot": "aria-snapshots/a005.yml",
  "consoleEventIds": [],
  "networkEventIds": ["n044"],
  "pageErrorIds": []
}
```

### 5.3 Action Timeline

recorder 在业务页注入轻量 listener，记录用户 action：

- click
- input/change
- select
- non-sensitive keydown，如 Enter、Escape、Arrow
- navigation
- idle marker

每个 action 记录 selector candidates，而不是单一 selector：

```json
{
  "actionId": "a004",
  "type": "click",
  "startedAtMs": 8400,
  "endedAtMs": 9100,
  "urlBefore": "https://example.com/paper/edit/123",
  "urlAfter": "https://example.com/paper/edit/123?tab=config",
  "selectorCandidates": [
    "role=tab[name='配置']",
    "text=配置",
    "[data-testid='config-tab']",
    "css=.ant-tabs-tab:nth-child(2)"
  ],
  "targetSnapshot": {
    "tag": "DIV",
    "text": "配置",
    "role": "tab",
    "ariaLabel": null,
    "testId": null
  },
  "detectedTargetIdsAfter": ["src/pages/Paper/Edit.tsx#LayoutTable#L131"],
  "consoleEventIds": ["c012"],
  "networkEventIds": ["n044", "n045"],
  "pageErrorIds": []
}
```

### 5.4 Session Logs 与 Action 索引

保留 session 级全量日志：

- `console.json`
- `network.json`
- `errors.json`

action 只引用事件 id。原因：

- action 归属是派生关系，可能漏归。
- 首屏加载、轮询、异步刷新不属于用户 action。
- Phase report 需要 route/session 总览。
- 后续可以用全量日志重新生成 action 关联。

### 5.5 interaction-context.json

`interaction-context.json` 是 Phase after-runtime 的上下文包，不是硬 replay script。

```json
{
  "routeId": "paper-edit-id",
  "entry": {
    "startUrl": "https://example.com/paper/edit/123",
    "routeParams": { "id": "123" },
    "query": {},
    "preconditions": ["logged-in-profile", "existing-paper-id"]
  },
  "actions": [],
  "targetContexts": {},
  "operatorNote": "optional note from routeNote",
  "environmentHints": {
    "viewport": { "width": 1440, "height": 900 },
    "networkEndpoints": ["/api/paper/detail", "/api/question/list"],
    "storageKeys": ["token", "locale"]
  }
}
```

## 6. Phase after-runtime 详细设计

### 6.1 输入计划

Phase after-runtime 不直接使用全量 `route-checklist.json`。先运行：

```bash
node $SKILL_DIR/scripts/plan-after-runtime.js --state-dir coverage-state
```

它读取 baseline 产物，输出 `after-runtime-plan.json`：

```json
{
  "routes": [
    {
      "routeId": "paper-edit-id",
      "expectedTargetIds": ["src/pages/Paper/Edit.tsx#ModalForm#L88"],
      "baselineEvidenceDir": "runs/baseline-1.1.42/routes/paper-edit-id",
      "interactionContextPath": "runs/baseline-1.1.42/routes/paper-edit-id/interaction-context.json"
    }
  ],
  "excluded": {
    "skippedRoutes": ["hidden-course"],
    "uncoveredTargetIds": ["src/pages/X.tsx#CURD#L42"],
    "forcedOnlyTargetIds": []
  }
}
```

### 6.2 验证语义

Phase after-runtime 的验收目标不是机械 replay baseline steps，而是证明 baseline confirmed 的功能覆盖点在 after 中仍成立。

一个 confirmed target 的 after 状态可以是：

- `passed`：同一个 target id 再次 marker 命中，功能语义可达，无 after-only blocking runtime error。
- `failed`：target 未再次命中，或功能语义不可达，或存在 blocking runtime error。
- `needs-decision`：UI/源码结构变化导致无法自动判断，例如 target id 改变但功能疑似仍存在。
- `accepted-exception`：人工接受例外。

底层 evidence 拆开记录，避免一个模糊状态掩盖事实：

```json
{
  "targetId": "src/pages/Paper/Edit.tsx#ModalForm#L88",
  "status": "passed",
  "evidence": {
    "targetDetected": true,
    "functionalIntentCompleted": true,
    "blockingRuntimeErrors": [],
    "ariaSnapshotPath": "final/aria-snapshots/a005.yml",
    "screenshotPath": "final/screenshots/a005.png"
  }
}
```

### 6.3 Subagent 权限

Phase after-runtime subagent 可以：

- 读取 `interaction-context.json`，理解 baseline 功能路径。
- 优先尝试 baseline selector candidates。
- UI 改变时换路径，只要达成相同功能覆盖目标。
- 修复 after-only runtime errors。
- 记录新的 actual interaction summary。

Phase after-runtime subagent 不可以：

- 修改 baseline worktree。
- 更新 `progress.json`。
- 提交 commit。
- 修改 package.json/yarn.lock 或降级目标组件包。
- 擅自修改 shared component 或跨 route 行为；这类情况进入 `needs-decision`。

### 6.4 产物

```text
runs/after-<version>/routes/<route-id>/
├── initial/
│   ├── coverage.json
│   ├── claims.json
│   ├── console.json
│   ├── network.json
│   ├── errors.json
│   ├── screenshots/
│   └── aria-snapshots/
├── final/
│   ├── coverage.json
│   ├── claims.json
│   ├── console.json
│   ├── network.json
│   ├── errors.json
│   ├── trace.zip
│   ├── video.webm
│   ├── screenshots/
│   └── aria-snapshots/
├── fixes.json
└── result.json
```

Phase 3 可以录 video/trace，因为它是 agent 自动执行，时间可控，失败定位价值高。Phase 2 默认不录。

## 7. 通过标准

完整 workflow 通过标准：

- `scan`：`coverage-targets.json`、`route-checklist.json`、`pages.json` 都生成且 reconcile 通过。
- `api-diff`：`dts-diff.md`、`dts-impact.md` 生成；无法解析时进入 `needs-decision`。
- `build`：after-only 编译错误已修复，或写入 `needs-decision.md` 等待人工。
- `baseline-coverage`：所有 checklist route 都是 `confirmed` 或 `skipped`；未覆盖 target 进入报告，不阻塞。
- `after-runtime`：只验证 baseline confirmed targets/routes；每个 confirmed target 必须 `passed` 或有 `accepted-exception`。
- `report`：生成 `report/summary.md` 和结构化 JSON，明确列出 skipped routes、uncovered targets、forced confirmations、accepted exceptions、after failures。

核心原则：

> Phase baseline-coverage 未确认过的东西，Phase after-runtime 不补考；Phase baseline-coverage 确认过的 target，Phase after-runtime 必须通过或显式例外。

## 8. Checkpoints

workflow 必须暂停并让用户确认的点：

- `scan` 完成后：用户检查 target 和 route checklist 是否合理。
- `build` 出现无法自动修复的 after-only compile errors。
- `baseline-coverage` 完成后：用户检查 skipped/forced/uncovered 是否可接受。
- `after-runtime` 出现 `needs-decision`。
- `report` 生成后：用户审阅最终结果。

## 9. 非目标

本设计不包含：

- 兼容或迁移旧 `e2e-xui-pro/`。
- Phase 2 默认录制视频或 trace。
- 对 Phase 2 未覆盖 target 在 Phase 3 自动补测。
- 用截图像素 diff 作为唯一自动判断依据。
- 用外部文档或训练记忆作为组件 API 权威来源；API 判断以 installed d.ts 为准。
