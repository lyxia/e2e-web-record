# React Component Upgrade Coverage Recorder 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 按设计文档 `docs/plans/2026-04-30-component-upgrade-coverage-recorder-design.md` 落地 Phase 0/0.5/2 的 MVP 采集器。本次以**独立 monorepo + 单 npm 包 + 可分发 skill**形态产出，不再把代码内嵌在 demo 仓库的 `.agents/skills/` 下。

**架构：** 开发与分发解耦——开发态用 monorepo 工程化各子项目，构建脚本生成单 skill 目录用于分发。前端项目集成的只有一个 npm 包 `@your-org/coverage-marker`（babel 插件 + runtime）；其余（scan / recorder / panel）以预构建产物形式注入 skill 的 `scripts/`。

**技术栈：**
- monorepo：yarn workspaces（Node 16）
- npm 包：TypeScript + tsup
- scan：TypeScript + esbuild bundle（含 typescript 编译器 API 静态打入）
- panel：React 17 + Vite（构建产物注入 skill）
- recorder：Python 3.10+ + Playwright + pytest
- 测试：jest（TS）+ pytest（Python）

---

## 0. 实现前必读

### 0.1 设计文档（最高权威）

```
docs/plans/2026-04-30-component-upgrade-coverage-recorder-design.md
```

冲突时以设计文档为准。本计划与之不一致处代表执行节奏调整，但范围、产物 schema、阶段编排回归设计文档。

### 0.2 原 skill 参考实现

```
/Users/liuyunxia/Documents/EOI_FE/xdragon-subsystem-smart-trains-scepter/.agents/skills/xui-pro-upgrade-regression/
├── SKILL.md             ← phase 状态机、resume 协议、原子写约定
├── state-schema.md      ← manifest.json / pages.json schema、page-id 推导规则
├── subagent-prompts.md  ← 现有 scan.js 算法描述（路由解析与 import graph）
└── scripts/scan.js      ← 现有 regex 实现，参考路由解析与回溯算法
```

新工程**重写**这套逻辑（regex → 真 AST），算法骨架可参考原实现。

### 0.3 demo 项目（落地验证目标）

```
xdragon-subsystem-smart-trains-scepter/    ← 现有 demo，独立 git 仓库（branch: develop）
├── package.json              ← React 17 / TypeScript 4.6 / craco 6
├── craco.config.js           ← 当前 babel/plugins 配置；新插件挂在 babel.plugins
└── src/router/routers/       ← 路由配置：lazy(() => import('@/pages/...'))
```

### 0.4 路径与命名占位

| 占位 | 含义 | 默认值 / 示例 |
|---|---|---|
| `<repo>` | 新建的 monorepo 根目录 | 建议 `~/Documents/odc_workspace/component-upgrade-coverage-recorder/`（独立 git） |
| `<demo>` | 测试落地的前端项目根 | `~/Documents/odc_workspace/scepter-smart-trains-xui-pro-update/xdragon-subsystem-smart-trains-scepter/` |
| `<state-dir>` | 状态目录 | `<demo>/coverage-state/`（默认值），可通过 `STATE_DIR` 环境变量覆盖 |
| `@your-org` | npm scope 占位 | 实际发布前替换为团队 scope，如 `@xdragon` |

### 0.5 必备工具

- Node 16.18.1（与 demo volta 锁定一致）
- yarn 1.x
- Python 3.10+
- 本机已安装 playwright-cli + 浏览器（`pip install playwright && playwright install chromium`）
- pytest（执行 Python 测试用，`pip install pytest`，不进 pyproject）

### 0.6 强约束

1. **demo 源码零改动。** 唯一对 demo 仓库的改动是 `craco.config.js` 增加 `COVERAGE_MODE` 条件块（约 15 行）和 `package.json` 的一个 devDep。
2. **生产构建透明。** `COVERAGE_MODE` 未设时 babel 插件不挂载、runtime 不 import。
3. **不硬编码组件包名。** `targetPackages` 唯一权威来源是 `manifest.json` 的 `runtime.targetPackages`。babel-plugin / scan / craco loader 三处都从此读取。
4. **react / @babel/core 走 peerDeps。** 不在 npm 包里 bundle 进自己的 react，避免宿主双副本。
5. **TDD 优先。** TS / Python 纯函数任务先写失败测试再实现；浏览器/进程集成类任务靠 §6.5 端到端冒烟兜底。
6. **每个 Task 通过即 commit。** 在 `<repo>` 内提交。demo 仓库的改动单独成 commit。

---

## 1. Phase 0 — Monorepo Bootstrap

### Task 1.1：创建独立仓库 + workspaces 骨架

**Files:**
- Create: `<repo>/package.json`
- Create: `<repo>/.gitignore`
- Create: `<repo>/README.md`
- Create: `<repo>/tsconfig.base.json`

**Step 1：初始化 git**

```bash
mkdir -p <repo> && cd <repo>
git init -b main
```

**Step 2：写根 package.json**

```json
{
  "name": "component-upgrade-coverage-recorder",
  "private": true,
  "workspaces": ["packages/*", "scan", "panel"],
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

**Step 3：写 .gitignore**

```
node_modules
dist
coverage-state
recorder/.venv
__pycache__
*.pyc
.DS_Store
```

**Step 4：写 tsconfig.base.json（被各 sub-project extends）**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

**Step 5：commit**

```bash
git -C <repo> add . && git -C <repo> commit -m "chore: bootstrap monorepo with yarn workspaces"
```

---

### Task 1.2：skill template 占位

**Files:**
- Create: `<repo>/skill-template/SKILL.md.tpl`

**Step 1：写模板（构建脚本会渲染并替换 `{{coverageMarkerVersion}}`）**

> 注意：下方外层用 4 个反引号围栏，模板内部含 ```bash / ```json / ```js 子代码块；写入文件时**只取 frontmatter 到末段正文**，不要把外层 4 反引号一起写进去。

````markdown
---
name: react-component-upgrade
description: Use when running, resuming, or auditing a component-library upgrade that needs JSX-call-site coverage evidence. Triggered by mentions of "组件升级覆盖", "升级回归覆盖", "coverage recorder". Drives a Phase 0 + Phase 2 workflow with file-based state for resume.
---

# React Component Upgrade Coverage Recorder

完整设计见 `docs/plans/2026-04-30-component-upgrade-coverage-recorder-design.md`。

## 前置依赖（在目标前端仓库执行）

```bash
yarn add -D @your-org/coverage-marker@^{{coverageMarkerVersion}}
pip install playwright pytest
playwright install chromium
```

## manifest.json 必填字段

`<state-dir>/manifest.json`：

```json
{
  "baseUrl": "https://example.com/main/app",
  "baseline": { "version": "<目标包当前版本>" },
  "runtime": {
    "targetPackages": ["<your-component-package>"],
    "playwrightProfile": "/absolute/path/to/playwright-profile",
    "proxy": "http://127.0.0.1:8899"
  }
}
```

`targetPackages` 必须为非空数组，babel-plugin / scan / craco loader 三处都从此读取。

`baseUrl` 填浏览器真实访问的业务域名和路径前缀；本地 dev server 通过代理映射，不把 `baseUrl` 改成 `127.0.0.1`。`runtime.proxy` 填 Playwright Chromium 使用的代理服务地址；无需代理时为 `null`。

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
        ? [[require.resolve('@your-org/coverage-marker'), { targetPackages: __coverageTargets }]]
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

启动 recorder 前，必须验证 `@your-org/coverage-marker` 已在业务页运行时生效。不要只凭 scan 有目标就继续。

验证方式：在浏览器访问一个待测路由，操作页面直到能看到至少一个目标组件，然后在业务页 Console 执行：

```js
Array.from(window.__coverageMark__ || [])
```

通过标准：返回数组里至少有一个当前路由实际触发的 target id，且 id 能对应到 `<state-dir>/coverage-targets.json` 里的目标。

失败标准：返回空数组，或只有与当前操作无关的目标。此时必须先修复 `@your-org/coverage-marker` 注入问题，再进入 recorder；否则右侧面板无法可靠检测组件触达。

```bash
# 3. 起 recorder（自动开两个独立窗口：左业务页 + 右面板）
python $SKILL_DIR/scripts/recorder.py
```

## Resume 协议

读 `<state-dir>/runtime-state.json`：缺失 → Phase 0；`phase != done` → 按 `currentRoutePath` 续跑（重启业务页即可）。

## 推迟到 V0.2+

spec 录制 / selectors / console 采集 / coverage-report.md / 中断后自动续跑 / query variant 建模 / 面板 UI 美化。
````

**Step 2：commit**

```bash
git -C <repo> add skill-template && git -C <repo> commit -m "docs: add SKILL.md template"
```

