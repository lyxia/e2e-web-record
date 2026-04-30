import { useEffect, ReactNode } from 'react';

declare global {
  interface Window {
    __coverageMark__?: Set<string>;
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
    const w = window as Window;
    (w.__coverageMark__ ??= new Set()).add(id);
    return () => {
      w.__coverageMark__?.delete(id);
    };
  }, [id]);

  return children as any;
}
