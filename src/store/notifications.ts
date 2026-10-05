import { create } from "zustand";
import { notify } from "../lib/notify";
import { useConfig } from "./config";
import { activeTab, useLayout } from "./layout";
import { useUi } from "./ui";

export type NoticeKind = "finished" | "needs_input" | "permission" | "cache" | "limit" | "burn" | "error" | "info";

export interface NoticeAction {
  label: string;
  tone?: "primary" | "danger";
  /** Return false to keep the card open; anything else dismisses it. */
  run(): void | boolean;
}

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  body?: string;
  paneId?: string;
  at: number;
  /** Showing as a card. Goes false when it fades or is dismissed; it stays in history. */
  live: boolean;
  read: boolean;
  /** Stays on screen until dealt with instead of fading. */
  sticky: boolean;
  /** Show a reply box that types into `paneId`. */
  reply?: boolean;
  actions?: NoticeAction[];
  /** A new notice with the same key replaces the old one (e.g. one per pane per kind). */
  key?: string;
}

export type NoticeInput = Omit<Notice, "id" | "at" | "live" | "read" | "sticky"> & { sticky?: boolean };

const HISTORY = 60;
const FADE_MS = 6000;
/** Kinds that wait for you by default. */
const STICKY: NoticeKind[] = ["finished", "needs_input", "permission", "limit"];

interface NoticesState {
  notices: Notice[];
  push(input: NoticeInput): string;
  dismiss(id: string): void;
  /** Takes every live card for a pane off screen, optionally only some kinds. */
  resolvePane(paneId: string, kinds?: NoticeKind[]): void;
  markAllRead(): void;
  clear(): void;
}

let seq = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],

  push(input) {
    const id = `n${++seq}`;
    const sticky = input.sticky ?? STICKY.includes(input.kind);
    const notice: Notice = { ...input, id, at: Date.now(), live: true, read: false, sticky };
    set((s) => {
      const rest = input.key ? s.notices.filter((n) => n.key !== input.key) : s.notices;
      return { notices: [notice, ...rest].slice(0, HISTORY) };
    });
    if (!sticky) timers.set(id, setTimeout(() => get().dismiss(id), FADE_MS));
    return id;
  },

  dismiss(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set((s) => ({ notices: s.notices.map((n) => (n.id === id && n.live ? { ...n, live: false } : n)) }));
  },

  resolvePane(paneId, kinds) {
    const hit = (n: Notice) => n.live && n.paneId === paneId && (!kinds || kinds.includes(n.kind));
    if (!get().notices.some(hit)) return;
    set((s) => ({ notices: s.notices.map((n) => (hit(n) ? { ...n, live: false, read: true } : n)) }));
  },

  markAllRead() {
    if (get().notices.every((n) => n.read)) return;
    set((s) => ({ notices: s.notices.map((n) => (n.read ? n : { ...n, read: true })) }));
  },

  clear() {
    timers.forEach(clearTimeout);
    timers.clear();
    set({ notices: [] });
  },
}));

/** You're looking at this pane right now, so a card about it would be noise. */
export function isWatching(paneId?: string): boolean {
  return !!paneId && useUi.getState().windowFocused && useUi.getState().mode === "terminals" && activeTab()?.focusedPaneId === paneId;
}

/**
 * The one way to tell the user something. In-app card unless they're already looking
 * at the pane; macOS notification too when the window is in the background.
 */
export function alertUser(input: NoticeInput & { desktop?: boolean }) {
  const { desktop = true, ...notice } = input;
  if (isWatching(notice.paneId)) return;
  useNotices.getState().push(notice);
  if (desktop && !useUi.getState().windowFocused && useConfig.getState().config?.notifications !== false) {
    void notify(notice.title, notice.body ?? "");
  }
}

/** Focusing a pane (with the window focused) clears its cards. */
export function trackNoticeFocus() {
  const check = () => {
    const pane = activeTab()?.focusedPaneId;
    if (pane && isWatching(pane)) useNotices.getState().resolvePane(pane);
  };
  useLayout.subscribe(check);
  useUi.subscribe((s, prev) => (s.windowFocused !== prev.windowFocused || s.mode !== prev.mode) && check());
}