---

## 2. Phase 1 — `@your-org/coverage-marker`（npm 发包）

### Task 2.1：包骨架 + tsup 构建

**Files:**
- Create: `<repo>/packages/coverage-marker/package.json`
- Create: `<repo>/packages/coverage-marker/tsconfig.json`
- Create: `<repo>/packages/coverage-marker/tsup.config.ts`
- Create: `<repo>/packages/coverage-marker/src/index.ts`（占位）
- Create: `<repo>/packages/coverage-marker/src/runtime.ts`（占位）

**Step 1：写 package.json**

```json
{
  "name": "@your-org/coverage-marker",
  "version": "0.1.0",
  "license": "UNLICENSED",
  "main": "./dist/index.js",
  "exports": {
    ".":         { "default": "./dist/index.js",   "types": "./dist/index.d.ts" },
    "./runtime": { "default": "./dist/runtime.js", "types": "./dist/runtime.d.ts" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test":  "jest"
  },
  "peerDependencies": {
    "react":       "^17.0.0 || ^18.0.0",
    "@babel/core": "^7.0.0"
  },
  "devDependencies": {
    "@babel/core":          "^7.28.0",
    "@babel/preset-react":  "^7.27.0",
    "@babel/preset-typescript": "^7.27.0",
    "@types/babel__core":   "^7.20.5",
    "@types/jest":          "^29.5.0",
    "@types/react":         "^17.0.9",
    "@testing-library/react": "^12.1.5",
    "jest":                 "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "react":                "^17.0.2",
    "react-dom":            "^17.0.2",
    "ts-jest":              "^29.1.0",
    "tsup":                 "^8.0.0",
    "typescript":           "^4.6.3"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "jsdom",
    "testMatch": ["**/__tests__/**/*.test.ts?(x)"]
  }
}
```

**Step 2：tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3：tsup.config.ts**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', runtime: 'src/runtime.ts' },
  format: ['cjs'],
  dts: true,
  clean: true,
  external: ['react', '@babel/core'],
});
```

**Step 4：占位入口（让 yarn install 不报错）**

`src/index.ts`：`export default function () { /* TODO */ }`
`src/runtime.ts`：`export const __CoverageMark = () => null;`

**Step 5：安装 + 试构建**

```bash
cd <repo> && yarn install
cd packages/coverage-marker && yarn build
ls dist  # 预期：index.js / index.d.ts / runtime.js / runtime.d.ts
```

**Step 6：commit**

```bash
git -C <repo> add packages/coverage-marker yarn.lock && git -C <repo> commit -m "feat(coverage-marker): scaffold npm package with tsup"
```

---

### Task 2.2：`__CoverageMark` runtime（TDD）

**Files:**
- Modify: `<repo>/packages/coverage-marker/src/runtime.tsx`（rename .ts → .tsx）
- Create: `<repo>/packages/coverage-marker/__tests__/runtime.test.tsx`

**Step 1：写失败测试**

```tsx
import { render } from '@testing-library/react';
import { __CoverageMark } from '../src/runtime';

declare const window: any;

beforeEach(() => { window.__coverageMark__ = new Set(); });

test('挂载时把 id 加入 window.__coverageMark__', () => {
  render(<__CoverageMark id="src/x.tsx#Foo#L1"><span>x</span></__CoverageMark>);
  expect(window.__coverageMark__.has('src/x.tsx#Foo#L1')).toBe(true);
});

test('卸载时从 window.__coverageMark__ 删除', () => {
  const { unmount } = render(<__CoverageMark id="a"><span /></__CoverageMark>);
  unmount();
  expect(window.__coverageMark__.has('a')).toBe(false);
});

test('window.__coverageMark__ 缺失时自动初始化', () => {
  delete window.__coverageMark__;
  render(<__CoverageMark id="a"><span /></__CoverageMark>);
  expect(window.__coverageMark__ instanceof Set).toBe(true);
});
```

**Step 2：跑测试看失败**

```bash
yarn workspace @your-org/coverage-marker test runtime
```

**Step 3：实现**

`src/runtime.tsx`：

```tsx
import { useEffect, ReactNode } from 'react';

declare global {
  interface Window { __coverageMark__?: Set<string>; }
}

export function __CoverageMark({ id, children }: { id: string; children: ReactNode }) {
  useEffect(() => {
    const w = window as Window;
    (w.__coverageMark__ ??= new Set()).add(id);
    return () => { w.__coverageMark__?.delete(id); };
  }, [id]);
  return children as any;
}
```

更新 `tsup.config.ts` 的 entry：`runtime: 'src/runtime.tsx'`。

**Step 4：跑测试看通过**

```bash
yarn workspace @your-org/coverage-marker test runtime
```

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(coverage-marker): __CoverageMark runtime + tests"
```

---

### Task 2.3：babel 插件 transform（TDD）

**Files:**
- Create: `<repo>/packages/coverage-marker/src/index.ts`（覆盖占位）
- Create: `<repo>/packages/coverage-marker/__tests__/babel-plugin.test.ts`

**Step 1：写失败测试**

```ts
import { transformSync } from '@babel/core';
import plugin from '../src';

interface TransformOpts { targetPackages?: string[]; filename?: string }
const transform = (src: string, opts: TransformOpts = {}) => {
  const { targetPackages = ['@example/ui'], filename = 'src/x.tsx' } = opts;
  return transformSync(src, {
    filename,
    presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'classic' }]],
    plugins: [[plugin, { targetPackages }]],
    babelrc: false,
    configFile: false,
  })!.code!;
};

test('目标 JSX 被 wrapper 包裹', () => {
  const out = transform(`
    import { Widget } from '@example/ui';
    export default () => <Widget prop={1} />;
  `);
  expect(out).toContain('__CoverageMark');
  expect(out).toMatch(/id:\s*"src\/x\.tsx#Widget#L\d+"/);
});

test('runtime 通过子路径 import 进来', () => {
  const out = transform(`
    import { Widget } from '@example/ui';
    export default () => <Widget />;
  `);
  expect(out).toContain('@your-org/coverage-marker/runtime');
});

test('非目标包不改写', () => {
  const out = transform(`
    import { Button } from 'some-other-pkg';
    export default () => <Button />;
  `);
  expect(out).not.toContain('__CoverageMark');
});

test('alias 保留 importedName 而不是 localName', () => {
  const out = transform(`
    import { Foo as Bar } from '@example/ui';
    export default () => <Bar />;
  `);
  expect(out).toMatch(/id:\s*"src\/x\.tsx#Foo#L\d+"/);
});

test('type-only import 不改写', () => {
  const out = transform(`
    import type { Foo } from '@example/ui';
    type X = Foo;
    export default () => null;
  `);
  expect(out).not.toContain('__CoverageMark');
});

test('React.createElement 不改写', () => {
  const out = transform(`
    import { Foo } from '@example/ui';
    import React from 'react';
    export default () => React.createElement(Foo);
  `);
  expect(out).not.toContain('__CoverageMark');
});

test('component-as-prop 不改写', () => {
  const out = transform(`
    import { Foo } from '@example/ui';
    export default () => <Wrapper component={Foo} />;
  `);
  expect(out).not.toContain('__CoverageMark');
});

test('多目标包并存识别', () => {
  const out = transform(
    `
      import { Widget } from '@example/ui';
      import { LineChart } from '@example/charts';
      export default () => <><Widget /><LineChart /></>;
    `,
    { targetPackages: ['@example/ui', '@example/charts'] },
  );
  expect(out).toMatch(/id:\s*"src\/x\.tsx#Widget#L\d+"/);
  expect(out).toMatch(/id:\s*"src\/x\.tsx#LineChart#L\d+"/);
});

test('targetPackages 为空数组时插件 no-op', () => {
  // 显式传空 targetPackages，覆盖默认值 ['@example/ui']
  const out = transform(
    `import { Widget } from '@example/ui'; export default () => <Widget />;`,
    { targetPackages: [] },
  );
  expect(out).not.toContain('__CoverageMark');
});

test('防递归：已被 __CoverageMark 包裹的 JSX 不再次包裹', () => {
  const out = transform(`
    import { Widget } from '@example/ui';
    export default () => <Widget><Widget /></Widget>;
  `);
  // 两个 Widget 各包一次，不会形成 __CoverageMark > __CoverageMark > Widget
  const wraps = out.match(/__CoverageMark/g) || [];
  expect(wraps.length).toBe(5); // 2 import-spec + 2 opening + 2 closing - 1 self（数粗略，关键在不递归）
});
```

**Step 2：跑测试看失败**

```bash
yarn workspace @your-org/coverage-marker test babel-plugin
```

**Step 3：实现 `src/index.ts`**

