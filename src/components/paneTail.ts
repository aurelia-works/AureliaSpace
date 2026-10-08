import { getEntry } from "../lib/terminals";

/** Box-drawing, prompt chrome and whitespace: lines made only of these carry no news. */
const CHROME = /[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝>❯›»·•…]/g;

/**
 * The last few meaningful lines on a pane's screen, for the board's live tail. Reads at
 * most one screen of the xterm buffer (cheap; no subscription, the caller re-reads on
 * its own tick). Skips TUI frame lines so Claude's input box doesn't fill the preview.
 */
export function paneTail(paneId: string, count = 3): string[] {
  const term = getEntry(paneId)?.term;
  if (!term) return [];
  const buf = term.buffer.active;
  const end = Math.min(buf.length, buf.baseY + term.rows);
  const out: string[] = [];
  for (let i = end - 1; i >= Math.max(0, end - term.rows) && out.length < count; i--) {
    const text = buf.getLine(i)?.translateToString(true) ?? "";
    if (text.replace(CHROME, "").length < 3) continue;
    if (/\?\s*for shortcuts|shift\+tab to cycle/i.test(text)) continue;
    out.push(text.replace(/^[\s│┃]+|[\s│┃]+$/g, "").slice(0, 160));
  }
  return out.reverse();
}
