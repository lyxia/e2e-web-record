# 组件升级覆盖采集器 MVP 设计

> 创建日期：2026-04-30
> 范围：Phase 0 + 0.5 + 2，MVP

## 0. 前置上下文（实现前必读）

新 session 开始拆计划/写代码前，按顺序读以下文件，把本设计中刻意省略的硬上下文（manifest schema、page-id 规则、craco 现状、路由结构、依赖版本等）补全：

### 0.1 原 skill 参考实现

```
/Users/liuyunxia/Documents/EOI_FE/xdragon-subsystem-smart-trains-scepter/.agents/skills/xui-pro-upgrade-regression/
├── SKILL.md             ← phase 状态机、resume 协议、原子写约定、subagent 边界
├── state-schema.md      ← manifest.json / progress.json / pages.json / result.json 完整 schema；page-id 推导规则
└── subagent-prompts.md  ← 现有 scan.js 算法描述（Phase 0 升级时参考其路由解析与 import graph 逻辑）
```

读它们的目的：本设计中所有"沿用现有"、"对齐现有 schema"的地方，权威定义都在这两个文件里。

### 0.2 demo 项目（验证落地的目标项目）

```
/Users/liuyunxia/Documents/odc_workspace/scepter-smart-trains-xui-pro-update/xdragon-subsystem-smart-trains-scepter/
├── package.json              ← 技术栈版本（React 17 / TypeScript / craco / 目标包当前版本）
├── craco.config.js           ← 当前 babel/plugins 配置，新 babel 插件要在这里挂
├── tsconfig.json             ← TS 编译配置
└── src/router/routers/       ← 路由配置文件（必读任一示例，了解格式以写 AST 路由解析）
```

读它们的目的：知道往哪个项目里挂插件、按什么格式解析路由、依赖什么版本。

### 0.3 状态目录占位符

本文档使用 `<state-dir>/` 作为状态目录占位符。**实际路径以 manifest.json 所在目录为准**——原 skill 用的是 demo 项目根下的 `e2e-xui-pro/`，新 skill 落地时若延续此名直接复用即可，命名变更需同步更新原 skill 的 SKILL.md。

### 0.4 必备本地工具

实现前确认本机已有：

- Node.js（craco 已支持的版本）
- yarn（demo 项目用的包管理器）
- Python 3.10+
- 本机已安装的 **playwright-cli**（与原 skill 一致）+ Python Playwright 库

### 0.5 查阅与冲突优先级

实现时遇到不清楚的：

| 不清楚的内容 | 查阅来源 |
|---|---|
| **怎么实现 / 技术问题**（脚本结构、Playwright 用法、登录态、原子写、错误处理等） | 0.1 原 skill 实际代码与 SKILL.md |
| **人机交互细节**（面板字段、确认按钮逻辑、用户操作流） | `file:///Users/liuyunxia/Documents/EOI_FE/xdragon-subsystem-smart-trains-scepter/e2e-xui-pro/component-upgrade-coverage-recorder-requirements.md` |
| **架构 / 产物 schema / 目录布局 / Phase 编排** | 本设计文档 |

**冲突时以本设计文档为准**——它是最新决策结果，与需求文档或原 skill 不一致的地方代表已经讨论后做了变更，不要回退到旧约定。

### 0.6 Playwright 与登录态

使用 **playwright-cli + Python Playwright 库**（与原 skill 一致）。

登录态沿用原 skill 的方案：`launch_persistent_context(user_data_dir=manifest.runtime.playwrightProfile)` 持久化 profile——首次运行 headed 模式让用户手动登录、profile 落盘后续运行复用。MVP 阶段**不重新发明登录管理**，直接复用原 skill 的 profile 路径与流程（具体见原 SKILL.md 的 Phase 2 "Login bootstrap" 段落）。

---

## 1. 背景与 MVP 边界

### 1.1 解决什么问题

组件库升级时，按路由跑批截图存在两个核心缺陷：

1. **同一个组件在多个源码位置使用**——人工复核截图时无法判断"当前看到的组件来自哪个源码文件、哪一行"
2. **弹窗类组件不在路由初始 DOM 里**——按路由自动跑批漏掉这部分覆盖

本采集器以"**源码使用点**"作为覆盖单位（不是路由、不是路径），通过 AST 静态扫描 + 运行时 marker + 人工确认三段式工作流，让每个目标组件包的 JSX 使用点都获得带源码身份的截图证据。它是组件升级回归 skill 的子环节，**只覆盖 Phase 0 / 0.5 / 2**。Phase 1 / 3 / 4 沿用现有实现，不在本文档展开。