```ts
import type { PluginObj, PluginPass } from '@babel/core';
import type * as Babel from '@babel/core';
import * as path from 'path';

const RUNTIME_SOURCE = '@your-org/coverage-marker/runtime';

interface Options { targetPackages?: string[] }

export default function ({ types: t }: typeof Babel): PluginObj<PluginPass & {
  _localToImported: Map<string, string>;
  _needRuntimeImport: boolean;
}> {
  return {
    name: 'coverage-marker',
    pre() {
      this._localToImported = new Map();
      this._needRuntimeImport = false;
    },
    visitor: {
      Program: {
        enter(p, state) {
          this._localToImported = new Map();
          this._needRuntimeImport = false;
          const targets = new Set<string>(((state.opts as Options).targetPackages) || []);
          if (targets.size === 0) return;
          p.node.body.forEach((stmt) => {
            if (!t.isImportDeclaration(stmt)) return;
            if (stmt.importKind === 'type') return;
            if (!targets.has(stmt.source.value)) return;
            stmt.specifiers.forEach((s) => {
              if (t.isImportDefaultSpecifier(s)) {
                this._localToImported.set(s.local.name, 'default');
              } else if (t.isImportSpecifier(s)) {
                if ((s as any).importKind === 'type') return;
                const imported = t.isIdentifier(s.imported) ? s.imported.name : s.imported.value;
                this._localToImported.set(s.local.name, imported);
              }
            });
          });
        },
        exit(p) {
          if (!this._needRuntimeImport) return;
          p.node.body.unshift(
            t.importDeclaration(
              [t.importSpecifier(t.identifier('__CoverageMark'), t.identifier('__CoverageMark'))],
              t.stringLiteral(RUNTIME_SOURCE),
            ),
          );
        },
      },
      JSXElement(p, state) {
        const opening = p.node.openingElement;
        if (!t.isJSXIdentifier(opening.name)) return;
        const localName = opening.name.name;
        if (localName === '__CoverageMark') return;
        const importedName = this._localToImported.get(localName);
        if (!importedName) return;

        // 防递归：父节点已是 __CoverageMark 时跳过
        const parent = p.parent;
        if (
          t.isJSXElement(parent) &&
          t.isJSXIdentifier(parent.openingElement.name) &&
          parent.openingElement.name.name === '__CoverageMark'
        ) return;

        const filename = state.filename || 'unknown';
        const cwd = state.cwd || process.cwd();
        const rel = path.relative(cwd, filename) || filename;
        const line = opening.loc?.start.line ?? 0;
        const id = `${rel}#${importedName}#L${line}`;

        const wrapped = t.jsxElement(
          t.jsxOpeningElement(
            t.jsxIdentifier('__CoverageMark'),
            [t.jsxAttribute(t.jsxIdentifier('id'), t.stringLiteral(id))],
            false,
          ),
          t.jsxClosingElement(t.jsxIdentifier('__CoverageMark')),
          [p.node],
          false,
        );
        p.replaceWith(wrapped);
        this._needRuntimeImport = true;
      },
    },
  };
}
```

**Step 4：跑测试看通过**

```bash
yarn workspace @your-org/coverage-marker test
```

预期：runtime 3/3 + babel-plugin 10/10 PASS。

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(coverage-marker): babel plugin transform with TDD coverage"
```

---

### Task 2.4：构建产物验证

**Step 1：清构建后再 build**

```bash
cd <repo> && yarn workspace @your-org/coverage-marker build
ls packages/coverage-marker/dist
# 预期：index.js / index.d.ts / runtime.js / runtime.d.ts
```

**Step 2：从 dist 反向 require 验证**

```bash
node -e "
  const plugin = require('./packages/coverage-marker/dist/index.js').default;
  console.log(typeof plugin === 'function' ? 'OK plugin' : 'FAIL plugin');
  const rt = require('./packages/coverage-marker/dist/runtime.js');
  console.log(typeof rt.__CoverageMark === 'function' ? 'OK runtime' : 'FAIL runtime');
"
```

**Step 3：commit（dist 不入库，仅 lockfile 已在前面提交）**

无新文件提交，标记里程碑：

```bash
git -C <repo> tag -a coverage-marker-v0.1.0 -m "coverage-marker MVP build verified"
```

---

## 3. Phase 2 — `scan/`（Node 脚本，bundle 进 skill）

### Task 3.1：scan 项目骨架 + jest

**Files:**
- Create: `<repo>/scan/package.json`
- Create: `<repo>/scan/tsconfig.json`
- Create: `<repo>/scan/src/index.ts`（占位）

**Step 1：scan/package.json**

```json
{
  "name": "scan",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "scripts": {
    "test":  "jest",
    "build": "esbuild src/index.ts --bundle --platform=node --target=node16 --outfile=dist/scan.js"
  },
  "dependencies": {
    "typescript": "^4.6.3"
  },
  "devDependencies": {
    "@types/jest":  "^29.5.0",
    "@types/node":  "^16.18.0",
    "esbuild":      "^0.20.0",
    "jest":         "^29.7.0",
    "ts-jest":      "^29.1.0"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.ts"]
  }
}
```

**Step 2：tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src", "__tests__"]
}
```

**Step 3：占位 index.ts**

```ts
export {};
```

**Step 4：yarn install 触达 workspace**

```bash
cd <repo> && yarn install
```

**Step 5：commit**

```bash
git -C <repo> add scan && git -C <repo> commit -m "chore(scan): scaffold node script package"
```

---

### Task 3.2：`parseTargetImports`（TDD）

**Files:**
- Create: `<repo>/scan/src/parseTargetImports.ts`
- Create: `<repo>/scan/__tests__/parseTargetImports.test.ts`

**Step 1：写失败测试（同设计文档要求覆盖 named / default / type-only / 多包）**

```ts
import { parseTargetImports } from '../src/parseTargetImports';

const TARGETS = new Set(['@example/ui']);

test('named import 解析 importedName / localName', () => {
  const src = `import { Widget, Modal as M } from '@example/ui';`;
  expect(parseTargetImports(src, TARGETS)).toEqual([
    { packageName: '@example/ui', importedName: 'Widget', localName: 'Widget', kind: 'named' },
    { packageName: '@example/ui', importedName: 'Modal',  localName: 'M',      kind: 'named' },
  ]);
});

test('type-only import 必须排除', () => {
  const src = `import type { WidgetProps } from '@example/ui';`;
  expect(parseTargetImports(src, TARGETS)).toEqual([]);
});

test('default import', () => {
  const src = `import lib from '@example/ui';`;
  expect(parseTargetImports(src, TARGETS)).toEqual([
    { packageName: '@example/ui', importedName: 'default', localName: 'lib', kind: 'default' },
  ]);
});

test('非目标包不解析', () => {
  expect(parseTargetImports(`import { B } from 'other-pkg';`, TARGETS)).toEqual([]);
});

test('多目标包并存', () => {
  const T2 = new Set(['@example/ui', '@example/charts']);
  const src = `
    import { Widget } from '@example/ui';
    import { LineChart } from '@example/charts';
    import { B } from 'other-pkg';
  `;
  expect(parseTargetImports(src, T2).map((i) => i.packageName).sort()).toEqual(['@example/charts', '@example/ui']);
});
```

**Step 2-4：实现 + 跑通**

```ts
import * as ts from 'typescript';

export interface TargetImport {
  packageName: string;
  importedName: string;
  localName: string;
  kind: 'named' | 'default' | 'namespace';
}

export function parseTargetImports(source: string, targets: Set<string>): TargetImport[] {
  const sf = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: TargetImport[] = [];
  sf.statements.forEach((s) => {
    if (!ts.isImportDeclaration(s)) return;
    if (s.importClause?.isTypeOnly) return;
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    if (!targets.has(spec)) return;
    const ic = s.importClause;
    if (!ic) return;
    if (ic.name) out.push({ packageName: spec, importedName: 'default', localName: ic.name.text, kind: 'default' });
    const nb = ic.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      nb.elements.forEach((el) => {
        if (el.isTypeOnly) return;
        const imported = el.propertyName?.text ?? el.name.text;
        out.push({ packageName: spec, importedName: imported, localName: el.name.text, kind: 'named' });
      });
    } else if (nb && ts.isNamespaceImport(nb)) {
      out.push({ packageName: spec, importedName: '*', localName: nb.name.text, kind: 'namespace' });
    }
  });
  return out;
}
```

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(scan): parseTargetImports via typescript compiler API"
```

---

### Task 3.3：`findJsxCallSites`（TDD）

**Files:**
- Create: `<repo>/scan/src/findJsxCallSites.ts`
- Create: `<repo>/scan/__tests__/findJsxCallSites.test.ts`

