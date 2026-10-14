import { useEffect, useMemo, useRef, useState } from "react";
import { basename } from "../lib/format";
import { ipc, type SearchMatch } from "../lib/ipc";
import { openFile } from "../lib/openFile";
import { focusedPaneId } from "../store/layout";
import { useFocusedProject } from "./FilesPanel";

/** Last search, kept while the navigator switches views. */
let last = { query: "", regex: false, caseSensitive: false };

function Line({ m }: { m: SearchMatch }) {
  const lead = m.text.length - m.text.trimStart().length;
  const start = Math.max(0, m.col - 1 - lead);
  const text = m.text.trimStart();
  // Keep the match in view on long lines.
  const cut = start > 40 ? start - 24 : 0;
  return (
    <span className="search-text">
      {cut > 0 && "…"}
      {text.slice(cut, start)}
      <mark>{text.slice(start, start + m.len)}</mark>
      {text.slice(start + m.len)}
    </span>
  );
}

/** ripgrep over the focused pane's project (⌥⌘F); a hit opens at its line in an editor pane. */
export function SearchPanel() {
  const { root } = useFocusedProject();
  const [query, setQuery] = useState(last.query);
  const [regex, setRegex] = useState(last.regex);
  const [caseSensitive, setCaseSensitive] = useState(last.caseSensitive);
  const [state, setState] = useState<{ matches: SearchMatch[]; error?: string; busy: boolean; ms?: number }>({ matches: [], busy: false });
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    last = { query, regex, caseSensitive };
    if (!root || !query.trim()) return setState({ matches: [], busy: false });
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, busy: true }));
      const t0 = performance.now();
      try {
        const matches = await ipc.searchProject(root, query, regex, caseSensitive);
        if (n === seq.current) setState({ matches, busy: false, ms: performance.now() - t0 });
      } catch (e) {
        if (n === seq.current) setState({ matches: [], busy: false, error: String(e) });
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [root, query, regex, caseSensitive]);

  const groups = useMemo(() => {
    const by = new Map<string, SearchMatch[]>();
    for (const m of state.matches) by.set(m.path, [...(by.get(m.path) ?? []), m]);
    return [...by.entries()];
  }, [state.matches]);

  const rel = (p: string) => (root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p);

  return (
    <div className="nav-files">
      <div className="search-box">
        <input
          ref={input}
          className="search-input"
          placeholder={root ? `Search ${basename(root)}` : "Focus a pane first"}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && state.matches[0]) void openFile(state.matches[0].path, state.matches[0].line, state.matches[0].col, { fromPane: focusedPaneId() });
          }}
        />
        <button className={`toggle${caseSensitive ? " on" : ""}`} title="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)}>
          Aa
        </button>
        <button className={`toggle${regex ? " on" : ""}`} title="Regular expression" aria-pressed={regex} onClick={() => setRegex(!regex)}>
          .*
        </button>
      </div>
      <div className="file-tree search-results">
        {state.error && <p className="empty">{state.error}</p>}
        {!state.error && query.trim() && !state.busy && !state.matches.length && <p className="empty">No matches.</p>}
        {groups.map(([path, ms]) => (
          <div key={path} className="search-group">
            <div className="search-file" title={path} onClick={() => void openFile(path, ms[0].line, ms[0].col, { fromPane: focusedPaneId() })}>
              <span className="file-name">{basename(path)}</span>
              <span className="search-dir">{rel(path).slice(0, -basename(path).length - 1)}</span>
              <span className="search-count">{ms.length}</span>
            </div>
            {ms.map((m) => (
              <div key={`${m.line}:${m.col}`} className="search-hit" onClick={() => void openFile(m.path, m.line, m.col, { fromPane: focusedPaneId() })}>
                <span className="search-ln">{m.line}</span>
                <Line m={m} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="nav-foot">
        {state.busy
          ? "Searching…"
          : state.matches.length
            ? `${state.matches.length}${state.matches.length >= 1000 ? "+" : ""} matches in ${groups.length} files · ${Math.round(state.ms ?? 0)} ms`
            : "ripgrep, respecting .gitignore · Enter opens the first hit"}
      </p>
    </div>
  );
}