### 1.2 MVP 包含

| 项 | 理由 |
|---|---|
| AST 扫描 → `coverage-targets.json` + `route-checklist.json` | recorder 的输入 |
| babel 插件 + `__CoverageMark` wrapper | marker 通道根基 |
| recorder.py 启动 Playwright + 业务 page + 面板 page | 进程骨架 |
| 200ms 主循环同步 marker → 面板 | 实时交互核心 |
| 面板显示 detected / remaining + 确认按钮 | 用户操作出口 |
| 点击确认 → 截图 + 写 `coverage.json` | 闭环证据落盘 |
| 强制确认 + 原因 | 允许业务不可达的少量目标保留审计原因后完成 route |
| 跳过 route + 原因 | 允许菜单未配置/业务不可达 route 保留原因后跳过 |

### 1.3 MVP 推迟（V0.2+）

| 推迟项 | 推迟理由 |
|---|---|
| 录制 `spec.py` + `selectors.json` | 服务 Phase 3 重放，MVP 不含 Phase 3 |
| console / network / errors / trace 采集 | 服务 Phase 3 fix loop |
| `coverage-report.md` 自动生成 | 先看 `coverage-targets.json` 状态字段 |
| 中断后自动续跑 | 当前状态文件可读，但 recorder 重启仍从 checklist 开始 |
| 面板 UI 美化 | 文字列表 + reason 输入框足够 |
| query/variant 路由建模 | 当前 route 聚合以 path 为主，query-only 场景通过强制确认原因审计 |

---

## 2. 架构总览

### 2.1 三角色 + 进程模型

```
main agent (Claude Code 会话)        ← 用户随时能问问题的入口
  │
  │ Bash run_in_background:
  │ COVERAGE_MODE=1 python <skill>/scripts/recorder.py
  │
  ▼
recorder.py (独立 Python 长跑进程)   ← 不消耗 LLM 上下文
  ├─ 启动 Playwright
  │    ├─ persistent context：业务页面，左侧独立窗口，复用登录 profile
  │    └─ panel browser：面板 HTML，右侧独立窗口
  ├─ 200ms 主循环：page_app 拉 marker → page_panel 推面板
  ├─ 监听面板按钮：截图 / 落 evidence / 自动 goto 下一个 route
  └─ 持续写 <state-dir>/runtime-state.json
```

### 2.2 通信总线

| 链路 | 机制 |
|---|---|
| main agent → recorder.py | Bash `run_in_background` 启动 |
| recorder.py → 业务 page | `page.evaluate(js)` 读 `window.__coverageMark__` |
| recorder.py → 面板 page | `page.evaluate(js)` 推送状态 |
| 面板 page → recorder.py | `page.expose_function('confirmRoute', handler)` 注册 Python 回调 |
| recorder.py → main agent | 文件系统 `runtime-state.json` |

整个 MVP **不需要** HTTP server / WebSocket / SSE，所有跨进程通信靠 Playwright 这一根管道 + 文件系统。

### 2.3 为什么不是 subagent

原 skill 把基准线运行时设计为 subagent，理由是 Playwright 自动跑批的大量日志需要独立上下文。新方案是**人工驱动**——recorder.py 只做机械搬运（拉 marker、推面板、截图、写文件），无 LLM 判断需求。脚本进程天然不进 main session 上下文，日志隔离自然成立。比 subagent 多两点优势：

1. 用户通过面板**实时介入**操作业务（subagent 是黑盒，做不到）
2. main agent 通过 `runtime-state.json` 能读到当前进度——用户切回会话问"下一步去哪"，main agent 读文件即可回答（V0.2 AI 辅助探索的天然落地点）

---

## 3. Phase 编排

### 3.1 调整后的顺序

```
[bootstrap]   现有：worktree + manifest + yarn install
[Phase 0]     ★ 实现升级：regex → 真 AST，输出三份产物
[Phase 0.5]   现有：d.ts diff，本流程不改
[Phase 2]     ★ 替换实现：人工 + recorder 模式
[Phase 1]     现有：编译修复（与 Phase 2 互不依赖，后置不影响功能）
[Phase 3]     现有 + 微调 input：重放 baseline 录制的 spec
[Phase 4]     现有 + schema 略扩
```

