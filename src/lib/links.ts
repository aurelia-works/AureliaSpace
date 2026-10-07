import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ILink, Terminal } from "@xterm/xterm";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { isLocalUrl, openInBrowserPane } from "./browser";
import { ipc } from "./ipc";

/**
 * ⌘-click opens links, like iTerm: URLs in the browser, file references such as
 * `src/app.ts:42:7` in the editor. A plain click stays a plain click so selecting
 * text in Claude's output never opens anything by accident.
 */

// A path-ish token with an optional :line[:col]. Not preceded by a path or URL char,
// so `https://x/y` and the middle of longer tokens are skipped.
const PATH_RE = /(?<![\w/.~:@-])((?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+-]+)*\/?)(?::(\d+)(?::(\d+))?)?/g;
const MAX_PER_LINE = 24;

function looksLikePath(token: string) {
  return token.includes("/") || /\.[A-Za-z][\w]{0,9}$/.test(token);
}

/** Resolutions are cached briefly; hovering over output asks for each line again. */
const cache = new Map<string, string | null>();
setInterval(() => cache.clear(), 15_000);

async function resolveAll(cwd: string, tokens: string[]): Promise<(string | null)[]> {
  const missing = [...new Set(tokens.filter((t) => !cache.has(`${cwd}\0${t}`)))];
  if (missing.length) {
    const found = await ipc.resolvePaths(cwd, missing).catch(() => missing.map(() => null));
    missing.forEach((t, i) => cache.set(`${cwd}\0${t}`, found[i]));
  }
  return tokens.map((t) => cache.get(`${cwd}\0${t}`) ?? null);
}

/** A buffer line as text, plus the cell column of each UTF-16 unit (wide chars span 2 cells). */
function lineText(term: Terminal, y: number): { text: string; cols: number[] } | undefined {
  const line = term.buffer.active.getLine(y - 1);
  if (!line) return undefined;
  const cell = term.buffer.active.getNullCell();
  let text = "";
  const cols: number[] = [];
  for (let x = 0; x < line.length; x++) {
    line.getCell(x, cell);
    if (cell.getWidth() === 0) continue; // trailing half of a wide char
    const ch = cell.getChars() || " ";
    for (let k = 0; k < ch.length; k++) cols.push(x);
    text += ch;
  }
  return { text: text.trimEnd(), cols };
}

function paneCwd(paneId: string) {
  // Claude reports its own cwd, which can differ from the shell's.
  return useAgents.getState().sessions[paneId]?.cwd ?? useLayout.getState().panes[paneId]?.cwd;
}

export function installLinks(term: Terminal, paneId: string) {
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      if (!event.metaKey) return;
      // localhost links preview in a browser pane; hold ⌥ for the external browser.
      if (isLocalUrl(uri) && !event.altKey) openInBrowserPane(paneId, uri);
      else ipc.openUrl(uri).catch(() => {});
    }),
  );

  term.registerLinkProvider({
    provideLinks(y, callback) {
      const cwd = paneCwd(paneId);
      const lt = lineText(term, y);
      if (!cwd || !lt?.text) return callback(undefined);
      const { text: line, cols } = lt;

      const matches: { token: string; start: number; text: string; line?: number; col?: number }[] = [];
      for (const m of line.matchAll(PATH_RE)) {
        if (matches.length >= MAX_PER_LINE) break;
        const token = m[1].replace(/[.,]+$/, ""); // trailing sentence punctuation
        if (!looksLikePath(token)) continue;
        const text = m[2] && token === m[1] ? m[0] : token;
        matches.push({ token, start: m.index, text, line: m[2] ? Number(m[2]) : undefined, col: m[3] ? Number(m[3]) : undefined });
      }
      if (!matches.length) return callback(undefined);

      resolveAll(cwd, matches.map((m) => m.token)).then((resolved) => {
        const links: ILink[] = [];
        matches.forEach((m, i) => {
          const path = resolved[i];
          if (!path) return;
          links.push({
            text: m.text,
            // 1-based, inclusive cell columns.
            range: { start: { x: cols[m.start] + 1, y }, end: { x: cols[m.start + m.text.length - 1] + 1, y } },
            decorations: { underline: true, pointerCursor: true },
            activate(event) {
              if (event.metaKey) ipc.openPath(path, m.line, m.col).catch(() => {});
            },
          });
        });
        callback(links.length ? links : undefined);
      });
    },
  });
}
