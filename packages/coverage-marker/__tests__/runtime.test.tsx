import React from 'react';
import { render } from '@testing-library/react';
import { __CoverageMark } from '../src/runtime';

declare global {
  interface Window {
    __coverageMark__?: Set<string>;
    __coverageMarkCounts__?: Map<string, number>;
  }
}

beforeEach(() => {
  delete window.__coverageMark__;
  delete window.__coverageMarkCounts__;
});

const CoverageMark = __CoverageMark as React.ComponentType<{
  id: string;
  children: React.ReactNode;
}>;

test('mount adds id to window.__coverageMark__', () => {
  render(<CoverageMark id="src/x.tsx#Widget#L3">child</CoverageMark>);

  expect(window.__coverageMark__).toEqual(new Set(['src/x.tsx#Widget#L3']));
});

test('unmount deletes id', () => {
  const { unmount } = render(
    <CoverageMark id="src/x.tsx#Widget#L3">child</CoverageMark>,
  );

  unmount();

  expect(window.__coverageMark__).toEqual(new Set());
});

test('missing window.__coverageMark__ initializes Set', () => {
  expect(window.__coverageMark__).toBeUndefined();

  render(<CoverageMark id="src/x.tsx#Widget#L3">child</CoverageMark>);

  expect(window.__coverageMark__).toBeInstanceOf(Set);
});

test('keeps id while another instance with the same id remains mounted', () => {
  const first = render(<CoverageMark id="src/x.tsx#Widget#L3">first</CoverageMark>);
  const second = render(<CoverageMark id="src/x.tsx#Widget#L3">second</CoverageMark>);

  first.unmount();

  expect(window.__coverageMark__).toEqual(new Set(['src/x.tsx#Widget#L3']));

  second.unmount();

  expect(window.__coverageMark__).toEqual(new Set());
});

test('mirrors id to document.defaultView for sandboxed windows', () => {
  const realWindow = {} as Window;
  const originalDefaultView = document.defaultView;
  Object.defineProperty(document, 'defaultView', {
    configurable: true,
    value: realWindow,
  });

  try {
    const { unmount } = render(
      <CoverageMark id="src/x.tsx#Widget#L3">child</CoverageMark>,
    );

    expect(realWindow.__coverageMark__).toEqual(new Set(['src/x.tsx#Widget#L3']));

    unmount();

    expect(realWindow.__coverageMark__).toEqual(new Set());
  } finally {
    Object.defineProperty(document, 'defaultView', {
      configurable: true,
      value: originalDefaultView,
    });
  }
});
