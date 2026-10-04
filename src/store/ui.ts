import { create } from "zustand";
import { ipc } from "../lib/ipc";

/** A task the account picker will hand to the new Claude pane as its first prompt. */
export interface PickerTask {
  project: string;
  id: string;
  title: string;
}

interface UiState {
  agentPanelOpen: boolean;
  filesOpen: boolean;
  settingsOpen: boolean;
  gridOpen: boolean;
  reviewOpen: boolean;
  /** "split" | "tab" — where the account picker will open the new Claude pane. */
  accountPicker: null | { target: "split" | "tab"; task?: PickerTask };
  /** Give new Claude panes their own git worktree. */
  useWorktree: boolean;
  toast: null | { text: string; error?: boolean; at: number };
  /** Pane whose command-suggestion bar is open. */
  suggestPaneId: string | null;
  fontDelta: number;
  windowFocused: boolean;

  set(patch: Partial<Omit<UiState, "set">>): void;
}

export const useUi = create<UiState>((set) => ({
  agentPanelOpen: true,
  filesOpen: false,
  settingsOpen: false,
  gridOpen: false,
  reviewOpen: false,
  accountPicker: null,
  useWorktree: false,
  toast: null,
  suggestPaneId: null,
  fontDelta: 0,
  windowFocused: document.hasFocus(),
  set: (patch) => set(patch),
}));

interface SavedUi {
  agentPanelOpen?: boolean;
  filesOpen?: boolean;
  useWorktree?: boolean;
  fontDelta?: number;
}

export async function loadUiState() {
  const saved = await ipc.loadState<SavedUi>("ui").catch(() => null);
  if (saved) {
    useUi.setState({
      agentPanelOpen: saved.agentPanelOpen ?? true,
      filesOpen: saved.filesOpen ?? false,
      useWorktree: saved.useWorktree ?? false,
      fontDelta: saved.fontDelta ?? 0,
    });
  }
  let last = "";
  useUi.subscribe((s) => {
    const next = JSON.stringify({
      agentPanelOpen: s.agentPanelOpen,
      filesOpen: s.filesOpen,
      useWorktree: s.useWorktree,
      fontDelta: s.fontDelta,
    });
    if (next !== last) {
      last = next;
      ipc.saveState("ui", JSON.parse(next)).catch(() => {});
    }
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, error = false) {
  useUi.getState().set({ toast: { text, error, at: Date.now() } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useUi.getState().set({ toast: null }), error ? 6000 : 3000);
}
