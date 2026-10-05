import { useState } from "react";
import { basename } from "../lib/format";
import { focusTerminal } from "../lib/terminals";
import { resolveDark } from "../lib/theme";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { GearIcon, PlusIcon } from "./Icons";
import { UsageMeter } from "./UsageMeter";

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </svg>
);
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 9.6A5.5 5.5 0 0 1 6.4 3 5.5 5.5 0 1 0 13 9.6z" />
  </svg>
);

interface Project {
  root: string;
  name: string;
  panes: string[];
}

function openPane(paneId: string) {
  useLayout.getState().focusPane(paneId);
  requestAnimationFrame(() => focusTerminal(paneId));
}

function PaneRow({ paneId, focused }: { paneId: string; focused: boolean }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const running = useRuntime((s) => s.panes[paneId]?.running);
  const account = pane?.account ?? agent?.account;
  const isClaude = !!agent || !!account;
  const label = isClaude ? (account ?? "Claude") : (running ?? "Terminal");
  const sub = isClaude && agent ? (agent.status === "needs_input" ? "needs input" : agent.status) : "";
  return (
    <button className={`sb-pane${focused ? " focused" : ""}`} onClick={() => openPane(paneId)} title={paneDir(paneId) ?? ""}>
      {isClaude ? (
        <span className={`status-dot ${agent?.status ?? "starting"}${agent?.attention ? " attention" : ""}`} />
      ) : (
        <span className={`status-dot shell${running ? " busy" : ""}`} />
      )}
      <span className="sb-pane-label">{label}</span>
      {sub && <span className="sb-pane-sub">{sub}</span>}
    </button>
  );
}

function UsageStrip() {
  const accounts = useConfig((s) => s.config?.accounts) ?? [];
  const usage = useUsage((s) => s.usage);
  if (accounts.length === 0) return null;
  return (
    <div className="sb-usage">
      {accounts.map((a) => (
        <div key={a.name} className="sb-usage-row">
          <span className="sb-usage-name">{a.name}</span>
          <UsageMeter usage={usage[a.name]} compact />
        </div>
      ))}
    </div>
  );
}

export function ProjectsSidebar() {
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const activeTabId = useLayout((s) => s.activeTabId);
  const sessions = useAgents((s) => s.sessions);
  const git = useGit((s) => s.info);
  const config = useConfig((s) => s.config);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const focusedId = activeTab?.focusedPaneId;

  const projects: Project[] = [];
  const byRoot = new Map<string, Project>();
  for (const tab of tabs) {
    for (const id of paneIds(tab.root)) {
      const dir = sessions[id]?.cwd ?? panes[id]?.cwd ?? "";
      const root = git[dir]?.root ?? dir;
      let p = byRoot.get(root);
      if (!p) {
        p = { root, name: basename(root) || "~", panes: [] };
        byRoot.set(root, p);
        projects.push(p);
      }
      p.panes.push(id);
    }
  }

  const dark = resolveDark(config?.theme ?? "system");
  const toggleTheme = () => {
    if (!config) return;
    useConfig.getState().save({ ...config, theme: dark ? "light" : "dark" }).catch(() => {});
  };

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <span className="sb-title">Workspaces</span>
        <button className="icon-btn" title="New tab in default workspace" onClick={() => useLayout.getState().newTab()}>
          <PlusIcon />
        </button>
      </div>
      <div className="sb-body">
        {projects.map((p) => {
          const isCollapsed = collapsed[p.root];
          return (
            <div key={p.root} className="sb-project">
              <button className="sb-project-head" title={p.root} onClick={() => setCollapsed({ ...collapsed, [p.root]: !isCollapsed })}>
                <span className={`sb-chevron${isCollapsed ? "" : " open"}`}>›</span>
                <span className="sb-project-name">{p.name}</span>
                <span className="sb-count">{p.panes.length}</span>
              </button>
              {!isCollapsed && p.panes.map((id) => <PaneRow key={id} paneId={id} focused={id === focusedId} />)}
            </div>
          );
        })}
      </div>
      <div className="sb-footer">
        <UsageStrip />
        <div className="sb-actions">
          <button className="icon-btn" title={dark ? "Switch to light" : "Switch to dark"} onClick={toggleTheme}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="icon-btn" title="Settings (⌘,)" onClick={() => useUi.getState().set({ settingsOpen: true })}>
            <GearIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
