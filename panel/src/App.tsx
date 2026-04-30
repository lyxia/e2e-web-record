import { useEffect, useState } from 'react';
import { subscribePanelState } from './bridge';
import type { PanelState, PanelTarget } from './types';

function formatTarget(target: PanelTarget): string {
  return `${target.importedName}  ${target.file}:${target.line}`;
}

export function App() {
  const [state, setState] = useState<PanelState | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [routeActionReason, setRouteActionReason] = useState('');

  useEffect(() => {
    return subscribePanelState(setState);
  }, []);

  useEffect(() => {
    setRouteActionReason('');
    setConfirmError(null);
  }, [state?.currentRoutePath]);

  if (!state) {
    return <div style={styles.shell}>Waiting for recorder.py...</div>;
  }

  const canConfirm = !!state.currentRoutePath && !confirming && !skipping;
  const canSkip = !!state.currentRoutePath && !confirming && !skipping;

  const handleConfirm = async () => {
    const confirmRoute = window.confirmRoute;
    if (!confirmRoute) {
      setConfirmError('Recorder confirm handler is not ready.');
      return;
    }

    let reason: string | undefined;
    if (state.currentRouteRemaining.length > 0) {
      if (!routeActionReason.trim()) {
        setConfirmError('Force confirm requires a reason while remaining targets exist.');
        return;
      }
      reason = routeActionReason.trim();
    }

    setConfirming(true);
    setConfirmError(null);
    try {
      await confirmRoute(reason);
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirming(false);
    }
  };

  const handleSkip = async () => {
    const skipRoute = window.skipRoute;
    if (!skipRoute) {
      setConfirmError('Recorder skip handler is not ready.');
      return;
    }
    if (!routeActionReason.trim()) {
      setConfirmError('Skip requires a reason.');
      return;
    }

    setSkipping(true);
    setConfirmError(null);
    try {
      await skipRoute(routeActionReason.trim());
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkipping(false);
    }
  };

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
        {state.currentRoutePath ? (
          <textarea
            value={routeActionReason}
            onChange={(event) => setRouteActionReason(event.target.value)}
            placeholder="Reason required for force confirm or skip"
            rows={3}
            style={styles.reasonInput}
          />
        ) : null}
      </section>

      <section>
        <h3 style={styles.heading}>Route Checklist</h3>
        <ul style={styles.list}>
          {state.routeChecklist.map((route) => {
            return (
              <li key={route.path}>
                [{route.skipped ? '-' : route.confirmed ? 'x' : ' '}] {route.path} ({route.confirmedCount}/
                {route.targetCount})
              </li>
            );
          })}
        </ul>
      </section>

      <div style={styles.actions}>
        <button
          disabled={!canConfirm}
          onClick={handleConfirm}
          style={{
            ...styles.button,
            opacity: canConfirm ? 1 : 0.45,
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
        >
          {confirming ? 'Confirming...' : 'Confirm current route'}
        </button>
        <button
          disabled={!canSkip}
          onClick={handleSkip}
          style={{
            ...styles.secondaryButton,
            opacity: canSkip ? 1 : 0.45,
            cursor: canSkip ? 'pointer' : 'not-allowed',
          }}
        >
          {skipping ? 'Skipping...' : 'Skip current route'}
        </button>
      </div>
      {confirmError ? <div style={styles.error}>{confirmError}</div> : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    boxSizing: 'border-box',
    color: '#202124',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    lineHeight: 1.45,
    minHeight: '100vh',
    padding: 16,
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
  secondaryButton: {
    background: '#fff',
    border: '1px solid #dadce0',
    borderRadius: 4,
    color: '#202124',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    marginTop: 14,
    padding: '8px 14px',
  },
  actions: {
    background: '#fff',
    bottom: 0,
    display: 'flex',
    gap: 8,
    padding: '12px 0 16px',
    position: 'sticky',
  },
  reasonInput: {
    border: '1px solid #dadce0',
    borderRadius: 4,
    boxSizing: 'border-box',
    color: '#202124',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    marginTop: 10,
    padding: 8,
    resize: 'vertical',
    width: '100%',
  },
  error: {
    color: '#b3261e',
    marginTop: 8,
  },
};
