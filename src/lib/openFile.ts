import { create } from "zustand";
import { useConfig } from "../store/config";
import { activeTab, paneIds, useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { ipc } from "./ipc";

/** Editor panes with unsaved changes, and a pending jump for a file that is already open. */
interface EditorsState {
  dirty: Record<string, boolean>;
  jump: Record<string, { path: string; line: number; col?: number; at: number }>;
  setDirty(paneId: string, dirty: boolean): void;
  takeJump(paneId: string): void;
}

export const useEditors = create<EditorsState>((set) => ({
  dirty: {},
  jump: {},
  setDirty: (paneId, dirty) => set((s) => (!!s.dirty[paneId] === dirty ? s : { dirty: { ...s.dirty, [paneId]: dirty } })),
  takeJump: (paneId) =>
    set((s) => {
      if (!s.jump[paneId]) return s;
      const jump = { ...s.jump };
      delete jump[paneId];
      return { jump };
    }),
}));

/**
 * Opens `path` (at line:col) in an editor pane: the tab's editor pane if it has this file
 * or no unsaved changes, else a new one split beside `fromPane`. Folders, binaries and
 * huge files go to the external editor, as does everything with "Open files in
 * AureliaSpace" off in Settings, or `external`.
 */
export async function openFile(path: string, line?: number, col?: number, opts: { fromPane?: string; external?: boolean } = {}) {
  const external = () => ipc.openPath(path, line, col).catch((e) => toast(String(e), true));
  if (opts.external || useConfig.getState().config?.openFilesInApp === false) return void external();
  if (!(await ipc.readTextFile(path).then(() => true, () => false))) return void external();

  const layout = useLayout.getState();
  const tab = (opts.fromPane && layout.tabs.find((t) => paneIds(t.root).includes(opts.fromPane!))) || activeTab();
  const editors = tab ? paneIds(tab.root).filter((id) => layout.panes[id]?.editor) : [];
  const dirty = useEditors.getState().dirty;
  const same = editors.find((id) => layout.panes[id]?.editor?.path === path);
  const reusable = same ?? editors.find((id) => !dirty[id]);
  const target = { path, line, col };
  if (reusable) {
    layout.updatePane(reusable, { editor: target });
    if (same && line) useEditors.setState((s) => ({ jump: { ...s.jump, [same]: { path, line, col, at: Date.now() } } }));
    layout.focusPane(reusable);
    return reusable;
  }
  const from = opts.fromPane ?? tab?.focusedPaneId;
  return from ? layout.splitPane(from, "row", { editor: target }) : layout.newTab({ editor: target });
}

/** Refuses once while `paneIds` hold unsaved edits; a second try within 4 s goes ahead. */
let armed: { key: string; at: number } | null = null;
function confirmDiscard(key: string, ids: string[]) {
  const dirty = useEditors.getState().dirty;
  if (ids.some((id) => dirty[id]) && !(armed?.key === key && Date.now() - armed.at < 4000)) {
    armed = { key, at: Date.now() };
    toast("Unsaved changes: ⌘S to save, or close again to discard them", true);
    return false;
  }
  armed = null;
  ids.forEach((id) => useEditors.getState().setDirty(id, false));
  return true;
}

export function closePaneSafely(paneId: string) {
  if (!confirmDiscard(paneId, [paneId])) return false;
  useLayout.getState().closePane(paneId);
  return true;
}

export function closeTabSafely(tabId: string) {
  const tab = useLayout.getState().tabs.find((t) => t.id === tabId);
  if (!tab || !confirmDiscard(tabId, paneIds(tab.root))) return false;
  useLayout.getState().closeTab(tabId);
  return true;
}
