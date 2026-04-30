import path from 'path';
import { buildImportGraph, walkReachable } from '../src/buildImportGraph';
import { walkSourceFiles } from '../src/walkSourceFiles';

const projectRoot = path.join(__dirname, 'fixtures', 'graph-app');

function rel(file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

describe('buildImportGraph', () => {
  it('resolves alias, relative, dynamic, extension, and index imports', () => {
    const files = walkSourceFiles(path.join(projectRoot, 'src'));
    const graph = buildImportGraph(files, projectRoot);
    const page = path.join(projectRoot, 'src/pages/Page.tsx');

    expect((graph.get(page) ?? []).map(rel).sort()).toEqual([
      'src/components/Box/index.tsx',
      'src/components/Inline.tsx',
      'src/components/Relative.ts',
      'src/components/index.ts',
    ]);
  });

  it('walks reachable files without looping on cycles', () => {
    const files = walkSourceFiles(path.join(projectRoot, 'src'));
    const graph = buildImportGraph(files, projectRoot);
    const reachable = Array.from(walkReachable(graph, path.join(projectRoot, 'src/pages/Page.tsx'))).map(rel).sort();

    expect(reachable).toEqual([
      'src/components/Box/index.tsx',
      'src/components/Card.tsx',
      'src/components/Inline.tsx',
      'src/components/Relative.ts',
      'src/components/index.ts',
      'src/pages/Page.tsx',
    ]);
  });
});
