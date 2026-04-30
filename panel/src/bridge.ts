import type { PanelState } from './types';

let latestState: PanelState | null = null;
let listener: ((state: PanelState) => void) | null = null;

window.updatePanel = (state: PanelState) => {
  latestState = state;
  listener?.(state);
};

export function subscribePanelState(next: (state: PanelState) => void): () => void {
  listener = next;
  if (latestState) {
    next(latestState);
  }

  return () => {
    if (listener === next) {
      listener = null;
    }
  };
}
