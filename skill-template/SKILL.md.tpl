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
        ? [[require.resolve('@odc/coverage-marker'), { targetPackages: __coverageTargets }]]
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

# 3. 起 recorder（自动开两窗口：业务页 + 面板）
python3 $SKILL_DIR/scripts/recorder.py
```

## Resume 协议

读 `<state-dir>/runtime-state.json`：缺失 → Phase 0；`phase != done` → 按 `currentRoutePath` 续跑（重启业务页即可）。

## 推迟到 V0.2+

spec 录制 / selectors / console 采集 / 标记不可达 / coverage-report.md / 中断恢复 / 面板 UI 美化。
