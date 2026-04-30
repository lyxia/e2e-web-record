import { useEffect, ReactNode } from 'react';

declare global {
  interface Window {
    __coverageMark__?: Set<string>;
    __coverageMarkCounts__?: Map<string, number>;
  }
}

export function __CoverageMark({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const windows = Array.from(
      new Set(
        [window, document.defaultView].filter(Boolean) as Window[],
      ),
    );
    for (const w of windows) {
      if (!w.__coverageMark__) {
        w.__coverageMark__ = new Set();
        w.__coverageMarkCounts__ = new Map();
      }
      const counts = (w.__coverageMarkCounts__ ??= new Map());
      counts.set(id, (counts.get(id) ?? 0) + 1);
      w.__coverageMark__.add(id);
    }

    return () => {
      for (const w of windows) {
        const counts = (w.__coverageMarkCounts__ ??= new Map());
        const next = (counts.get(id) ?? 1) - 1;
        if (next <= 0) {
          counts.delete(id);
          w.__coverageMark__?.delete(id);
        } else {
          counts.set(id, next);
        }
      }
    };
  }, [id]);

  return children as any;
}
