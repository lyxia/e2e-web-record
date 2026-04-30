import { lazy } from 'react';

const P1 = lazy(() => import('@/pages/P1'));

export const routes = [
  { path: '/p1', component: P1 },
  { path: '/p2', component: lazy(() => import('@/pages/P2')) },
];