**Step 1：写失败测试（覆盖设计文档 §4.3 全部判定）**

```ts
import { findJsxCallSites } from '../src/findJsxCallSites';
const T = new Set(['@example/ui']);
const fixture = (s: string) => findJsxCallSites('src/X.tsx', s, T);

test('JSX 自闭合命中', () => {
  const r = fixture(`import { Widget } from '@example/ui'; export default () => <Widget />;`);
  expect(r[0]).toMatchObject({ importedName: 'Widget', file: 'src/X.tsx' });
});

test('alias 保留 importedName', () => {
  const r = fixture(`import { Foo as Bar } from '@example/ui'; export default () => <Bar />;`);
  expect(r[0]).toMatchObject({ importedName: 'Foo', localName: 'Bar' });
});

test('createElement / component-as-prop / type-only 全部排除', () => {
  expect(fixture(`import { F } from '@example/ui'; import React from 'react'; export default () => React.createElement(F);`)).toEqual([]);
  expect(fixture(`import { F } from '@example/ui'; export default () => <Wrapper component={F} />;`)).toEqual([]);
  expect(fixture(`import type { F } from '@example/ui'; type X = F; export default () => null;`)).toEqual([]);
});
```

**Step 2-4：实现**

```ts
import * as ts from 'typescript';
import { parseTargetImports } from './parseTargetImports';

export interface JsxCallSite {
  file: string; line: number;
  importedName: string; localName: string; packageName: string;
}

export function findJsxCallSites(file: string, source: string, targets: Set<string>): JsxCallSite[] {
  const imports = parseTargetImports(source, targets);
  if (imports.length === 0) return [];
  const localToImport = new Map(imports.map((i) => [i.localName, i]));
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: JsxCallSite[] = [];
  const visit = (node: ts.Node) => {
    let tagName: string | undefined;
    if (ts.isJsxSelfClosingElement(node)) tagName = node.tagName.getText(sf);
    else if (ts.isJsxOpeningElement(node)) tagName = node.tagName.getText(sf);
    if (tagName) {
      const root = tagName.split('.')[0];
      const m = localToImport.get(root);
      if (m) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        out.push({ file, line: line + 1, importedName: m.importedName, localName: m.localName, packageName: m.packageName });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
```

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(scan): findJsxCallSites via TS AST"
```

---

### Task 3.4：`walkSourceFiles` + `parseRouter` + `buildImportGraph` + `walkReachable`（TDD）

**Files:**
- Create: `<repo>/scan/src/walkSourceFiles.ts`
- Create: `<repo>/scan/src/parseRouter.ts`
- Create: `<repo>/scan/src/buildImportGraph.ts`
- Create: `<repo>/scan/__tests__/walkSourceFiles.test.ts`
- Create: `<repo>/scan/__tests__/parseRouter.test.ts`
- Create: `<repo>/scan/__tests__/buildImportGraph.test.ts`

**Step 0：walkSourceFiles 测试 + 实现（默认体积控制）**

测试（`__tests__/walkSourceFiles.test.ts`）：

```ts
import * as path from 'path';
import { walkSourceFiles } from '../src/walkSourceFiles';

test('跳过 node_modules / __tests__ / .d.ts / dist / build', () => {
  // fixture 须包含：
  // src/ok.tsx               ← 收
  // src/node_modules/x.ts    ← 跳
  // src/__tests__/x.test.ts  ← 跳
  // src/types.d.ts           ← 跳
  // src/dist/y.js            ← 跳
  const files = walkSourceFiles(path.join(__dirname, 'fixtures/walk-fixture/src'));
  expect(files.every((f) => !f.includes('node_modules') && !f.includes('__tests__')
    && !f.endsWith('.d.ts') && !f.includes('/dist/') && !f.includes('/build/'))).toBe(true);
  expect(files.some((f) => f.endsWith('ok.tsx'))).toBe(true);
});
```

实现（`src/walkSourceFiles.ts`）：

```ts
import * as fs from 'fs';
import * as path from 'path';

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist', 'build', '.next', '.cache']);

export function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.next') continue; // 跳隐藏
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(full);
    }
  };
  visit(root);
  return out;
}
```

> 入口约束：`runScan` 必须从 `path.join(projectRoot, 'src')` 起调用 `walkSourceFiles`，**禁止**直接传 `projectRoot`。这是默认体积控制——避免误扫 `node_modules` 等导致 import graph 爆炸。



**Step 1：parseRouter 测试**

```ts
import { parseRouter } from '../src/parseRouter';

test('lazy(() => import(...)) 解析 path + componentImportPath', () => {
  const src = `
    import { lazy } from 'react';
    const A = lazy(() => import('@/pages/Paper/Index'));
    const routers = [{ path: '/main/x', component: A }];
    export default routers;
  `;
  expect(parseRouter('src/router/routers/paper.ts', src)).toEqual([
    { path: '/main/x', componentImportPath: '@/pages/Paper/Index', file: 'src/router/routers/paper.ts' },
  ]);
});

test('多路由解析', () => {
  const src = `
    import { lazy } from 'react';
    const A = lazy(() => import('@/p/A'));
    const B = lazy(() => import('@/p/B'));
    const routers = [
      { path: '/a', component: A },
      { path: '/b', component: B },
    ];
    export default routers;
  `;
  expect(parseRouter('r.ts', src).map((r) => r.path).sort()).toEqual(['/a', '/b']);
});
```

**Step 2-4：实现 parseRouter（基于 TS AST：先收集 `localName -> import path` 映射，再在 `ArrayLiteralExpression` 中匹配 `path/component` 对）**

参考原 skill `subagent-prompts.md` 算法，移植为 TS API（用 `ts.isVariableStatement` / `ts.isCallExpression` 判定 `lazy(import(...))`、`ts.isObjectLiteralExpression` 提取 `{ path, component }`）。完整实现交给执行者。

**Step 5：buildImportGraph + walkReachable 测试**

```ts
import { walkReachable } from '../src/buildImportGraph';

test('reachable 文件集合', () => {
  const g = new Map<string, Set<string>>([
    ['a.ts', new Set(['b.ts'])],
    ['b.ts', new Set(['c.ts'])],
    ['c.ts', new Set()],
  ]);
  expect(walkReachable('a.ts', g)).toEqual(new Set(['a.ts', 'b.ts', 'c.ts']));
});

test('循环依赖不死循环', () => {
  const g = new Map<string, Set<string>>([
    ['a.ts', new Set(['b.ts'])],
    ['b.ts', new Set(['a.ts'])],
  ]);
  expect(walkReachable('a.ts', g)).toEqual(new Set(['a.ts', 'b.ts']));
});
```

**Step 6：实现 buildImportGraph + walkReachable**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export function resolveImport(specifier: string, fromFile: string, projectRoot: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(projectRoot, 'src', specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [
    base, base + '.ts', base + '.tsx', base + '.js', base + '.jsx',
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
    path.join(base, 'index.js'), path.join(base, 'index.jsx'),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

export function buildImportGraph(files: string[], projectRoot: string): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const deps = new Set<string>();
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) {
        const r = resolveImport((n.moduleSpecifier as ts.StringLiteral).text, f, projectRoot);
        if (r) deps.add(r);
      }
      if (ts.isCallExpression(n) && n.expression.getText(sf) === 'import' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
        const r = resolveImport(n.arguments[0].text, f, projectRoot);
        if (r) deps.add(r);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    g.set(f, deps);
  }
  return g;
}

export function walkReachable(entry: string, graph: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const x = stack.pop()!;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const d of graph.get(x) || []) stack.push(d);
  }
  return seen;
}
```

**Step 7：跑测试看通过**

**Step 8：commit**

```bash
git -C <repo> commit -am "feat(scan): router parsing and import graph"
```

---

### Task 3.5：`greedyCover`（TDD）

**Files:**
- Create: `<repo>/scan/src/greedyCover.ts`
- Create: `<repo>/scan/__tests__/greedyCover.test.ts`

**Step 1：测试 + 实现（同设计文档 §4.4）**

```ts
import { greedyCover } from '../src/greedyCover';

test('选最少路径覆盖最多 target', () => {
  const universe = new Set(['t1', 't2', 't3', 't4']);
  const coverage = new Map([
    ['/a', new Set(['t1', 't2'])],
    ['/b', new Set(['t2', 't3'])],
    ['/c', new Set(['t3', 't4'])],
    ['/d', new Set(['t1'])],
  ]);
  const { selected, unmapped } = greedyCover(universe, coverage);
  const covered = new Set(selected.flatMap((r) => Array.from(coverage.get(r)!)));
  expect(covered).toEqual(universe);
  expect(unmapped.size).toBe(0);
});

test('无法覆盖的 target 进 unmapped', () => {
  const u = new Set(['t1', 't2', 'tOrphan']);
  const c = new Map([['/a', new Set(['t1', 't2'])]]);
  const { selected, unmapped } = greedyCover(u, c);
  expect(selected).toEqual(['/a']);
  expect(unmapped).toEqual(new Set(['tOrphan']));
});
```

