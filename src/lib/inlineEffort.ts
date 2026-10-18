import { create } from "zustand";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { canPickEffort, currentEffort, recordPick, setSessionEffort } from "./effort";
import { ipc } from "./ipc";
import { screenText, submitToPane, writeToPane } from "./terminals";

/**
 * Auto effort for prompts typed straight into Claude Code, no composer needed. Keystrokes a
 * Claude pane sends at its idle prompt are mirrored here; on Enter, lib/effort picks a level
 * and, when it differs, the input is erased, `/effort` is switched for the session, and the
 * same text is submitted. A keystroke that can't be mirrored exactly (arrows, history, Esc)
 * turns this off until the next submit, so the prompt itself is never altered.
 */

/** What is in each pane's Claude input box; null once it can't be known exactly. */
const typed = new Map<string, string | null>();
/** Keystrokes typed while a pick is in flight, replayed after the submit. */
const held = new Map<string, string[]>();

/** Panes whose Enter is waiting on the effort pick (shown on the pane header). */
export const useInlinePicking = create<{ panes: Record<string, true> }>(() => ({ panes: {} }));

function setPicking(paneId: string, on: boolean) {
  useInlinePicking.setState((s) => {
    const panes = { ...s.panes };
    if (on) panes[paneId] = true;
    else delete panes[paneId];
    return { panes };
  });
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
/** Backspace may remove these as a group, so the erase count can't be trusted. */
const CLUSTERED = /[̀-ͯ‍️]|\p{Extended_Pictographic}/u;
/** Slash commands, bash mode and memory notes: never touched. */
const SPECIAL = /^\s*[/!#]/;

function track(paneId: string, data: string) {
  let cur: string | null = typed.has(paneId) ? typed.get(paneId)! : "";
  // Keys for a permission dialog or a starting session never reach the input box as text.
  const status = useAgents.getState().sessions[paneId]?.status;
  if (status === "needs_input" || status === "starting") return typed.set(paneId, null);
  if (data === "\x03") cur = ""; // ^C clears Claude's input
  else if (cur === null) return;
  else if (data.startsWith(PASTE_START) && data.endsWith(PASTE_END)) cur += data.slice(PASTE_START.length, -PASTE_END.length).replace(/\r\n?/g, "\n");
  else if (data === "\x1b\r") cur += "\n"; // ⌥Enter: newline
  else if (data === "\x7f" || data === "\b") cur = [...cur].slice(0, -1).join("");
  else if (/^[^\x00-\x1f\x7f]+$/.test(data)) cur += data;
  else cur = null;
  typed.set(paneId, cur);
}

/** Box-drawing edges and padding around Claude Code's input lines. */
const edge = (line: string) => line.replace(/^[\s│┃|]+|[\s│┃|]+$/g, "");

/**
 * True when Claude's input box on screen shows exactly `text`: the prompt line is the marker
 * plus its first line and the next lines follow. Anything else (a stale mirror, a collapsed
 * paste, wrapped lines) means hands off.
 */
function inputMatches(paneId: string, text: string): boolean {
  const want = text.split("\n").map((l) => l.trimEnd());
  const screen = screenText(paneId).split("\n").map(edge);
  for (let i = screen.length - 1; i >= 0; i--) {
    if (screen[i] !== `> ${want[0]}`.trimEnd() && screen[i] !== `❯ ${want[0]}`.trimEnd()) continue;
    return want.every((l, k) => k === 0 || screen[i + k]?.trim() === l.trim());
  }
  return false;
}

const isClaudePane = (paneId: string) => !!useLayout.getState().panes[paneId]?.account || !!useAgents.getState().sessions[paneId];

/** Called with every keystroke a terminal sends; true when it was consumed here. */
export function interceptInput(paneId: string, data: string): boolean {
  const queue = held.get(paneId);
  if (queue) {
    queue.push(data);
    return true;
  }
  if (!isClaudePane(paneId)) return false;
  if (data !== "\r") {
    track(paneId, data);
    return false;
  }
  const text = typed.get(paneId);
  typed.set(paneId, "");
  // Claude Code takes a trailing backslash + Enter as a newline, not a submit.
  if (text?.endsWith("\\")) {
    typed.set(paneId, `${text.slice(0, -1)}\n`);
    return false;
  }
  if (!text?.trim() || SPECIAL.test(text) || CLUSTERED.test(text) || !canPickEffort(paneId)) return false;
  held.set(paneId, []);
  void pickAndSubmit(paneId, text);
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickAndSubmit(paneId: string, text: string) {
  setPicking(paneId, true);
  try {
    const account = useLayout.getState().panes[paneId]?.account ?? null;
    const pick = await ipc.chooseEffort(account, text, true).catch(() => null);
    const want = pick?.level && pick.level !== currentEffort(paneId) ? pick.level : null;
    if (!want) {
      writeToPane(paneId, "\r");
      if (pick) recordPick(paneId, pick, false);
      return;
    }
    if (!inputMatches(paneId, text)) {
      writeToPane(paneId, "\r");
      return;
    }
    // One backspace per character, plus spares: extra ones on an empty prompt do nothing.
    writeToPane(paneId, "\x7f".repeat([...text].length + 2));
    await sleep(80);
    const switched = await setSessionEffort(paneId, want);
    submitToPane(paneId, text);
    recordPick(paneId, pick!, switched);
    // submitToPane presses Enter a beat after the paste; held keys belong to the next prompt.
    await sleep(200);
  } finally {
    setPicking(paneId, false);
    const queue = held.get(paneId) ?? [];
    held.delete(paneId);
    for (const d of queue) if (!interceptInput(paneId, d)) writeToPane(paneId, d);
  }
}

/** A pane closed or its Claude ended: forget what was typed there. */
export function forgetInput(paneId: string) {
  typed.delete(paneId);
}