**关键调整两条**：

1. `Phase 1` 与 `Phase 2` 顺序对调——人工录制是流程中唯一的人力瓶颈，前置可让用户启动 skill 后立即进入操作环节，自动化任务在用户操作期间或之后跑
2. `Phase 0` 实现升级——一次扫描三份产物，单一事实源

### 3.2 Phase 0.5 衔接

Phase 0.5 沿用现有 `dts-diff.js`，输出 `diff/dts-diff.md` + `diff/dts-impact.md`，本流程不修改其实现。它对 Phase 2 的间接价值：人工操作时可参考 `dts-impact.md` 了解"哪些组件在升级中改了 d.ts"作为风险提示——但这不是 MVP 必须功能，可由 main agent 在用户问"下一步去哪"时主动引用。

---

## 4. Phase 0：静态扫描升级

### 4.1 实现升级：regex → 真 AST

现有 `scan.js` 是 regex-based 实现，只能到组件名级粒度（`pages.json` 的 `components: [...]`）。新需求要到 **JSX 调用点级粒度**——每个 `<Foo />` 的位置（file + line + importedName + localName + alias 关系）。这必须用真 AST 才能判定：

- 区分 JSX 调用 vs 仅在表达式位置出现
- 排除 `React.createElement(Foo)`
- 排除 `<Wrapper component={Foo} />`
- 处理 alias：`import { Foo as Bar } + <Bar />`

实现使用 `typescript` package 的 compiler API。

### 4.2 一次扫描三份产出

```
<state-dir>/
├── pages.json                ← 路由级聚合（schema 不变，向后兼容）
├── coverage-targets.json     ★ 新：每个 JSX 调用点的 file/line
└── route-checklist.json      ★ 新：贪心选出的最少路径
```

三份产物源自同一次 AST 遍历 + 同一份 import graph，不会出现 drift。

### 4.3 JSX 调用点判定

进入 `coverage-targets.json` 必须**全部满足**：

1. 来自配置中 `targetPackages` 的 import
2. 在源码中存在 JSX tag 位置使用（`<X />` 或 `<X></X>`）
3. 不是 `import type { X }` 纯类型导入

不满足的归类到 `type-only / value-only / dynamic-jsx-alias / create-element / component-as-prop`，仅在末尾汇总报告统计，不进 runtime target。

### 4.4 贪心集合覆盖算法

```
U = 所有 runtime targets 的 id 集合
S(route) = 该路由入口文件通过 import graph 可达的 target id 集合

remaining = U
selectedRoutes = []
while remaining 非空:
  选 covers = max |S(route) ∩ remaining| 的 route
  若所有 route 的覆盖都为空: break
  selectedRoutes 加入该 route
  remaining -= S(该 route) 中已覆盖的 targets

剩余的 remaining 标记为 unmapped
selectedRoutes 写入 route-checklist.json
```

---

## 5. Phase 2：Marker 注入

### 5.1 JS runtime 通道

```js
window.__coverageMark__ = new Set([
  "src/pages/X/index.tsx#ComponentA#L42",
  ...
])
```

装的是"当前活着的 React 组件对应的源码使用点 id"，组件挂载时 add，卸载时 delete。

不走 `data-*` DOM 属性的原因：

- 弹窗类组件关闭时不在 DOM 里，但仍是有效"使用点"
- 弹窗使用 portal，`data-*` 可能落不到预期根 DOM
- runtime marker 只回答"命中"，不回答"可见"——JS Set 与这个语义完美对齐

### 5.2 babel 插件 + wrapper

`__CoverageMark` wrapper（约 8 行）：

```jsx
export function __CoverageMark({ id, children }) {
  useEffect(() => {
    (window.__coverageMark__ ??= new Set()).add(id)
    return () => window.__coverageMark__.delete(id)
  }, [])
  return children
}
```

babel 插件在 `COVERAGE_MODE=1` 时把每个目标包 JSX 调用点用 wrapper 包一层：

```jsx
// 改写前
<Foo prop={x} />

// 改写后
<__CoverageMark id="src/.../X.tsx#Foo#L42">
  <Foo prop={x} />
</__CoverageMark>
```

源码磁盘**零改动**，只在 webpack 内存里改写 AST。生产构建（`COVERAGE_MODE` 未设）插件不启用，对线上完全透明。

### 5.3 craco.config.js 接入

