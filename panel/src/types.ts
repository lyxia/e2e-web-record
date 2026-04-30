export interface PanelTarget {
  id: string;
  importedName: string;
  file: string;
  line: number;
}

export interface PanelState {
  totalRuntimeTargets: number;
  confirmedTotal: number;
  currentDetected: PanelTarget[];
  currentRouteRemaining: PanelTarget[];
  currentRoutePath: string;
  routeChecklist: Array<{
    path: string;
    confirmedCount: number;
    targetCount: number;
  }>;
}

declare global {
  interface Window {
    updatePanel: (state: PanelState) => void;
    confirmRoute: () => Promise<void>;
  }
}

export {};
