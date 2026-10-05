import { useAgents, waitingAgents } from "../store/agents";
import { activeTab, focusedPaneId, paneIds, useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { toggleHud } from "./hudBridge";
import { clearTerminal, focusTerminal, getEntry, jumpBlock } from "./terminals";
import { toggleVoice } from "./voice";

/** Focuses the agent that has waited longest for you (needs input first). */
export function jumpToWaiting() {
  const current = focusedPaneId();
  const next = waitingAgents(useAgents.getState().sessions).find((s) => s.paneId !== current);
  if (!next) return false;
  useLayout.getState().focusPane(next.paneId);
  requestAnimationFrame(() => focusTerminal(next.paneId));
  return true;
}

type Dir = "left" | "right" | "up" | "down";

/** Moves focus to the nearest pane in a direction, using on-screen geometry. */
export function focusDirection(dir: Dir) {
  const tab = activeTab();
  if (!tab) return;
  const rectOf = (id: string) => document.querySelector(`[data-pane-id="${id}"]`)?.getBoundingClientRect();
  const cur = rectOf(tab.focusedPaneId);
  if (!cur) return;
  let best: { id: string; score: number } | undefined;
  for (const id of paneIds(tab.root)) {
    if (id === tab.focusedPaneId) continue;
    const r = rectOf(id);
    if (!r) continue;
    const horizontal = dir === "left" || dir === "right";
    const gap =
      dir === "left" ? cur.left - r.right : dir === "right" ? r.left - cur.right : dir === "up" ? cur.top - r.bottom : r.top - cur.bottom;
    if (gap < -4) continue; // not in that direction
    const overlap = horizontal
      ? Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top)
      : Math.min(cur.right, r.right) - Math.max(cur.left, r.left);
    const offAxis = horizontal
      ? Math.abs((cur.top + cur.bottom) / 2 - (r.top + r.bottom) / 2)
      : Math.abs((cur.left + cur.right) / 2 - (r.left + r.right) / 2);
    const score = gap + (overlap > 0 ? 0 : 10_000) + offAxis * 0.1;
    if (!best || score < best.score) best = { id, score };
  }
  if (best) useLayout.getState().focusPane(best.id);
}

export interface ShortcutHelp {
  keys: string;
  label: string;
}

export const shortcutHelp: ShortcutHelp[] = [
  { keys: "⌘T", label: "New tab (start screen)" },
  { keys: "⇧⌘1 / ⇧⌘2 / ⇧⌘3", label: "Agents / Terminals / Review mode" },
  { keys: "⌘D / ⇧⌘D", label: "Split right / down" },
  { keys: "⌘W / ⇧⌘W", label: "Close pane / tab" },
  { keys: "⌥⌘ ←↑↓→", label: "Focus pane in direction" },
  { keys: "⌘1…9, ⇧⌘[ ]", label: "Switch tab" },
  { keys: "⌘E / ⇧⌘E", label: "Claude pane as account (split / tab)" },
  { keys: "⌘G", label: "New grid tab (2–16 panes)" },
  { keys: "⌘J", label: "Jump to agent waiting on you" },
  { keys: "⇧⌘R", label: "Review changes, send comments to Claude" },
  { keys: "⇧⌘F", label: "Toggle files sidebar" },
  { keys: "⌘-click", label: "Open link or file:line in output" },
  { keys: "⌘I", label: "Suggest a command" },
  { keys: "⌘B", label: "Toggle agent panel" },
  { keys: "⌘\\", label: "Toggle projects sidebar" },
  { keys: "⇧⌘↑ / ⇧⌘↓", label: "Previous / next command block" },
  { keys: "⌘K", label: "Clear pane" },
  { keys: "⇧⌘H", label: "Toggle floating HUD (shows while you're in other apps)" },
  { keys: "⌥⌘V", label: "Dictate into the focused pane (Aurelia Voice)" },
  { keys: "⌘+ / ⌘- / ⌘0", label: "Font size" },
  { keys: "⌘,", label: "Settings" },
];

