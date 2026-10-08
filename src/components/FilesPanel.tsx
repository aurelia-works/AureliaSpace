import { useCallback, useEffect, useState } from "react";
import { shellEscape } from "../lib/filedrop";
import { basename } from "../lib/format";
import { ipc, type DirEntry } from "../lib/ipc";
import { insertAtPrompt } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { OpenIcon, RerunIcon } from "./Icons";

/** Inserts a path at the focused pane's prompt, relative when it's below the pane's cwd. */
function insertPath(path: string) {
  const pane = useLayout.getState().tabs.find((t) => t.id === useLayout.getState().activeTabId)?.focusedPaneId;
  if (!pane) return;
  const cwd = paneDir(pane);
  const rel = cwd && path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;
  insertAtPrompt(pane, shellEscape(rel) + " ");
}

function Node({
  entry,
  depth,
  expanded,
  children,
  toggle,
}: {
  entry: DirEntry;
  depth: number;
  expanded: Set<string>;
  children: Record<string, DirEntry[]>;
  toggle: (path: string) => void;
}) {
  const isOpen = expanded.has(entry.path);
  return (
    <>
      <div
        className={`file-row${entry.dir ? " dir" : ""}${entry.name.startsWith(".") ? " hidden-file" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        role="treeitem"
        aria-expanded={entry.dir ? isOpen : undefined}
        onClick={() => (entry.dir ? toggle(entry.path) : insertPath(entry.path))}
        title={entry.dir ? entry.path : `${entry.path}\nClick to insert the path at the prompt`}
      >
        <span className={`chev${isOpen ? " open" : ""}`} aria-hidden>{entry.dir ? "›" : ""}</span>
        <span className="file-name">{entry.name}</span>
        <button
          className="icon-btn sm"
          title={entry.dir ? "Insert path" : "Open in editor"}
          aria-label={entry.dir ? "Insert path" : "Open in editor"}
          onClick={(e) => {
            e.stopPropagation();
            if (entry.dir) insertPath(entry.path);
            else ipc.openPath(entry.path).catch((err) => toast(String(err), true));
          }}
        >
          <OpenIcon width={12} height={12} />
        </button>
      </div>
      {entry.dir &&
        isOpen &&
        (children[entry.path] ?? []).map((c) => (
          <Node key={c.path} entry={c} depth={depth + 1} expanded={expanded} children={children} toggle={toggle} />
        ))}
    </>
  );
}

/** Project file tree for the focused pane: the Navigator's Files view (⇧⌘F). */
export function FilesPanel() {
  const focused = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const shellCwd = useLayout((s) => (focused ? s.panes[focused]?.cwd : undefined));
  const agentCwd = useAgents((s) => (focused ? s.sessions[focused]?.cwd : undefined));
  const cwd = agentCwd ?? shellCwd;
  const repoRoot = useGit((s) => (cwd ? s.info[cwd]?.root : undefined));
  const root = repoRoot ?? cwd;
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (dir: string) => {
    try {
      const list = await ipc.listDir(dir);
      setChildren((c) => ({ ...c, [dir]: list }));
    } catch {
      setChildren((c) => ({ ...c, [dir]: [] }));
    }
  }, []);

  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    if (root) load(root);
  }, [root, load]);

  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      load(path); // always refresh on open
    }
    setExpanded(next);
  };

  const refresh = () => {
    if (!root) return;
    load(root);
    expanded.forEach(load);
  };

  return (
    <div className="nav-files">
      <div className="nav-subhead" title={root}>
        <span className="nav-subhead-name">{basename(root) || "No folder"}</span>
        <button className="icon-btn sm" onClick={refresh} title="Refresh" aria-label="Refresh files">
          <RerunIcon width={12} height={12} />
        </button>
      </div>
      <div className="file-tree" role="tree" aria-label="Files">
        {!root && <p className="empty">Focus a pane to browse its project.</p>}
        {root &&
          (children[root] ?? []).map((e) => (
            <Node key={e.path} entry={e} depth={0} expanded={expanded} children={children} toggle={toggle} />
          ))}
      </div>
      <p className="nav-foot">Click a file to insert its path · ⌘-click paths in output to open them</p>
    </div>
  );
}
