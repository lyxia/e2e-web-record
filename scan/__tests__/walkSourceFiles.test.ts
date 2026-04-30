import fs from 'fs';
import os from 'os';
import path from 'path';
import { walkSourceFiles } from '../src/walkSourceFiles';

describe('walkSourceFiles', () => {
  it('returns source files and skips generated, test, hidden, and declaration paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-walk-'));
    const files = [
      'src/App.tsx',
      'src/lib/util.ts',
      'src/legacy.jsx',
      'src/types.d.ts',
      'src/__tests__/App.test.tsx',
      'src/node_modules/pkg/index.js',
      'src/dist/bundle.js',
      'src/build/out.js',
      'src/.cache/temp.ts',
      'src/.hidden/file.ts',
      'src/readme.md',
    ];

    for (const file of files) {
      const fullPath = path.join(root, file);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '');
    }

    const result = walkSourceFiles(path.join(root, 'src')).map((file) => path.relative(root, file).split(path.sep).join('/'));

    expect(result).toEqual(['src/App.tsx', 'src/legacy.jsx', 'src/lib/util.ts']);
  });
});