**Step 2：实现（设计文档 §4.4 伪代码移植）**

```ts
export function greedyCover(
  universe: Set<string>,
  coverage: Map<string, Set<string>>,
): { selected: string[]; unmapped: Set<string> } {
  const remaining = new Set(universe);
  const selected: string[] = [];
  while (remaining.size > 0) {
    let best: string | null = null;
    let bestCount = 0;
    for (const [route, ids] of coverage) {
      if (selected.includes(route)) continue;
      let n = 0;
      for (const t of ids) if (remaining.has(t)) n++;
      if (n > bestCount) { best = route; bestCount = n; }
    }
    if (!best) break;
    selected.push(best);
    for (const t of coverage.get(best)!) remaining.delete(t);
  }
  return { selected, unmapped: remaining };
}
```

**Step 3：commit**

```bash
git -C <repo> commit -am "feat(scan): greedy set-cover for route checklist"
```

---

### Task 3.6：`manifest.ts` 共享 helpers（TDD）

**Files:**
- Create: `<repo>/scan/src/manifest.ts`
- Create: `<repo>/scan/__tests__/manifest.test.ts`

**Step 1：测试**

```ts
import { resolveStateDir, validateTargetPackages } from '../src/manifest';

test('resolveStateDir 优先级：参数 > env > 默认', () => {
  expect(resolveStateDir({ stateDirArg: '/x' })).toBe('/x');
  expect(resolveStateDir({ env: { STATE_DIR: '/y' } as any })).toBe('/y');
  expect(resolveStateDir({ env: {} as any })).toBe('coverage-state');
});

test('validateTargetPackages 拒绝空 / 非数组', () => {
  expect(() => validateTargetPackages([] as any)).toThrow();
  expect(() => validateTargetPackages(undefined as any)).toThrow();
  expect(() => validateTargetPackages('xxx' as any)).toThrow();
  expect(() => validateTargetPackages(['ok'])).not.toThrow();
});
```

**Step 2：实现**

```ts
import * as fs from 'fs';
import * as path from 'path';

export function resolveStateDir(opts: { stateDirArg?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return opts.stateDirArg || (opts.env ?? process.env).STATE_DIR || 'coverage-state';
}

export function loadManifest(stateDir: string): any {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'manifest.json'), 'utf8'));
}

export function validateTargetPackages(pkgs: unknown): asserts pkgs is string[] {
  if (!Array.isArray(pkgs) || pkgs.length === 0 || pkgs.some((p) => typeof p !== 'string')) {
    throw new Error('manifest.runtime.targetPackages 必须为非空字符串数组');
  }
}
```

**Step 3：commit**

```bash
git -C <repo> commit -am "feat(scan): manifest helpers (resolveStateDir / validate)"
```

---

### Task 3.7：`runScan` 集成（TDD with fixture）

**Files:**
- Create: `<repo>/scan/src/runScan.ts`
- Create: `<repo>/scan/__tests__/fixtures/mini-app/`（mini React app fixture）
- Create: `<repo>/scan/__tests__/runScan.test.ts`

**Step 1：搭 fixture mini-app**

```
__tests__/fixtures/mini-app/
├── coverage-state/manifest.json   ← { baseUrl, runtime: { targetPackages: ['@example/ui'] } }
└── src/
    ├── router/routers/index.ts    ← 两条路由：/p1 → @/pages/P1, /p2 → @/pages/P2
    ├── pages/P1/index.tsx         ← <Widget /> from '@example/ui'
    └── pages/P2/index.tsx         ← <Modal />  from '@example/ui'
```

**Step 2：写测试**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { runScan } from '../src/runScan';

test('runScan 输出三件套', async () => {
  const dir = path.join(__dirname, 'fixtures/mini-app');
  const out = path.join(dir, 'coverage-state');
  await runScan({ projectRoot: dir, targetPackages: ['@example/ui'], outDir: out, baseUrl: 'http://x' });
  const t = JSON.parse(fs.readFileSync(path.join(out, 'coverage-targets.json'), 'utf8'));
  expect(t.targets.map((x: any) => x.importedName).sort()).toEqual(['Modal', 'Widget']);
  const c = JSON.parse(fs.readFileSync(path.join(out, 'route-checklist.json'), 'utf8'));
  expect(c.selectedRoutes.map((r: any) => r.path).sort()).toEqual(['/p1', '/p2']);
  expect(c.unmappedTargetIds).toEqual([]);
});
```

**Step 3：实现 runScan**（聚合 walkSourceFiles / findJsxCallSites / parseRouter / buildImportGraph / walkReachable / greedyCover；写 pages.json / coverage-targets.json / route-checklist.json）— 按设计文档 §4 + §7.2/7.3 schema。

> **入口约束（Task 3.4 已声明）**：`runScan` 内必须从 `path.join(projectRoot, 'src')` 调 `walkSourceFiles`、从 `path.join(projectRoot, 'src/router/routers')` 收集路由文件——**禁止**直接传 `projectRoot` 全量扫，否则 `node_modules` 会进入 import graph 导致体积爆炸。

**Step 4：跑通**

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(scan): aggregate three artifacts"
```

---

### Task 3.8：`index.ts` 入口 + esbuild bundle

**Files:**
- Modify: `<repo>/scan/src/index.ts`

**Step 1：写最简入口（无 CLI 框架）**

```ts
import * as path from 'path';
import { runScan } from './runScan';
import { resolveStateDir, loadManifest, validateTargetPackages } from './manifest';

async function main() {
  const stateDir = path.resolve(resolveStateDir());
  const manifest = loadManifest(stateDir);
  const pkgs = manifest?.runtime?.targetPackages;
  validateTargetPackages(pkgs);
  const result = await runScan({
    projectRoot: process.cwd(),
    targetPackages: pkgs,
    outDir: stateDir,
    baseUrl: manifest.baseUrl,
  });
  if (process.argv.includes('--report')) {
    console.log(JSON.stringify(result.summary, null, 2));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

**Step 2：试 bundle（typescript 全打进 bundle，用户侧零依赖）**

```bash
cd <repo> && yarn workspace scan build
ls -lh scan/dist/scan.js     # 预期：约 8-10 MB（typescript 整个被打入）
node -e "require('./scan/dist/scan.js')"  # 期望报 'manifest.json not found'（无 stateDir 时），证明 bundle 可执行
```

> 体积说明：MVP 阶段先全打进 bundle，让 scan.js 自包含、用户侧零依赖。skill 的渐进加载机制使 ~10 MB 体积不构成瓶颈。后续若有压力，再做 `external: ['typescript']` + 借用宿主项目 typescript 的优化（V0.2+）。

**Step 3：commit**

```bash
git -C <repo> commit -am "feat(scan): cli entry + esbuild bundle (typescript inlined for MVP)"
```

---

## 4. Phase 3 — `panel/`（React + Vite）

### Task 4.1：Vite 项目骨架

**Files:**
- Create: `<repo>/panel/package.json`
- Create: `<repo>/panel/vite.config.ts`
- Create: `<repo>/panel/index.html`
- Create: `<repo>/panel/src/main.tsx`（占位）

**Step 1：panel/package.json**

```json
{
  "name": "panel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":   "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react":     "^17.0.2",
    "react-dom": "^17.0.2"
  },
  "devDependencies": {
    "@types/react":     "^17.0.9",
    "@types/react-dom": "^17.0.9",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript":       "^4.6.3",
    "vite":             "^5.0.0",
    "vite-plugin-singlefile": "^2.0.0"
  }
}
```

**Step 2：vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 关键：viteSingleFile 把 JS/CSS/资源全部 inline 进 index.html，
// 产物是单个自包含的 HTML 文件，recorder.py 可通过 file:// 直接加载，
// 避免 Chrome 对 file:// 协议下跨文件 ESM import 的 CORS 拦截。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,  // 让所有资源都被视为可 inline
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
```

**Step 3：index.html + 占位 main.tsx**

`panel/index.html`：

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Coverage Recorder</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`panel/src/main.tsx`：

```tsx
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<div>panel placeholder</div>);
```

**Step 4：试 build**

```bash
cd <repo> && yarn workspace panel build
ls panel/dist  # 预期：仅 index.html 一个文件（JS/CSS 全 inline）
```

**Step 4.1：验证 file:// 加载无外链**

