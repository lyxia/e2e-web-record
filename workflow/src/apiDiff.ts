import fs from 'fs';
import path from 'path';

export interface RunApiDiffOptions {
  stateDir: string;
  baselineRoot: string;
  afterRoot: string;
  targetPackages: string[];
}

export interface ApiDiffSummary {
  packageCount: number;
  fileCount: number;
  redCount: number;
  yellowCount: number;
  greenCount: number;
  impactedRouteCount: number;
}

interface FileDiff {
  packageName: string;
  filePath: string;
  beforeLines: string[];
  afterLines: string[];
  added: string[];
  removed: string[];
  changes: ApiChange[];
}

interface ApiChange {
  severity: 'red' | 'yellow' | 'green';
  description: string;
  member?: string;
  componentName?: string;
}

interface PageEntry {
  id: string;
  path?: string;
  components?: string[];
  file?: string | null;
}

const DTS_SUBDIRS = ['lib', 'es', 'dist', 'types'];

export function runApiDiff(options: RunApiDiffOptions): ApiDiffSummary {
  const fileDiffs: FileDiff[] = [];

  for (const pkg of options.targetPackages) {
    const baselinePkg = path.join(options.baselineRoot, 'node_modules', pkg);
    const afterPkg = path.join(options.afterRoot, 'node_modules', pkg);
    if (!fs.existsSync(baselinePkg) || !fs.existsSync(afterPkg)) continue;

    const baselineFiles = collectDtsFiles(baselinePkg);
    const afterFiles = collectDtsFiles(afterPkg);
    const allKeys = new Set<string>([...Array.from(baselineFiles.keys()), ...Array.from(afterFiles.keys())]);

    for (const relFile of Array.from(allKeys).sort()) {
      const beforeText = baselineFiles.get(relFile) ?? '';
      const afterText = afterFiles.get(relFile) ?? '';
      if (beforeText === afterText) continue;
      fileDiffs.push(diffFile(pkg, relFile, beforeText, afterText));
    }
  }

  const pages = readPages(options.stateDir);
  const componentToRoutes = buildComponentRouteIndex(pages);
  const impacted = collectImpacts(fileDiffs, componentToRoutes);

  const apiDiffDir = path.join(options.stateDir, 'api-diff');
  fs.mkdirSync(apiDiffDir, { recursive: true });
  fs.writeFileSync(path.join(apiDiffDir, 'dts-diff.md'), renderDtsDiff(fileDiffs));
  fs.writeFileSync(path.join(apiDiffDir, 'dts-impact.md'), renderDtsImpact(impacted));

  let red = 0;
  let yellow = 0;
  let green = 0;
  for (const fd of fileDiffs) {
    for (const change of fd.changes) {
      if (change.severity === 'red') red += 1;
      else if (change.severity === 'yellow') yellow += 1;
      else green += 1;
    }
  }

  return {
    packageCount: options.targetPackages.length,
    fileCount: fileDiffs.length,
    redCount: red,
    yellowCount: yellow,
    greenCount: green,
    impactedRouteCount: new Set(impacted.flatMap((entry) => entry.routes)).size,
  };
}

function collectDtsFiles(pkgRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const sub of DTS_SUBDIRS) {
    const dir = path.join(pkgRoot, sub);
    if (!fs.existsSync(dir)) continue;
    walk(dir, (file) => {
      if (file.endsWith('.d.ts')) {
        const rel = path.relative(pkgRoot, file).split(path.sep).join('/');
        out.set(rel, fs.readFileSync(file, 'utf8'));
      }
    });
  }
  return out;
}

function walk(dir: string, cb: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else if (entry.isFile()) cb(full);
  }
}

function diffFile(packageName: string, filePath: string, beforeText: string, afterText: string): FileDiff {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const beforeSet = new Set(beforeLines.map((l) => l.trim()).filter(Boolean));
  const afterSet = new Set(afterLines.map((l) => l.trim()).filter(Boolean));
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of afterLines) {
    const trimmed = line.trim();
    if (trimmed && !beforeSet.has(trimmed)) added.push(trimmed);
  }
  for (const line of beforeLines) {
    const trimmed = line.trim();
    if (trimmed && !afterSet.has(trimmed)) removed.push(trimmed);
  }

  const componentName = inferComponentName(filePath);
  const changes = classify(componentName, added, removed);

  return { packageName, filePath, beforeLines, afterLines, added, removed, changes };
}

function inferComponentName(filePath: string): string | undefined {
  const base = path.basename(filePath).replace(/\.d\.ts$/, '');
  if (!base || /^index$/i.test(base)) return undefined;
  return base;
}