function isTextField(el: Element | null) {
  if (!el) return false;
  if (el.classList.contains("xterm-helper-textarea")) return false;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable;
}

export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!e.metaKey || e.ctrlKey) return;
    const layout = useLayout.getState();
    const ui = useUi.getState();
    const pane = focusedPaneId();
    const tab = activeTab();
    const shift = e.shiftKey;
    const alt = e.altKey;
    const cwd = pane ? layout.panes[pane]?.cwd : undefined;

    let action: (() => void) | undefined;
    switch (e.code) {
      case "KeyT":
        if (!shift && !alt) action = () => layout.newTab({ cwd, launcher: true });
        break;
      case "KeyD":
        if (pane && !alt) action = () => layout.splitPane(pane, shift ? "column" : "row");
        break;
      case "KeyW":
        if (!alt) action = () => (shift ? tab && layout.closeTab(tab.id) : pane && layout.closePane(pane));
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        const dir = e.code.slice(5).toLowerCase() as Dir;
        if (alt && !shift) action = () => focusDirection(dir);
        else if (shift && !alt && pane && (dir === "up" || dir === "down")) action = () => jumpBlock(pane, dir === "up" ? -1 : 1);
        break;
      }
      case "BracketLeft":
      case "BracketRight":
        if (shift) action = () => layout.cycleTab(e.code === "BracketLeft" ? -1 : 1);
        break;
      case "KeyE":
        if (!alt) action = () => ui.set({ accountPicker: { target: shift ? "tab" : "split" } });
        break;
      case "KeyI":
        if (!shift && !alt && pane) action = () => ui.set({ suggestPaneId: ui.suggestPaneId === pane ? null : pane });
        break;
      case "KeyG":
        if (!shift && !alt) action = () => ui.set({ gridOpen: true });
        break;
      case "KeyJ":
        if (!shift && !alt) action = () => jumpToWaiting();
        break;
      case "KeyR":
        if (shift && !alt) action = () => ui.set({ reviewOpen: true });
        break;
      case "KeyF":
        if (shift && !alt) action = () => ui.set({ filesOpen: !ui.filesOpen });
        break;
      case "KeyB":
        if (!shift && !alt) action = () => ui.set({ agentPanelOpen: !ui.agentPanelOpen });
        break;
      case "Backslash":
        if (!shift && !alt) action = () => ui.set({ sidebarOpen: !ui.sidebarOpen });
        break;
      case "KeyH":
        if (shift && !alt) action = () => toggleHud();
        break;
      case "KeyV":
        if (alt && !shift && pane) action = () => toggleVoice(pane);
        break;
      case "KeyK":
        if (!shift && !alt && pane) action = () => clearTerminal(pane);
        break;
      case "KeyA":
        if (!shift && !alt && pane && !isTextField(document.activeElement)) action = () => getEntry(pane)?.term.selectAll();
        break;
      case "Comma":
        if (!shift && !alt) action = () => ui.set({ settingsOpen: true });
        break;
      case "Equal":
        action = () => ui.set({ fontDelta: Math.min(ui.fontDelta + 1, 16) });
        break;
      case "Minus":
        action = () => ui.set({ fontDelta: Math.max(ui.fontDelta - 1, -6) });
        break;
      case "Digit0":
        action = () => ui.set({ fontDelta: 0 });
        break;
      default:
        if (shift && !alt && /^Digit[1-3]$/.test(e.code)) {
          const n = Number(e.code.slice(5));
          action = () => (n === 3 ? ui.set({ reviewOpen: true }) : ui.set({ mode: n === 1 ? "agents" : "terminals" }));
        } else if (/^Digit[1-9]$/.test(e.code) && !shift && !alt) {
          const n = Number(e.code.slice(5));
          action = () => layout.activateTabIndex(n === 9 ? -1 : n - 1);
        }
    }
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