```js
module.exports = {
  babel: {
    plugins: [
      ...(process.env.COVERAGE_MODE === '1'
        ? [require.resolve('./.agents/skills/<skill-name>/scripts/babel-plugin-coverage-marker')]
        : []),
    ],
  },
}
```

启动业务 dev server：

```bash
COVERAGE_MODE=1 BROWSER=none yarn start
```

---

## 6. Phase 2：Recorder + 面板

### 6.1 启动顺序

```python
manifest  = read_manifest()
targets   = read_coverage_targets()
checklist = read_route_checklist()

browser = await playwright.chromium.launch_persistent_context(
    user_data_dir=manifest['playwrightProfile'],
    headless=False,
    proxy={'server': manifest['proxy']},
    args=['--ignore-certificate-errors'],
)

page_app   = await browser.new_page()
page_panel = await browser.new_page()

await page_panel.expose_function('confirmRoute', on_confirm)
await page_panel.expose_function('skipRoute', on_skip)
await page_panel.goto(f"file://{panel_html_path}")
await page_app.goto(checklist[0]['url'])

while not all_confirmed:
    marks = read_marks_from_page_and_frames(page_app)
    state = compute_panel_state(marks, confirmed_set, current_route)
    await page_panel.evaluate("(s) => window.updatePanel(s)", state)
    write_runtime_state(state)
    await asyncio.sleep(0.2)
```

### 6.2 面板字段（MVP 子集）

```
Summary
  Runtime targets: 61
  Confirmed: 12
  Current detected: 3
  Remaining: 49

Route Checklist
  [ ] /xxx     未处理
  [x] /yyy     已人工确认（包含强制确认）
  [-] /zzz     已人工跳过

Current Detected
  - ComponentA src/.../X.tsx:42

Remaining (current route)
  - ComponentB src/.../Y.tsx:88

[reason textarea]              ← 强制确认或跳过时必填

[Confirm current route] [Skip current route]
```

### 6.3 确认按钮回调

```python
async def on_confirm(reason=None):
    await page_app.screenshot(
        path=evidence_dir / 'screenshot.png',
        full_page=True,
    )

    detected = route_seen_target_ids
    confirmed = route_confirmed_target_ids(current_route, detected)
    remaining = [id for id in current_route['targetIds'] if id not in confirmed]

    write_json(evidence_dir / 'coverage.json', {
        'evidenceId': f'baseline-{nth}',
        'createdAt': iso_now(),
        'url': page_app.url,
        'routeId': current_route_id,
        'detectedTargetIds': detected,
        'confirmedTargetIds': confirmed,
        'remainingTargetIds': remaining,
        'forceConfirmReason': reason,
        'screenshot': 'screenshot.png',
        'reviewStatus': 'visual-ok' if not remaining else 'force-confirmed',
    })

    mark_targets_confirmed(detected, evidence_id)

    next_route = pick_next_uncovered_route()
    if next_route:
        await page_app.goto(next_route['url'])
    else:
        await mark_recorder_done()
```

`Skip current route` 不生成 screenshot/coverage evidence；它写入 `runtime-state.json` 的 `skippedRouteIds` 与 `skippedRouteReasons`，用于人工审计不可达 route。

---

## 7. 产物 schema（MVP 子集）

> 注：下文 `<state-dir>/` 是中性占位符，指代采集器状态目录，对应原 skill 中现有的状态目录路径，最终具体名字由 skill 主体决定。

### 7.1 全局产物布局

```
<state-dir>/
├── pages.json                      Phase 0 路由级（不变）
├── coverage-targets.json           ★ 见 7.2
├── route-checklist.json            ★ 见 7.3
├── runtime-state.json              ★ recorder 持续更新
└── runs/baseline-<version>/
    └── pages/<page-id>/
        ├── screenshot.png
        └── coverage.json           ★ 见 7.4
```

### 7.2 coverage-targets.json

```json
{
  "schemaVersion": 1,
  "scannedAt": "ISO-8601",
  "targets": [
    {
      "targetId": "src/pages/X/index.tsx#ComponentA#L42",
      "packageName": "<目标包名，从 manifest.library 读>",
      "importedName": "ComponentA",
      "localName": "ComponentA",
      "file": "src/pages/X/index.tsx",
      "line": 42,
      "kind": "runtime-jsx",
      "routeCandidates": [
        { "routeId": "...", "path": "/xxx", "url": "https://..." }
      ],
      "status": "undetected",
      "confirmedEvidenceId": null
    }
  ]
}
```

