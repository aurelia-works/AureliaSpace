import { useState } from "react";
import { basename } from "../lib/format";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { usePaneAgent } from "./AgentChip";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

interface Project {
  root: string;
  name: string;
  branch?: string;
  panes: { id: string; tab: number }[];
}

function PaneRow({ paneId, tab, focused }: { paneId: string; tab: number; focused: boolean }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const running = useRuntime((s) => s.panes[paneId]?.running);
  const custom = usePaneAgent(paneId);
  const account = pane?.account ?? agent?.account;
  const isClaude = !!agent || !!account;
  const v: Visual | undefined = agent ? visualOf(agent) : isClaude ? "starting" : undefined;
  const label = pane?.browser ? "Browser" : pane?.launcher ? "New tab" : custom ? custom.name : isClaude ? (account ?? "Claude") : (running?.split(/\s+/)[0] ?? "Terminal");
  const sub = agent
    ? agent.status === "working" && agent.tool
      ? agent.tool
      : stateLabel[visualOf(agent)]
    : running && !isClaude
      ? "running"
      : "";
  return (
    <button
      className={`nav-pane${focused ? " focused" : ""}${v ? ` ${v}` : ""}`}
      onClick={() => showPane(paneId)}
      title={paneDir(paneId) ?? ""}
      aria-current={focused ? "true" : undefined}
    >
      {v ? <StatusGlyph state={v} /> : <StatusGlyph state="shell" busy={!!running} />}
      <span className="nav-pane-label">{label}</span>
      {sub && <span className="nav-pane-sub">{sub}</span>}
      <span className="nav-pane-tab num" title={`Tab ${tab + 1}`}>
        {tab + 1}
      </span>
    </button>
  );
}

/** Every open pane, grouped by git root (or folder), most urgent project first. */
export function ProjectsSidebar() {
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const activeTabId = useLayout((s) => s.activeTabId);
  const sessions = useAgents((s) => s.sessions);
  const git = useGit((s) => s.info);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const focusedId = tabs.find((t) => t.id === activeTabId)?.focusedPaneId;
  const projects: Project[] = [];
  const byRoot = new Map<string, Project>();
  tabs.forEach((tab, ti) => {
    for (const id of paneIds(tab.root)) {
      const dir = sessions[id]?.cwd ?? panes[id]?.cwd ?? "";
      const root = git[dir]?.root ?? dir;
      let p = byRoot.get(root);
      if (!p) {
        p = { root, name: basename(root) || "~", branch: git[dir]?.branch, panes: [] };
        byRoot.set(root, p);
        projects.push(p);
      }
      p.panes.push({ id, tab: ti });
    }
  });
  const best = (p: Project) => Math.min(5, ...p.panes.map(({ id }) => (sessions[id] ? urgency[visualOf(sessions[id])] : 5)));
  projects.sort((a, b) => best(a) - best(b));

  return (
    <div className="nav-tree" role="tree" aria-label="Workspace">
      {projects.map((p) => {
        const isCollapsed = collapsed[p.root];
        const needs = p.panes.filter(({ id }) => sessions[id]?.status === "needs_input").length;
        return (
          <div key={p.root} className="nav-project" role="treeitem" aria-expanded={!isCollapsed}>
            <button className="nav-project-head" title={p.root} onClick={() => setCollapsed({ ...collapsed, [p.root]: !isCollapsed })}>
              <span className={`chev${isCollapsed ? "" : " open"}`} aria-hidden>
                ›
              </span>
              <span className="nav-project-name">{p.name}</span>
              {p.branch && <span className="nav-project-branch mono">{p.branch}</span>}
              {needs > 0 && <span className="nav-needs num">{needs}</span>}
              <span className="nav-count num">{p.panes.length}</span>
            </button>
            {!isCollapsed && (
              <div role="group">
                {p.panes.map(({ id, tab }) => (
                  <PaneRow key={id} paneId={id} tab={tab} focused={id === focusedId} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
