import path from 'path';
import { parseRouter } from '../src/parseRouter';

const fixtureRoot = path.join(__dirname, 'fixtures', 'router-app');

describe('parseRouter', () => {
  it('extracts lazy variable route component imports', () => {
    const routes = parseRouter([path.join(fixtureRoot, 'src/router/routers/index.ts')]);

    expect(routes).toContainEqual({
      path: '/paper',
      componentImportPath: '@/pages/Paper/Index',
      file: path.join(fixtureRoot, 'src/router/routers/index.ts'),
    });
  });

  it('extracts inline lazy route component imports', () => {
    const routes = parseRouter([path.join(fixtureRoot, 'src/router/routers/index.ts')]);

    expect(routes).toContainEqual({
      path: '/course',
      componentImportPath: '@/pages/Course/List',
      file: path.join(fixtureRoot, 'src/router/routers/index.ts'),
    });
  });
});
