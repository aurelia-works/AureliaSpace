import { getEntry, writeToPane } from "./terminals";

export type PermissionChoice = "allow" | "always" | "deny";

interface Prompt {
  allow: string;
  always?: string;
}

const OPTION = /^\s*[❯>›»]?\s*(\d)[.)]\s+(.+?)\s*$/;
const ALWAYS = /don'?t ask again|allow all .*(session|time)|always allow|auto-accept/i;

/**
 * Claude Code's permission dialog is a numbered list ("1. Yes", "2. Yes, and don't ask
 * again…", "3. No, …"); detect it by reading the pane's bottom lines rather than
 * guessing from hook events, which don't carry the options.
 */
function readPrompt(paneId: string): Prompt | null {
  const term = getEntry(paneId)?.term;
  if (!term) return null;
  const buf = term.buffer.active;
  const end = Math.min(buf.length, buf.baseY + term.rows);
  const opts: { n: string; text: string }[] = [];
  for (let i = Math.max(0, end - 25); i < end; i++) {
    const m = OPTION.exec(buf.getLine(i)?.translateToString(true) ?? "");
    if (!m) continue;
    // A fresh "1." starts a new list; keep only the last dialog on screen.
    if (m[1] === "1") opts.length = 0;
    opts.push({ n: m[1], text: m[2] });
  }
  const yes = opts.find((o) => /^yes\b/i.test(o.text));
  if (!yes || !opts.some((o) => /^no\b/i.test(o.text))) return null;
  return { allow: yes.n, always: opts.find((o) => o !== yes && /^yes\b/i.test(o.text) && ALWAYS.test(o.text))?.n };
}

/** Which choices the prompt currently on screen in this pane offers, or null if none is showing. */
export function permissionOptions(paneId: string): { always: boolean } | null {
  const p = readPrompt(paneId);
  return p ? { always: !!p.always } : null;
}

/** Sends the keypress for `choice` to the pane. Returns false if no prompt was showing. */
export function answerPermission(paneId: string, choice: PermissionChoice): boolean {
  const p = readPrompt(paneId);
  if (!p) return false;
  const key = choice === "deny" ? "\x1b" : choice === "always" ? (p.always ?? p.allow) : p.allow;
  writeToPane(paneId, key);
  return true;
}
