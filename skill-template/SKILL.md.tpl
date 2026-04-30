---
name: react-component-upgrade
description: Use when running, resuming, or auditing a component-library upgrade that needs JSX-call-site coverage evidence. Triggered by mentions of "组件升级覆盖", "升级回归覆盖", "coverage recorder". Drives a Phase 0 + Phase 2 workflow with file-based state for resume.
---

# React Component Upgrade Coverage Recorder

完整设计见 `docs/plans/2026-04-30-component-upgrade-coverage-recorder-design.md`。

## 前置依赖（在目标前端仓库执行）

```bash
yarn add -D @odc/coverage-marker@^{{coverageMarkerVersion}}
pip install playwright pytest
playwright install chromium
```

## manifest.json 必填字段

`<state-dir>/manifest.json`：

```json
{
  "baseUrl": "http://127.0.0.1:3033",
  "baseline": { "version": "<目标包当前版本>" },
  "runtime": {
    "targetPackages": ["<your-component-package>"],
    "playwrightProfile": "/absolute/path/to/playwright-profile",
    "proxy": null
  }
}
```

`targetPackages` 必须为非空数组，babel-plugin / scan / craco loader 三处都从此读取。

### 代理配置

`baseUrl` 是 recorder 在浏览器里打开的业务 URL 前缀，应填写用户真实访问的域名和路径前缀，不要因为本地 dev server 在 `127.0.0.1` 就改成本地地址。

`runtime.proxy` 是 Playwright 启动 Chromium 时使用的代理地址；如果业务域名需要通过 whistle/Charles/公司代理映射到本地 dev server，就填代理服务地址，例如：

```json
{
  "baseUrl": "https://scepter-sit-eu.x-peng.com/main/smart-trains",
  "runtime": {
    "proxy": "http://127.0.0.1:8899"
  }
}
```

对应的 whistle 规则负责把业务资源映射到本地，例如把 `https://scepter-sit-eu.x-peng.com/microApp/...` 转到 `http://127.0.0.1:3033`。验证标准是：recorder 左侧业务窗口地址栏仍是业务域名，页面内容来自本地 dev server，并且 `window.__coverageMark__` 能返回当前路由触发的 target id。

## craco.config.js 接入

```js
const fs = require('fs');
const path = require('path');

function loadCoverageTargetPackages() {
  if (process.env.COVERAGE_MODE !== '1') return null;
  const stateDir = process.env.STATE_DIR || 'coverage-state';
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, stateDir, 'manifest.json'), 'utf8'));
  const pkgs = manifest && manifest.runtime && manifest.runtime.targetPackages;
  if (!Array.isArray(pkgs) || pkgs.length === 0) {
    throw new Error('manifest.runtime.targetPackages 必须为非空数组');
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

## 工作流

```bash
# 1. 静态扫描
node $SKILL_DIR/scripts/scan.js

# 2. 起 dev server（COVERAGE_MODE 触发 babel 插件）
COVERAGE_MODE=1 BROWSER=none yarn start
```

## 进入 recorder 前的强制验证

启动 recorder 前，必须验证 `@odc/coverage-marker` 已在业务页运行时生效。不要只凭 scan 有目标就继续。

验证方式：在浏览器访问一个待测路由，操作页面直到能看到至少一个目标组件，然后在业务页 Console 执行：

```js
Array.from(window.__coverageMark__ || [])
```

通过标准：返回数组里至少有一个当前路由实际触发的 target id，且 id 能对应到 `<state-dir>/coverage-targets.json` 里的目标。

失败标准：返回空数组，或只有与当前操作无关的目标。此时必须先修复 `@odc/coverage-marker` 注入问题，再进入 recorder；否则右侧面板无法可靠检测组件触达。

```bash
# 3. 起 recorder（自动开两个独立窗口：左业务页 + 右面板）
python3 $SKILL_DIR/scripts/recorder.py
```

recorder 不会把业务页放进 iframe，也不会改业务 DOM。业务页是 top-level 页面；panel 是独立 Chromium 窗口，默认排在业务窗口右侧。确认路由时保存业务页 full-page 截图。

## Resume 协议

读 `<state-dir>/runtime-state.json`：缺失 → Phase 0；`phase != done` → 按 `currentRoutePath` 续跑（重启业务页即可）。

## 推迟到 V0.2+

spec 录制 / selectors / console 采集 / 标记不可达 / coverage-report.md / 中断恢复 / 面板 UI 美化。
