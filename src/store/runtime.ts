import { create } from "zustand";

/** Live, non-persisted per-pane state reported by the terminal. */
export interface PaneRuntime {
  running?: string;
  lastExit?: number;
  title?: string;
  integrated?: boolean;
}

interface RuntimeState {
  panes: Record<string, PaneRuntime>;
  patch(paneId: string, patch: Partial<PaneRuntime>): void;
  remove(paneId: string): void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  panes: {},
  patch: (paneId, patch) =>
    set((s) => ({ panes: { ...s.panes, [paneId]: { ...s.panes[paneId], ...patch } } })),
  remove: (paneId) =>
    set((s) => {
      const panes = { ...s.panes };
      delete panes[paneId];
      return { panes };
    }),
}));