function classify(componentName: string | undefined, added: string[], removed: string[]): ApiChange[] {
  const changes: ApiChange[] = [];

  for (const line of removed) {
    const propMatch = line.match(/^(\w+)\??:\s*(.+);$/);
    if (propMatch) {
      changes.push({
        severity: 'red',
        description: `removed prop \`${propMatch[1]}\` (was ${propMatch[2].replace(/;$/, '')})`,
        member: propMatch[1],
        componentName,
      });
      continue;
    }
    if (/^export\s+(declare\s+)?(function|class|const|interface)/.test(line)) {
      changes.push({
        severity: 'red',
        description: `removed export: ${line}`,
        componentName,
      });
      continue;
    }
  }

  for (const line of added) {
    const requiredProp = line.match(/^(\w+):\s*(.+);$/);
    if (requiredProp) {
      changes.push({
        severity: 'red',
        description: `added required prop \`${requiredProp[1]}\` (${requiredProp[2].replace(/;$/, '')})`,
        member: requiredProp[1],
        componentName,
      });
      continue;
    }
    const optionalProp = line.match(/^(\w+)\?:\s*(.+);$/);
    if (optionalProp) {
      changes.push({
        severity: 'green',
        description: `added optional prop \`${optionalProp[1]}\` (${optionalProp[2].replace(/;$/, '')})`,
        member: optionalProp[1],
        componentName,
      });
      continue;
    }
  }

  for (const line of removed) {
    const propMatch = line.match(/^(\w+)\??:\s*(.+);$/);
    if (!propMatch) continue;
    const propName = propMatch[1];
    const beforeType = propMatch[2].replace(/;$/, '');
    const afterCounterpart = added.find((a) => {
      const m = a.match(/^(\w+)\??:\s*(.+);$/);
      return m && m[1] === propName;
    });
    if (!afterCounterpart) continue;
    const afterMatch = afterCounterpart.match(/^(\w+)\??:\s*(.+);$/);
    if (!afterMatch) continue;
    const afterType = afterMatch[2].replace(/;$/, '');
    const beforeMembers = parseUnion(beforeType);
    const afterMembers = parseUnion(afterType);
    if (beforeMembers && afterMembers && beforeMembers.length > afterMembers.length) {
      const lost = beforeMembers.filter((m) => !afterMembers.includes(m));
      changes.push({
        severity: 'yellow',
        description: `union narrowed for \`${propName}\`: lost ${lost.join(', ')}`,
        member: propName,
        componentName,
      });
    }
  }

  return changes;
}

function parseUnion(type: string): string[] | null {
  if (!type.includes('|')) return null;
  return type.split('|').map((m) => m.trim()).filter(Boolean);
}

function readPages(stateDir: string): PageEntry[] {
  const pagesPath = path.join(stateDir, 'pages.json');
  if (!fs.existsSync(pagesPath)) return [];
  const data = JSON.parse(fs.readFileSync(pagesPath, 'utf8')) as { pages?: PageEntry[] };
  return Array.isArray(data.pages) ? data.pages : [];
}

function buildComponentRouteIndex(pages: PageEntry[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const page of pages) {
    const components = Array.isArray(page.components) ? page.components : [];
    for (const component of components) {
      const list = out.get(component) ?? [];
      list.push(page.id);
      out.set(component, list);
    }
  }
  return out;
}

interface ImpactedEntry {
  componentName: string;
  routes: string[];
  changes: ApiChange[];
}

function collectImpacts(fileDiffs: FileDiff[], componentToRoutes: Map<string, string[]>): ImpactedEntry[] {
  const map = new Map<string, ImpactedEntry>();
  for (const fd of fileDiffs) {
    for (const change of fd.changes) {
      const componentName = change.componentName ?? '<global>';
      const routes = componentToRoutes.get(componentName) ?? [];
      const entry = map.get(componentName) ?? { componentName, routes: [], changes: [] };
      for (const route of routes) {
        if (!entry.routes.includes(route)) entry.routes.push(route);
      }
      entry.changes.push(change);
      map.set(componentName, entry);
    }
  }
  return Array.from(map.values());
}

function renderDtsDiff(fileDiffs: FileDiff[]): string {
  if (fileDiffs.length === 0) return '# d.ts diff\n\nNo differences detected.\n';
  const lines = ['# d.ts diff', ''];
  for (const fd of fileDiffs) {
    lines.push(`## ${fd.packageName}/${fd.filePath}`);
    if (fd.removed.length > 0) {
      lines.push('### Removed');
      for (const line of fd.removed) lines.push(`- ${line}`);
    }
    if (fd.added.length > 0) {
      lines.push('### Added');
      for (const line of fd.added) lines.push(`- ${line}`);
    }
    if (fd.changes.length > 0) {
      lines.push('### Changes');
      for (const change of fd.changes) {
        const tag = change.severity.toUpperCase();
        lines.push(`- [${tag}] ${change.description}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderDtsImpact(impacts: ImpactedEntry[]): string {
  if (impacts.length === 0) return '# d.ts impact\n\nNo impacted components.\n';
  const lines = ['# d.ts impact', ''];
  for (const entry of impacts) {
    lines.push(`## ${entry.componentName}`);
    if (entry.routes.length === 0) {
      lines.push('- Affected routes: (none mapped)');
    } else {
      lines.push(`- Affected routes: ${entry.routes.join(', ')}`);
    }
    for (const change of entry.changes) {
      lines.push(`  - [${change.severity.toUpperCase()}] ${change.description}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
