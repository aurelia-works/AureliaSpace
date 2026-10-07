import { create } from "zustand";
import { shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { useLayout } from "./layout";

const MAX = 15;

interface RecentsState {
  /** Most recent first, deduped. */
  folders: string[];
  record(path: string): void;
  remove(path: string): void;
}

const clean = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export const useRecents = create<RecentsState>((set) => ({
  folders: [],
  record(path) {
    const p = clean(path.trim());
    if (!p) return;
    set((s) => (s.folders[0] === p ? s : { folders: [p, ...s.folders.filter((f) => f !== p)].slice(0, MAX) }));
  },
  remove: (path) => set((s) => ({ folders: s.folders.filter((f) => f !== path) })),
}));

/** Loads saved folders, then records every pane cwd that settles for a couple of seconds. */
export async function loadRecents() {
  const saved = await ipc.loadState<{ folders: string[] }>("recents").catch(() => null);
  if (Array.isArray(saved?.folders)) useRecents.setState({ folders: saved.folders.filter((f) => typeof f === "string").slice(0, MAX) });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  useRecents.subscribe((s, prev) => {
    if (s.folders === prev.folders) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ipc.saveState("recents", { folders: useRecents.getState().folders }).catch(() => {}), 400);
  });

  // Debounced per pane so `cd` hopping through directories doesn't flood the list.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  useLayout.subscribe((s, prev) => {
    if (s.panes === prev.panes) return;
    for (const [id, pane] of Object.entries(s.panes)) {
      if (!pane.cwd || pane.cwd === prev.panes[id]?.cwd) continue;
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          const cwd = useLayout.getState().panes[id]?.cwd;
          if (cwd && shortenPath(cwd) !== "~") useRecents.getState().record(cwd);
        }, 2000),
      );
    }
  });
}
