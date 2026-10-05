import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useAgents } from "../store/agents";
import { getConfig } from "../store/config";
import { onPanesClosed, useLayout, type PaneMeta } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useUi } from "../store/ui";
import { BlockTracker } from "./blocks";
import { ipc } from "./ipc";
import { installLinks } from "./links";
import { terminalThemeFor } from "./palettes";
import { resolveDark } from "./theme";

/**
 * xterm instances live outside React so that re-parenting a pane (splitting, closing
 * a sibling) never loses terminal state: components just move `host` between
 * containers.
 */
export interface TermEntry {
  paneId: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  tracker: BlockTracker;
  webgl?: WebglAddon;
  opened: boolean;
  spawned: boolean;
  /** Typed into the shell once its first prompt appears (e.g. `claude`). */
  pendingInit?: string;
  sentSize?: { cols: number; rows: number };
}

const entries = new Map<string, TermEntry>();
const queuedInit = new Map<string, string>();
let webglCount = 0;

/** Overrides the command a new Claude pane types on its first prompt (default `claude`). */
export function queueInit(paneId: string, command: string) {
  queuedInit.set(paneId, command);
}

export const getEntry = (paneId: string) => entries.get(paneId);

function fontSize() {
  return Math.max(8, getConfig().terminal.fontSize + useUi.getState().fontDelta);
}

export function currentTerminalTheme() {
  const cfg = getConfig();
  return terminalThemeFor(cfg.palette, resolveDark(cfg.theme));
}

export function ensureTerminal(pane: PaneMeta): TermEntry {
  const existing = entries.get(pane.id);
  if (existing) return existing;

  const cfg = getConfig().terminal;
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: cfg.fontFamily,
    fontSize: fontSize(),
    lineHeight: cfg.lineHeight,
    scrollback: cfg.scrollback,
    macOptionIsMeta: cfg.optionAsMeta,
    macOptionClickForcesSelection: true,
    theme: currentTerminalTheme(),
    cursorBlink: true,
    cursorStyle: "bar",
    // Pushes the screen into scrollback on clear-screen so earlier blocks survive ^L.
    scrollOnEraseInDisplay: true,
    rescaleOverlappingGlyphs: true,
    drawBoldTextInBrightColors: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  installLinks(term, pane.id);

  const host = document.createElement("div");
  host.className = "term-host";

  const tracker = new BlockTracker(term);
  const entry: TermEntry = { paneId: pane.id, term, fit, host, tracker, opened: false, spawned: false };
  const runtime = useRuntime.getState();

  tracker.onCwd = (cwd) => useLayout.getState().updatePane(pane.id, { cwd });
  tracker.onPrompt = () => {
    if (!useRuntime.getState().panes[pane.id]?.integrated) runtime.patch(pane.id, { integrated: true });
    flushInit(entry);
  };
  tracker.onCommandStart = (b) => {
    runtime.patch(pane.id, { running: b.command });
    if (/^claude(\s|$)/.test(b.command)) {
      useAgents.getState().markStarting(pane.id, useLayout.getState().panes[pane.id]?.account);
    }
  };
  tracker.onCommandEnd = (b) => {
    runtime.patch(pane.id, { running: undefined, lastExit: b.exitCode });
    // Covers Claude exiting without a SessionEnd hook (crash, kill).
    if (/^claude(\s|$)/.test(b.command)) useAgents.getState().remove(pane.id);
  };

  term.onData((d) => {
    if (entry.spawned) ipc.ptyWrite(pane.id, d).catch(() => {});
  });
  term.onBinary((d) => {
    if (entry.spawned) ipc.ptyWriteBinary(pane.id, Array.from(d, (c) => c.charCodeAt(0) & 0xff)).catch(() => {});
  });
  term.onTitleChange((title) => runtime.patch(pane.id, { title }));

  if (pane.account || queuedInit.has(pane.id)) entry.pendingInit = queuedInit.get(pane.id) ?? "claude";
  queuedInit.delete(pane.id);
  entries.set(pane.id, entry);
  return entry;
}

function loadWebgl(entry: TermEntry) {
  if (webglCount >= getConfig().terminal.webglPaneLimit) return;
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      // Fall back to the DOM renderer rather than rendering nothing.
      addon.dispose();
      if (entry.webgl === addon) {
        entry.webgl = undefined;
        webglCount--;
      }
    });
    entry.term.loadAddon(addon);
    entry.webgl = addon;
    webglCount++;
  } catch {
    /* WebGL unavailable: DOM renderer */
  }
}

/** Moves the terminal into `container` (opening it on first use) and fits it. */
export function attachTerminal(paneId: string, container: HTMLElement) {
  const entry = entries.get(paneId);
  if (!entry) return;
  if (entry.host.parentElement !== container) container.appendChild(entry.host);
  if (!entry.opened) {
    entry.term.open(entry.host);
    entry.opened = true;
    const unicode = new Unicode11Addon();
    entry.term.loadAddon(unicode);
    entry.term.unicode.activeVersion = "11";
    loadWebgl(entry);
  }
  fitTerminal(paneId);
}

