import fs from 'fs';
import os from 'os';
import path from 'path';
import { runScan } from '../src/runScan';

const projectRoot = path.join(__dirname, 'fixtures', 'mini-app');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

describe('runScan', () => {
  it('writes coverage targets, route checklist, and pages artifacts from one scan', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-output-'));

    const summary = runScan({
      projectRoot,
      outDir,
      baseUrl: 'http://x/',
      targetPackages: ['@example/ui'],
    });

    expect(summary).toEqual({
      pageCount: 2,
      targetCount: 3,
      selectedRouteCount: 2,
      unmappedTargetCount: 1,
    });

    const targets = readJson<any>(path.join(outDir, 'coverage-targets.json'));
    expect(targets.schemaVersion).toBe(1);
    expect(new Date(targets.scannedAt).toString()).not.toBe('Invalid Date');
    expect(targets.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'src/pages/P1.tsx#Widget#L4#C10',
          packageName: '@example/ui',
          importedName: 'Widget',
          localName: 'Widget',
          file: 'src/pages/P1.tsx',
          line: 4,
          column: 10,
          kind: 'runtime-jsx',
          routeCandidates: [{ routeId: 'p1', path: '/p1', url: 'http://x/p1' }],
          status: 'undetected',
          confirmedEvidenceId: null,
        }),
        expect.objectContaining({
          targetId: 'src/pages/P2.tsx#Modal#L4#C10',
          routeCandidates: [{ routeId: 'p2', path: '/p2', url: 'http://x/p2' }],
        }),
        expect.objectContaining({
          targetId: 'src/components/Unused.tsx#Tooltip#L4#C10',
          routeCandidates: [],
        }),
      ]),
    );

    const checklist = readJson<any>(path.join(outDir, 'route-checklist.json'));
    expect(checklist.schemaVersion).toBe(1);
    expect(checklist.selectedRoutes).toEqual([
      {
        routeId: 'p1',
        path: '/p1',
        url: 'http://x/p1',
        targetIds: ['src/pages/P1.tsx#Widget#L4#C10'],
        confirmedCount: 0,
        targetCount: 1,
      },
      {
        routeId: 'p2',
        path: '/p2',
        url: 'http://x/p2',
        targetIds: ['src/pages/P2.tsx#Modal#L4#C10'],
        confirmedCount: 0,
        targetCount: 1,
      },
    ]);
    expect(checklist.unmappedTargetIds).toEqual(['src/components/Unused.tsx#Tooltip#L4#C10']);

    const pages = readJson<any>(path.join(outDir, 'pages.json'));
    expect(pages).toMatchObject({
      schemaVersion: 1,
      config: { baseUrl: 'http://x/' },
      summary: { pageCount: 2, targetCount: 3, mappedTargetCount: 2 },
    });
    expect(pages.pages).toEqual([
      expect.objectContaining({
        id: 'p1',
        path: '/p1',
        urlTemplate: 'http://x/p1',
        resolvedUrl: 'http://x/p1',
        file: 'src/pages/P1.tsx',
        components: ['Widget'],
        risk: 'low',
        needsAuth: false,
        needsParams: false,
        params: {},
      }),
      expect.objectContaining({
        id: 'p2',
        path: '/p2',
        urlTemplate: 'http://x/p2',
        resolvedUrl: 'http://x/p2',
        file: 'src/pages/P2.tsx',
        components: ['Modal'],
      }),
    ]);
  });
});
