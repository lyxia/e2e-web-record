import { useEffect, useState } from 'react';
import type { PanelState, PanelTarget } from './types';

function formatTarget(target: PanelTarget): string {
  return `${target.importedName}  ${target.file}:${target.line}`;
}

export function App() {
  const [state, setState] = useState<PanelState | null>(null);

  useEffect(() => {
    window.updatePanel = setState;
  }, []);

  if (!state) {
    return <div style={styles.shell}>Waiting for recorder.py...</div>;
  }

  const canConfirm = state.currentRouteRemaining.length === 0;

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div>
          targets {state.totalRuntimeTargets} | confirmed {state.confirmedTotal}
        </div>
        <div>route {state.currentRoutePath}</div>
      </header>

      <section>
        <h3 style={styles.heading}>Current Detected ({state.currentDetected.length})</h3>
        <ul style={styles.list}>
          {state.currentDetected.map((target) => (
            <li key={target.id}>{formatTarget(target)}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3 style={styles.heading}>Remaining current route ({state.currentRouteRemaining.length})</h3>
        <ul style={styles.list}>
          {state.currentRouteRemaining.map((target) => (
            <li key={target.id}>{formatTarget(target)}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3 style={styles.heading}>Route Checklist</h3>
        <ul style={styles.list}>
          {state.routeChecklist.map((route) => {
            const complete = route.confirmedCount === route.targetCount;

            return (
              <li key={route.path}>
                [{complete ? 'x' : ' '}] {route.path} ({route.confirmedCount}/{route.targetCount})
              </li>
            );
          })}
        </ul>
      </section>

      <button
        disabled={!canConfirm}
        onClick={() => window.confirmRoute()}
        style={{
          ...styles.button,
          opacity: canConfirm ? 1 : 0.45,
          cursor: canConfirm ? 'pointer' : 'not-allowed',
        }}
      >
        Confirm current route
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    color: '#202124',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    lineHeight: 1.45,
    margin: 16,
  },
  header: {
    borderBottom: '1px solid #d9dce1',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 12,
    paddingBottom: 12,
  },
  heading: {
    fontSize: 14,
    margin: '14px 0 6px',
  },
  list: {
    margin: 0,
    paddingLeft: 18,
  },
  button: {
    background: '#1a73e8',
    border: 0,
    borderRadius: 4,
    color: '#fff',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    marginTop: 14,
    padding: '8px 14px',
  },
};
