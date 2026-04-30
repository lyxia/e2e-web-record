import fs from 'fs';
import path from 'path';

const SKIPPED_DIRS = new Set(['node_modules', '__tests__', 'dist', 'build', '.next', '.cache']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export function walkSourceFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && isSourceFile(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results.sort();
}

function shouldSkipDirectory(name: string): boolean {
  return SKIPPED_DIRS.has(name) || name.startsWith('.');
}

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(name)) && !name.endsWith('.d.ts');
}
