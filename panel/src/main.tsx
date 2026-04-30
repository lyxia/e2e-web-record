import React from 'react';
import ReactDOM from 'react-dom';
import { App } from './App';
import './bridge';
import './global.css';
import type { PanelState } from './types';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);

if (import.meta.env.DEV) {
  const mockState: PanelState = {
    totalRuntimeTargets: 3,
    confirmedTotal: 0,
    currentDetected: [{ id: 'a', importedName: 'Widget', file: 'src/x.tsx', line: 1 }],
    currentRouteRemaining: [{ id: 'b', importedName: 'Modal', file: 'src/y.tsx', line: 9 }],
    currentRoutePath: '/p1',
    routeChecklist: [{ path: '/p1', confirmedCount: 0, targetCount: 2 }],
  };

  setTimeout(() => window.updatePanel(mockState), 100);
  window.confirmRoute = async () => {
    console.log('confirmed (dev mock)');
  };
  window.skipRoute = async (reason: string) => {
    console.log('skipped (dev mock)', reason);
  };
}