export function fitTerminal(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry || !entry.opened || !entry.host.isConnected) return;
  if (entry.host.clientWidth < 20 || entry.host.clientHeight < 10) return; // hidden tab
  const dims = entry.fit.proposeDimensions();
  if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 2 || dims.rows < 1) return;
  if (dims.cols !== entry.term.cols || dims.rows !== entry.term.rows) entry.term.resize(dims.cols, dims.rows);

  const { cols, rows } = entry.term;
  if (!entry.spawned) {
    spawn(entry, cols, rows);
  } else if (entry.sentSize?.cols !== cols || entry.sentSize?.rows !== rows) {
    entry.sentSize = { cols, rows };
    ipc.ptyResize(paneId, cols, rows).catch(() => {});
  }
}

function spawn(entry: TermEntry, cols: number, rows: number) {
  const pane = useLayout.getState().panes[entry.paneId];
  entry.spawned = true;
  entry.sentSize = { cols, rows };
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (buf) => entry.term.write(new Uint8Array(buf));
  ipc
    .ptySpawn({ paneId: entry.paneId, cwd: pane?.cwd, account: pane?.account, cols, rows, onData })
    .catch((err) => {
      entry.term.write(`\r\n\x1b[31m[AureliaSpace] could not start shell: ${err}\x1b[0m\r\n`);
    });
  // Shells without our integration never announce a prompt; don't wait forever.
  if (entry.pendingInit) setTimeout(() => flushInit(entry), 4000);
}

function flushInit(entry: TermEntry) {
  const cmd = entry.pendingInit;
  if (!cmd || !entry.spawned) return;
  entry.pendingInit = undefined;
  ipc.ptyWrite(entry.paneId, cmd + "\r").catch(() => {});
}

export function fitAllTerminals() {
  for (const id of entries.keys()) fitTerminal(id);
}

export function focusTerminal(paneId: string) {
  entries.get(paneId)?.term.focus();
}

export function writeToPane(paneId: string, data: string) {
  if (entries.get(paneId)?.spawned) ipc.ptyWrite(paneId, data).catch(() => {});
}

/** Brings a pane into view and gives it keyboard focus, from any mode. */
export function showPane(paneId: string) {
  useUi.getState().set({ mode: "terminals" });
  useLayout.getState().focusPane(paneId);
  requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(paneId)));
}

/** Types a message into a pane as one paste and submits it, without moving focus. */
export function submitToPane(paneId: string, text: string) {
  const entry = entries.get(paneId);
  if (!entry?.spawned) return false;
  const body = entry.term.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text.replace(/\s*\n\s*/g, " ");
  writeToPane(paneId, body);
  // Let the paste land before submitting it.
  setTimeout(() => writeToPane(paneId, "\r"), 120);
  return true;
}

/** Inserts text at the prompt without running it (bracketed paste when available). */
export function insertAtPrompt(paneId: string, text: string) {
  const entry = entries.get(paneId);
  if (!entry) return;
  const safe = entry.term.modes.bracketedPasteMode ? text : text.replace(/\s*\n\s*/g, " ");
  entry.term.paste(safe);
  entry.term.focus();
}

export function clearTerminal(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry) return;
  entry.term.clear();
  entry.tracker.clear();
}

/** Scrolls to the previous (-1) or next (+1) command block. */
export function jumpBlock(paneId: string, dir: -1 | 1) {
  const entry = entries.get(paneId);
  if (!entry) return;
  const top = entry.term.buffer.active.viewportY;
  const starts = entry.tracker.blocks
    .map((b) => entry.tracker.range(b)?.start)
    .filter((s): s is number => s !== undefined);
  const target = dir < 0 ? [...starts].reverse().find((s) => s < top) : starts.find((s) => s > top);
  if (target !== undefined) entry.term.scrollToLine(target);
  else if (dir > 0) entry.term.scrollToBottom();
}

export function applyAppearance() {
  const theme = currentTerminalTheme();
  const size = fontSize();
  const cfg = getConfig().terminal;
  for (const entry of entries.values()) {
    entry.term.options.theme = theme;
    entry.term.options.fontSize = size;
    entry.term.options.fontFamily = cfg.fontFamily;
    entry.term.options.lineHeight = cfg.lineHeight;
    entry.term.options.macOptionIsMeta = cfg.optionAsMeta;
    fitTerminal(entry.paneId);
  }
}

function destroyTerminal(paneId: string) {
  const entry = entries.get(paneId);
  entries.delete(paneId);
  ipc.ptyKill(paneId).catch(() => {});
  useAgents.getState().remove(paneId);
  useRuntime.getState().remove(paneId);
  if (!entry) return;
  if (entry.webgl) {
    entry.webgl.dispose();
    webglCount--;
  }
  entry.term.dispose();
  entry.host.remove();
}

onPanesClosed((ids) => ids.forEach(destroyTerminal));