```bash
grep -E 'src=|href=' panel/dist/index.html | grep -v 'data:' || echo 'OK: 无外部资源引用'
# 预期：OK（所有 src/href 要么是 data: URI，要么不存在）
```

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(panel): scaffold vite + react"
```

---

### Task 4.2：panel 组件实现 + dev mock

**Files:**
- Modify: `<repo>/panel/src/main.tsx`
- Create: `<repo>/panel/src/App.tsx`
- Create: `<repo>/panel/src/types.ts`

**Step 1：types.ts**

```ts
export interface PanelTarget { id: string; importedName: string; file: string; line: number }
export interface PanelState {
  totalRuntimeTargets: number;
  confirmedTotal: number;
  currentDetected: PanelTarget[];
  currentRouteRemaining: PanelTarget[];
  currentRoutePath: string;
  routeChecklist: { path: string; confirmedCount: number; targetCount: number }[];
}

declare global {
  interface Window {
    updatePanel: (s: PanelState) => void;
    confirmRoute: () => Promise<void>;
  }
}
```

**Step 2：App.tsx**

```tsx
import { useState, useEffect } from 'react';
import type { PanelState } from './types';

export function App() {
  const [s, setS] = useState<PanelState | null>(null);
  useEffect(() => { window.updatePanel = setS; }, []);
  if (!s) return <div>等待 recorder.py…</div>;
  const canConfirm = s.currentRouteRemaining.length === 0;
  const fmt = (t: { importedName: string; file: string; line: number }) => `${t.importedName}  ${t.file}:${t.line}`;
  return (
    <div style={{ font: '13px -apple-system,sans-serif', margin: 16 }}>
      <div>targets {s.totalRuntimeTargets} | confirmed {s.confirmedTotal} | route {s.currentRoutePath}</div>
      <h3>Current Detected ({s.currentDetected.length})</h3>
      <ul>{s.currentDetected.map((t) => <li key={t.id}>{fmt(t)}</li>)}</ul>
      <h3>Remaining (current route)</h3>
      <ul>{s.currentRouteRemaining.map((t) => <li key={t.id}>{fmt(t)}</li>)}</ul>
      <h3>Route Checklist</h3>
      <ul>{s.routeChecklist.map((r) => <li key={r.path}>[{r.confirmedCount === r.targetCount ? 'x' : ' '}] {r.path} ({r.confirmedCount}/{r.targetCount})</li>)}</ul>
      <button disabled={!canConfirm} onClick={() => window.confirmRoute()} style={{ padding: '8px 16px', marginTop: 12, opacity: canConfirm ? 1 : 0.4 }}>
        当前路由完成，确认并截图
      </button>
    </div>
  );
}
```

**Step 3：main.tsx**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.DEV) {
  // 开发态自动塞一个 mock，方便 yarn dev 调试
  setTimeout(() => window.updatePanel({
    totalRuntimeTargets: 3, confirmedTotal: 0,
    currentDetected: [{ id: 'a', importedName: 'Widget', file: 'src/x.tsx', line: 1 }],
    currentRouteRemaining: [{ id: 'b', importedName: 'Modal', file: 'src/y.tsx', line: 9 }],
    currentRoutePath: '/p1',
    routeChecklist: [{ path: '/p1', confirmedCount: 0, targetCount: 2 }],
  }), 100);
  window.confirmRoute = async () => { console.log('confirmed (dev mock)'); };
}
```

**Step 4：dev 调试**

```bash
yarn workspace panel dev   # 浏览器打开 http://127.0.0.1:5173 验证渲染
```

**Step 5：build 验证**

```bash
yarn workspace panel build
open panel/dist/index.html  # 直接 file:// 打开应能渲染（dev mock 不生效，停留在"等待 recorder.py…"）；
                            # DevTools Network 面板应**无任何外部请求**——所有 JS/CSS 都在 HTML 内
```

**Step 6：commit**

```bash
git -C <repo> commit -am "feat(panel): App component + dev-mode mock"
```

---

## 5. Phase 4 — `recorder/`（Python）

### Task 5.1：recorder 项目骨架

**Files:**
- Create: `<repo>/recorder/pyproject.toml`（仅作为 pytest 配置容器）
- Create: `<repo>/recorder/src/recorder.py`（占位）
- Create: `<repo>/recorder/src/panel_state.py`（占位）
- Create: `<repo>/recorder/tests/__init__.py`

**Step 1：pyproject.toml（不声明 deps，仅 pytest 配置）**

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

> 说明：playwright/pytest 由用户全局/venv 装，pyproject 不参与依赖管理。`pythonpath = ["src"]` 让 `from panel_state import ...` 在 tests 中可用。

**Step 2：占位**

`recorder/src/panel_state.py`：

```python
def compute_panel_state(*, targets, checklist, marks, confirmed, current_route_path):
    raise NotImplementedError
```

`recorder/src/recorder.py`：

```python
if __name__ == '__main__':
    print('recorder placeholder')
```

**Step 3：跑 pytest 验证 rootdir**

```bash
cd <repo>/recorder && pytest --collect-only
# 预期：no tests collected（占位），但无 import error
```

**Step 4：commit**

```bash
git -C <repo> add recorder && git -C <repo> commit -m "chore(recorder): scaffold python project with pyproject"
```

---

### Task 5.2：`compute_panel_state`（TDD）

**Files:**
- Modify: `<repo>/recorder/src/panel_state.py`
- Create: `<repo>/recorder/tests/test_panel_state.py`

**Step 1：写失败测试**

```python
from panel_state import compute_panel_state

TARGETS = [
    {'targetId': 'src/x.tsx#Foo#L1', 'importedName': 'Foo', 'file': 'src/x.tsx', 'line': 1},
    {'targetId': 'src/y.tsx#Bar#L2', 'importedName': 'Bar', 'file': 'src/y.tsx', 'line': 2},
]
CHECKLIST = [
    {'path': '/p1', 'targetIds': ['src/x.tsx#Foo#L1'], 'confirmedCount': 0, 'targetCount': 1},
    {'path': '/p2', 'targetIds': ['src/y.tsx#Bar#L2'], 'confirmedCount': 0, 'targetCount': 1},
]

def test_basic():
    s = compute_panel_state(targets=TARGETS, checklist=CHECKLIST,
                             marks=['src/x.tsx#Foo#L1'], confirmed=set(),
                             current_route_path='/p1')
    assert s['totalRuntimeTargets'] == 2
    assert len(s['currentDetected']) == 1
    assert s['currentRouteRemaining'] == []

def test_remaining_excludes_detected_and_confirmed():
    targets2 = TARGETS + [{'targetId': 'src/x.tsx#Baz#L3', 'importedName': 'Baz', 'file': 'src/x.tsx', 'line': 3}]
    checklist2 = [{'path': '/p1', 'targetIds': ['src/x.tsx#Foo#L1', 'src/x.tsx#Baz#L3'],
                   'confirmedCount': 0, 'targetCount': 2}]
    s = compute_panel_state(targets=targets2, checklist=checklist2,
                             marks=['src/x.tsx#Foo#L1'], confirmed=set(),
                             current_route_path='/p1')
    assert [t['importedName'] for t in s['currentRouteRemaining']] == ['Baz']
```

**Step 2：跑测试看失败**

```bash
cd <repo>/recorder && pytest tests/test_panel_state.py
```

**Step 3：实现 panel_state.py**

```python
def compute_panel_state(*, targets, checklist, marks, confirmed, current_route_path):
    by_id = {t['targetId']: t for t in targets}
    cur = next((r for r in checklist if r['path'] == current_route_path), None)
    cur_ids = set(cur['targetIds']) if cur else set()
    detected = set(marks)

    pick = lambda tid: {'id': tid, 'importedName': by_id[tid]['importedName'],
                        'file': by_id[tid]['file'], 'line': by_id[tid]['line']}
    return {
        'totalRuntimeTargets': len(targets),
        'confirmedTotal': len(confirmed),
        'currentDetected':       [pick(tid) for tid in detected if tid in by_id],
        'currentRouteRemaining': [pick(tid) for tid in cur_ids
                                  if tid not in detected and tid not in confirmed],
        'currentRoutePath': current_route_path,
        'routeChecklist': [{'path': r['path'], 'confirmedCount': r['confirmedCount'],
                            'targetCount': r['targetCount']} for r in checklist],
    }
```

**Step 4：跑测试看通过**

**Step 5：commit**

```bash
git -C <repo> commit -am "feat(recorder): compute_panel_state pure function + tests"
```

---

### Task 5.3：recorder 主进程（runner.py）

**Files:**
- Create: `<repo>/recorder/src/runner.py`
- Modify: `<repo>/recorder/src/recorder.py`

