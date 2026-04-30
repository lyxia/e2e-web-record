import React from 'react';
import { render } from '@testing-library/react';
import { __CoverageMark } from '../src/runtime';

declare global {
  interface Window {
    __coverageMark__?: Set<string>;
  }
}

beforeEach(() => {
  delete window.__coverageMark__;
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
