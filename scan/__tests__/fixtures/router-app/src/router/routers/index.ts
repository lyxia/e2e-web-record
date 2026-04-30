import { lazy } from 'react';

const PaperIndex = lazy(() => import('@/pages/Paper/Index'));

export const routes = [
  { path: '/paper', component: PaperIndex },
  { path: '/course', component: lazy(() => import('@/pages/Course/List')) },
];