**Step 1：runner.py（Playwright 主循环 + 内联 atomic_write_json + iso_now）**

```python
import asyncio, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright
from panel_state import compute_panel_state

POLL_MS = 200

def iso_now():
    return datetime.now(timezone.utc).isoformat()

def atomic_write_json(path: Path, obj):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2))
    os.replace(tmp, path)

def read_json(path: Path):
    return json.loads(path.read_text())

async def run_recorder(state_dir: Path, panel_html: Path):
    manifest = read_json(state_dir / 'manifest.json')
    targets   = read_json(state_dir / 'coverage-targets.json')['targets']
    checklist = read_json(state_dir / 'route-checklist.json')['selectedRoutes']

    confirmed: set[str] = set()
    cur_idx = 0
    nth = 1
    done = asyncio.Event()

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=manifest['runtime']['playwrightProfile'],
            headless=False,
            proxy={'server': manifest['runtime']['proxy']} if manifest['runtime'].get('proxy') else None,
            args=['--ignore-certificate-errors'],
            viewport={'width': 1280, 'height': 900},
        )
        page_app   = ctx.pages[0] if ctx.pages else await ctx.new_page()
        page_panel = await ctx.new_page()

        async def on_confirm():
            nonlocal cur_idx, nth
            route = checklist[cur_idx]
            ev_dir = state_dir / 'runs' / f"baseline-{manifest.get('baseline',{}).get('version','unknown')}" / 'pages' / route['routeId']
            ev_dir.mkdir(parents=True, exist_ok=True)
            await page_app.screenshot(path=str(ev_dir / 'screenshot.png'), full_page=True)
            detected = await page_app.evaluate("Array.from(window.__coverageMark__ || [])")
            atomic_write_json(ev_dir / 'coverage.json', {
                'evidenceId': f'baseline-{nth:03d}', 'createdAt': iso_now(),
                'url': page_app.url, 'routeId': route['routeId'],
                'detectedTargetIds': detected, 'confirmedTargetIds': detected,
                'screenshot': 'screenshot.png', 'reviewStatus': 'visual-ok',
            })
            confirmed.update(detected); nth += 1; cur_idx += 1
            if cur_idx >= len(checklist):
                done.set()
            else:
                await page_app.goto(checklist[cur_idx]['url'])

        await page_panel.expose_function('confirmRoute', on_confirm)
        await page_panel.goto(f'file://{panel_html}')
        await page_app.goto(checklist[0]['url'])

        while not done.is_set():
            try:
                marks = await page_app.evaluate("Array.from(window.__coverageMark__ || [])")
            except Exception:
                marks = []
            cur_path = checklist[cur_idx]['path'] if cur_idx < len(checklist) else ''
            state = compute_panel_state(
                targets=targets, checklist=checklist, marks=marks,
                confirmed=confirmed, current_route_path=cur_path)
            try:
                await page_panel.evaluate("(s) => window.updatePanel && window.updatePanel(s)", state)
            except Exception:
                pass
            atomic_write_json(state_dir / 'runtime-state.json', {
                'schemaVersion': 1, 'phase': 'baseline',
                'currentRouteId': checklist[cur_idx]['routeId'] if cur_idx < len(checklist) else None,
                'currentUrl': page_app.url, 'currentRoutePath': cur_path,
                'detectedTargetIds': marks,
                'currentRouteRemaining': [t['id'] for t in state['currentRouteRemaining']],
                'totalRuntimeTargets': state['totalRuntimeTargets'],
                'confirmedTotal': state['confirmedTotal'],
                'remainingRoutesCount': len(checklist) - cur_idx,
                'lastUpdate': iso_now(),
            })
            await asyncio.sleep(POLL_MS / 1000)

        rs = read_json(state_dir / 'runtime-state.json')
        rs['phase'] = 'done'
        atomic_write_json(state_dir / 'runtime-state.json', rs)
        await ctx.close()
```

**Step 2：recorder.py 入口（无 argparse）**

```python
import asyncio, os, sys
from pathlib import Path

if __name__ == '__main__':
    state_dir = Path(os.environ.get('STATE_DIR', 'coverage-state')).resolve()
    panel_html = (Path(__file__).parent / 'panel' / 'index.html').resolve()
    if '--dry-run' in sys.argv:
        # 仅校验 manifest 字段并写初始 runtime-state.json，不开浏览器
        import json
        from panel_state import compute_panel_state
        from runner import iso_now, atomic_write_json
        manifest = json.loads((state_dir / 'manifest.json').read_text())
        pkgs = manifest.get('runtime', {}).get('targetPackages')
        if not isinstance(pkgs, list) or not pkgs:
            sys.exit('manifest.runtime.targetPackages 必须为非空数组')
        checklist = json.loads((state_dir / 'route-checklist.json').read_text())['selectedRoutes']
        targets   = json.loads((state_dir / 'coverage-targets.json').read_text())['targets']
        s = compute_panel_state(targets=targets, checklist=checklist, marks=[], confirmed=set(),
                                 current_route_path=checklist[0]['path'])
        atomic_write_json(state_dir / 'runtime-state.json', {
            'schemaVersion': 1, 'phase': 'baseline',
            'currentRouteId': checklist[0]['routeId'], 'currentUrl': checklist[0]['url'],
            'currentRoutePath': checklist[0]['path'],
            'detectedTargetIds': [], 'currentRouteRemaining': [t['id'] for t in s['currentRouteRemaining']],
            'totalRuntimeTargets': s['totalRuntimeTargets'], 'confirmedTotal': s['confirmedTotal'],
            'remainingRoutesCount': len(checklist), 'lastUpdate': iso_now(),
        })
    else:
        from runner import run_recorder
        asyncio.run(run_recorder(state_dir, panel_html))
```

**Step 3：commit**

```bash
git -C <repo> commit -am "feat(recorder): playwright runner + dry-run entry"
```

---

## 6. Phase 5 — `build-skill.ts`（打包脚本）

### Task 6.1：build-skill.ts 骨架 + 各 sub-build 调用

**Files:**
- Create: `<repo>/scripts/build-skill.ts`

**Step 1：实现**

```ts
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist/skills/react-component-upgrade');
const SCRIPTS_DIR = path.join(DIST, 'scripts');

function sh(cmd: string, opts?: { cwd?: string }) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts?.cwd ?? ROOT });
}

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

  // 1. coverage-marker（npm 包）
  sh('yarn workspace @your-org/coverage-marker build');
  const cmPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/coverage-marker/package.json'), 'utf8'));

  // 2. scan → scripts/scan.js
  sh('yarn workspace scan build');
  fs.copyFileSync(path.join(ROOT, 'scan/dist/scan.js'), path.join(SCRIPTS_DIR, 'scan.js'));

  // 3. panel → scripts/panel/index.html（vite-plugin-singlefile 产出单 HTML，inline 全部 JS/CSS）
  sh('yarn workspace panel build');
  fs.mkdirSync(path.join(SCRIPTS_DIR, 'panel'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'panel/dist/index.html'),
    path.join(SCRIPTS_DIR, 'panel/index.html'),
  );

  // 4. recorder → scripts/{recorder.py, runner.py, panel_state.py}
  for (const f of ['recorder.py', 'runner.py', 'panel_state.py']) {
    fs.copyFileSync(path.join(ROOT, 'recorder/src', f), path.join(SCRIPTS_DIR, f));
  }

  // 5. SKILL.md 渲染
  const tpl = fs.readFileSync(path.join(ROOT, 'skill-template/SKILL.md.tpl'), 'utf8');
  fs.writeFileSync(path.join(DIST, 'SKILL.md'), tpl.replace(/\{\{coverageMarkerVersion\}\}/g, cmPkg.version));

  console.log(`\n✓ skill 产物：${DIST}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Step 2：跑构建**

```bash
cd <repo> && yarn build:skill
ls dist/skills/react-component-upgrade
# 预期：SKILL.md + scripts/{scan.js, recorder.py, runner.py, panel_state.py, panel/index.html}
```

**Step 3：验证产物自洽**

```bash
cat dist/skills/react-component-upgrade/SKILL.md | grep -E "@your-org/coverage-marker@\^\d"
# 预期匹配到具体版本号（从 coverage-marker package.json 注入）

node dist/skills/react-component-upgrade/scripts/scan.js 2>&1 | head -3
# 预期：报"manifest.json not found"或类似（因为没指向状态目录），证明脚本可独立执行

python3 dist/skills/react-component-upgrade/scripts/recorder.py --dry-run 2>&1 | head -3
# 预期：报缺 STATE_DIR 或 manifest，证明 Python 脚本可独立执行
```

**Step 4：commit**

```bash
git -C <repo> add scripts && git -C <repo> commit -m "feat: build-skill.ts assembles distributable skill"
```

