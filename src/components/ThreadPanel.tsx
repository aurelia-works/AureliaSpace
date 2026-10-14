import { useEffect, useMemo, useRef, useState } from "react";
import { ipc, type ThreadItem } from "../lib/ipc";
import { openFile } from "../lib/openFile";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";

const MAX_ITEMS = 400;
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * The focused Claude pane's conversation as a readable thread (⌥⌘T): what was asked, what
 * Claude said, and one line per tool call, from its transcript (src-tauri/src/ide.rs).
 * Unlike the terminal it can be searched and doesn't scroll away; file tools open the file.
 */
export function ThreadPanel() {
  const paneId = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const path = useAgents((s) => (paneId ? s.sessions[paneId]?.transcriptPath : undefined));
  const status = useAgents((s) => (paneId ? s.sessions[paneId]?.status : undefined));
  const updatedAt = useAgents((s) => (paneId ? s.sessions[paneId]?.updatedAt : undefined));
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState("");
  const [tools, setTools] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    setItems([]);
    setError(undefined);
    pinned.current = true;
  }, [path]);

  // Reload on every hook event, and every few seconds while Claude is working.
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = () =>
      ipc.transcriptThread(path, MAX_ITEMS).then(
        (t) => !cancelled && (setItems(t), setError(undefined)),
        (e) => !cancelled && setError(String(e)),
      );
    load();
    const timer = status === "working" ? setInterval(load, 4000) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path, updatedAt, status]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((i) => (tools || i.role !== "tool") && (!q || i.text.toLowerCase().includes(q)));
  }, [items, filter, tools]);

  // Stay at the bottom unless the reader scrolled up.
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className="nav-files thread">
      <div className="search-box">
        <input className="search-input" placeholder="Filter the conversation" value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
        <button className={`toggle${tools ? " on" : ""}`} title="Show tool calls" aria-pressed={tools} onClick={() => setTools(!tools)}>
          ⚙
        </button>
      </div>
      <div
        className="thread-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!path && <p className="empty">Focus a Claude pane to read its conversation here.</p>}
        {error && <p className="empty">{error}</p>}
        {path && !error && !items.length && <p className="empty">Nothing said yet.</p>}
        {shown.map((item, i) =>
          item.role === "tool" ? (
            <div
              key={i}
              className={`thread-tool${item.error ? " failed" : ""}${FILE_TOOLS.has(item.tool ?? "") && item.text.startsWith("/") ? " link" : ""}`}
              title={item.error ? `${item.tool} failed` : item.tool}
              onClick={() => FILE_TOOLS.has(item.tool ?? "") && item.text.startsWith("/") && void openFile(item.text, undefined, undefined, { fromPane: paneId })}
            >
              <span className="thread-tool-name">{item.tool}</span>
              <span className="thread-tool-arg">{item.text === item.tool ? "" : item.text}</span>
            </div>
          ) : (
            <div key={i} className={`thread-msg ${item.role}`}>
              {item.text}
            </div>
          ),
        )}
      </div>
      <p className="nav-foot">{items.length >= MAX_ITEMS ? `Last ${MAX_ITEMS} entries` : `${items.length} entries`} · from the transcript</p>
    </div>
  );
}