`coverage-targets.json` 是静态扫描产物，不在交互过程中原地改写状态；运行态确认/跳过信息以 `runtime-state.json` 和 per-route `coverage.json` 为准。

### 7.3 route-checklist.json

```json
{
  "schemaVersion": 1,
  "selectedRoutes": [
    {
      "routeId": "...",
      "path": "/xxx",
      "url": "https://...",
      "targetIds": ["...", "..."],
      "confirmedCount": 0,
      "targetCount": 5
    }
  ],
  "unmappedTargetIds": []
}
```

### 7.4 per-page coverage.json

```json
{
  "evidenceId": "baseline-001",
  "createdAt": "ISO-8601",
  "url": "https://...",
  "routeId": "...",
  "detectedTargetIds": ["..."],
  "confirmedTargetIds": ["..."],
  "remainingTargetIds": ["..."],
  "forceConfirmReason": null,
  "screenshot": "screenshot.png",
  "reviewStatus": "visual-ok"
}
```

`reviewStatus` 取值：

- `visual-ok`：当前 route 所有 target 均触达并人工确认
- `force-confirmed`：仍有 remaining target，但用户填写原因后强制确认

### 7.5 runtime-state.json（最小字段）

```json
{
  "schemaVersion": 1,
  "phase": "baseline",
  "currentRouteId": "...",
  "currentUrl": "https://...",
  "detectedTargetIds": ["..."],
  "currentRouteRemaining": ["..."],
  "totalRuntimeTargets": 61,
  "confirmedTotal": 12,
  "remainingRoutesCount": 8,
  "confirmedRouteIds": ["..."],
  "skippedRouteIds": ["..."],
  "skippedRouteReasons": {
    "route-id": "菜单未配置，不可达"
  },
  "panelState": {
    "routeChecklist": [
      {
        "path": "/xxx",
        "confirmedCount": 1,
        "targetCount": 2,
        "confirmed": true,
        "skipped": false
      }
    ]
  },
  "lastUpdate": "ISO-8601"
}
```

main agent 任何时候 `cat <state-dir>/runtime-state.json` 即可知实时进度，回答用户"下一步去哪"。

---

## 8. 目录结构

```
.agents/skills/<skill-name>/
├── SKILL.md                              skill 入口
└── scripts/
    ├── scan.js                           ★ Phase 0 真 AST 扫描
    ├── recorder.py                       ★ Phase 2 主控
    ├── babel-plugin-coverage-marker/
    │   ├── index.js                      ★ babel 插件主体
    │   └── runtime.js                    ★ __CoverageMark wrapper
    └── panel/
        ├── index.html                    ★ 面板入口
        └── main.tsx                      ★ 面板 React
```

> Phase 1 / 3 / 4 相关脚本（`dts-diff.js`、`diff-report.js`、`subagent-prompts.md`、`state-schema.md` 等）不在 MVP 范围，需要时再补。

demo 项目侧接入：

```
<demo-project>/
└── craco.config.js   ← 增加 COVERAGE_MODE 条件加载 babel 插件
```

---

## 附录：MVP 验收标准

完成以下端到端流程即视为 MVP 通过：

1. 配置 `targetPackages` 后跑 Phase 0：生成三份产物自洽
2. main agent 调起 recorder.py（`COVERAGE_MODE=1`）
3. 浏览器开两个 page，业务页面正常加载，面板显示首个待复核 route
4. 在业务页面点击若干按钮，面板的 `Current Detected` 列表 200ms 内变化
5. 启动 recorder 前已经通过 Console 验证 `window.__coverageMark__` 至少返回一个当前 route 实际触发的 target id
6. Remaining 为空时可直接确认；Remaining 非空时填写原因后可强制确认；业务不可达 route 填写原因后可跳过
7. 点击确认 → 截图保存到 `runs/baseline-<v>/pages/<id>/screenshot.png`，`coverage.json` 写盘，业务 page 自动 goto 下一个 route
8. 点击跳过 → `runtime-state.json` 写入 `skippedRouteIds` / `skippedRouteReasons`，业务 page 自动 goto 下一个 route
9. 全部 route 处理完成 → recorder.py 退出，main agent 读 `runtime-state.json` 确认 `done`

完成此清单后再展开 V0.2（coverage-report.md / spec 录制 / selectors / console 采集 / query variant 建模）。