---

## 7. Phase 6 — 在 demo 仓库联调验证

### Task 7.1：发布 coverage-marker 到本地（yarn link）

**Step 1：在 monorepo 内 link**

```bash
cd <repo>/packages/coverage-marker && yarn link
```

**Step 2：在 demo 内 link 引用**

```bash
cd <demo> && yarn link "@your-org/coverage-marker"
```

**Step 3：在 demo 装 peerDeps（如缺）**

```bash
cd <demo> && yarn add -D @babel/core@^7.0.0
# react/react-dom 在 demo 中已有，无需重装
```

**Step 4：验证**

```bash
node -e "console.log(require.resolve('@your-org/coverage-marker'))"  # 应解析到 monorepo 的 dist
```

---

### Task 7.2：拷贝 skill 产物到 ~/.claude/skills/

```bash
mkdir -p ~/.claude/skills
cp -r <repo>/dist/skills/react-component-upgrade ~/.claude/skills/
ls ~/.claude/skills/react-component-upgrade
# 预期：SKILL.md + scripts/
```

---

### Task 7.3：在 demo 的 craco.config.js 接入

**Files:**
- Modify: `<demo>/craco.config.js`

按 SKILL.md 中的代码块原样追加 `loadCoverageTargetPackages` + `__coverageTargets` + 在 `babel.plugins` 数组中条件加入 plugin。

**Step：commit demo 改动**

```bash
git -C <demo> add craco.config.js package.json && git -C <demo> commit -m "chore: integrate @your-org/coverage-marker behind COVERAGE_MODE"
```

---

### Task 7.4：在 demo 准备 manifest.json + state-dir

```bash
mkdir -p <demo>/coverage-state
```

写 `<demo>/coverage-state/manifest.json`：

```json
{
  "baseUrl": "https://scepter-sit-eu.x-peng.com/main/smart-trains",
  "baseline": { "version": "<current-version-of-target-pkg>" },
  "runtime": {
    "targetPackages": ["<your-component-package>"],
    "playwrightProfile": "/Users/liuyunxia/.config/playwright-coverage",
    "proxy": "http://127.0.0.1:8899"
  }
}
```

> `targetPackages` 由用户根据本次升级的实际包名填写，**计划不写死任何具体值**。
>
> `baseUrl` 填浏览器真实访问的业务域名和路径前缀；本地 dev server 通过 whistle/Charles 等代理映射，不把 `baseUrl` 改成 `127.0.0.1`。`runtime.proxy` 填 Playwright Chromium 使用的代理服务地址；无需代理时为 `null`。

---

### Task 7.5：端到端跑通设计文档 §附录 7 步

**Step 1：scan**

```bash
cd <demo> && STATE_DIR=coverage-state node ~/.claude/skills/react-component-upgrade/scripts/scan.js --report
```

**Step 2：产物自洽校验**

```bash
python3 -c "
import json, os
sd = 'coverage-state'
t = json.load(open(f'{sd}/coverage-targets.json'))
c = json.load(open(f'{sd}/route-checklist.json'))
all_ids = {x['targetId'] for x in t['targets']}
mapped = set(sum([r['targetIds'] for r in c['selectedRoutes']], []))
assert all_ids == mapped | set(c['unmappedTargetIds']), 'targets 与 checklist 不闭合'
print('OK', len(all_ids), 'targets')
"
```

**Step 3：起 dev server（COVERAGE_MODE）**

```bash
cd <demo> && COVERAGE_MODE=1 BROWSER=none yarn start &
```

**Step 4：浏览器手测 marker**

打开 checklist 中任一 URL → DevTools Console：

```js
Array.from(window.__coverageMark__ || [])
```

通过标准：返回数组里至少有一个当前路由实际触发的 target id，且能对应到 `coverage-state/coverage-targets.json`。失败时先修 `@odc/coverage-marker` 注入，不进入 recorder。

**Step 5：起 recorder**

```bash
cd <demo> && STATE_DIR=coverage-state python3 ~/.claude/skills/react-component-upgrade/scripts/recorder.py
```

预期：弹出双窗口（业务页 + 面板）。按 SKILL.md 工作流操作：

- 目标组件触达后面板 `Current Detected` 增加
- Remaining 为空可直接 Confirm
- Remaining 非空时填写原因后可 Force Confirm
- 业务菜单未配置/不可达 route 填写原因后可 Skip
- Confirm/Skip 后自动跳下一路由

**Step 6：核对产物**

```bash
ls <demo>/coverage-state/runs/baseline-*/pages/
python3 -c "
import json, glob
for cov in glob.glob('coverage-state/runs/baseline-*/pages/*/coverage.json'):
    j = json.load(open(cov))
    assert j['reviewStatus'] in ('visual-ok', 'force-confirmed'), cov
    if j['reviewStatus'] == 'force-confirmed':
        assert j['remainingTargetIds'], f'{cov} force-confirmed 但无 remainingTargetIds'
        assert j.get('forceConfirmReason'), f'{cov} force-confirmed 但无原因'
print('all evidences OK')
"
```

**Step 7：phase=done 校验**

```bash
python3 -c "
import json
r = json.load(open('coverage-state/runtime-state.json'))
assert r['phase'] == 'done', r
for rid in r.get('skippedRouteIds', []):
    assert r.get('skippedRouteReasons', {}).get(rid), f'{rid} 缺 skip reason'
print('done')
"
```

**Step 8：commit demo 验收记录**

```bash
git -C <demo> add coverage-state && git -C <demo> commit -m "test: e2e MVP acceptance for coverage recorder"
```

---

## 8. 不在 MVP 范围（推迟 V0.2+）

来自设计文档 §1.3，不实现：

- spec 录制 / selectors.json
- console / network / errors / trace 采集
- coverage-report.md 自动生成
- 中断后自动续跑（当前只保证状态文件可读）
- query/variant 路由建模
- 更完整的面板 UI 美化

V0.2+ 启动前先把本计划全部 Task 走完。

---

## 9. 关键风险与缓解

| 风险 | 表现 | 缓解 |
|---|---|---|
| `@your-org/coverage-marker/runtime` 在 demo 编译时无法解析 | dev server 报 module not found | yarn link 是否正确指向 dist；webpack 5 的 `exports` 字段支持需确认；必要时 craco 加 `webpack.alias` |
| react 双副本导致 hooks 报错 | 业务页加载时 console 报 "Invalid hook call" | 确认 npm 包 peerDep 已声明、demo 仓库的 yarn 解析到唯一 react；检查 `yarn why react` 输出 |
| Playwright `expose_function` 在 file:// page 上不生效 | 点确认按钮无回调 | 先 expose 再 goto（Task 5.3 已遵循）；panel 已通过 vite-plugin-singlefile 输出单 HTML，无 ESM 跨文件 import，CORS 风险已消除 |
| 多目标包扫描时 import graph 体积爆炸 | scan 跑 > 30 秒 | 已内置基础缓解：`walkSourceFiles` 限定从 `<projectRoot>/src` 起步、跳过 `node_modules` / `__tests__` / `dist` / `build` / `.next` / `.d.ts`（Task 3.4）。如仍慢，V0.2+ 再做"按 routerEntries 反向推 + 缓存"|
| 贪心选路覆盖不到弹窗类目标 | `unmappedTargetIds` 非空 | 设计预期；记录到 unmapped 字段，靠人工在 Remaining 列表观察 + 手动跳路由 |
| dist/scan.js bundle 过大（含 typescript） | skill 包体 ~10 MB | MVP 阶段先全打进 bundle 换"用户侧零依赖"。skill 渐进加载机制下，10 MB 不阻塞。V0.2+ 若需要再做 `external: ['typescript']` + banner 注入借用宿主项目 typescript 的优化 |

---

## 10. 收尾里程碑

- ✅ Task 2.4：coverage-marker 构建产物可独立 require
- ✅ Task 3.8：scan.js bundle 单文件可执行
- ✅ Task 4.2：panel build 产出 index.html + main.js
- ✅ Task 5.3：recorder dry-run 写出初始 runtime-state.json
- ✅ Task 6.1：build-skill.ts 一键产出 dist/skills/react-component-upgrade/
- ✅ Task 7.5：在 demo 仓库走通设计文档 §附录 7 步

全部 ✅ 即视为 MVP 通过。

---

**计划已保存。两种执行方式：**

**1. Subagent-Driven（当前会话）** — 每个 Task 派发新 subagent，Task 之间复核，迭代速度快。

**2. 独立会话** — 你新开 Claude Code 会话进入 `<repo>` worktree，调用 `superpowers:executing-plans` 批量执行 + checkpoint。

请选择一种方式继续。
