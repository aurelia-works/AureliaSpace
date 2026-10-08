import { create } from "zustand";
import { ipc } from "../lib/ipc";

/** A task the account picker will hand to the new Claude pane as its first prompt. */
export interface PickerTask {
  project: string;
  id: string;
  title: string;
}

export type Mode = "agents" | "terminals";

/** What the left navigator shows: the workspace tree (⌘\), the files tree (⇧⌘F), or nothing. */
export type NavView = "projects" | "files" | null;

interface UiState {
  /** Title-bar mode: agent board or the tab/pane view (Review is the diff modal). */
  mode: Mode;
  agentPanelOpen: boolean;
  nav: NavView;
  settingsOpen: boolean;
  /** Section to show when Settings next opens (then cleared). */
  settingsSection: string | null;
  /** ⌘P command palette. */
  paletteOpen: boolean;
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
  mode: "terminals",
  agentPanelOpen: true,
  nav: "projects",
  settingsOpen: false,
  settingsSection: null,
  paletteOpen: false,
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
  mode?: Mode;
  agentPanelOpen?: boolean;
  nav?: NavView;
  /** Pre-redesign flags, read once so an existing ui.json keeps its sidebar state. */
  filesOpen?: boolean;
  sidebarOpen?: boolean;
  useWorktree?: boolean;
  fontDelta?: number;
}

export async function loadUiState() {
  const saved = await ipc.loadState<SavedUi>("ui").catch(() => null);
  if (saved) {
    useUi.setState({
      mode: saved.mode === "agents" ? "agents" : "terminals",
      agentPanelOpen: saved.agentPanelOpen ?? true,
      nav:
        saved.nav !== undefined
          ? saved.nav
          : saved.filesOpen
            ? "files"
            : saved.sidebarOpen === false
              ? null
              : "projects",
      useWorktree: saved.useWorktree ?? false,
      fontDelta: saved.fontDelta ?? 0,
    });
  }
  let last = "";
  useUi.subscribe((s) => {
    const next = JSON.stringify({
      mode: s.mode,
      agentPanelOpen: s.agentPanelOpen,
      nav: s.nav,
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
