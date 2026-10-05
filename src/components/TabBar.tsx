import { jumpToWaiting } from "../lib/shortcuts";
import { waitingAgents, worstStatus, useAgents } from "../store/agents";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useUi } from "../store/ui";
import { AureliaMark, CloseIcon, DiffIcon, GearIcon, GridIcon, PanelIcon, PlusIcon, SidebarIcon, SparkIcon } from "./Icons";
import { paneTitle } from "./PaneHeader";

export function TabBar() {
  const tabs = useLayout((s) => s.tabs);
  const activeTabId = useLayout((s) => s.activeTabId);
  const panes = useLayout((s) => s.panes);
  const runtime = useRuntime((s) => s.panes);
  const sessions = useAgents((s) => s.sessions);
  const agentPanelOpen = useUi((s) => s.agentPanelOpen);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const mode = useUi((s) => s.mode);
  const reviewOpen = useUi((s) => s.reviewOpen);
  const waiting = waitingAgents(sessions);
  const { activateTab, closeTab, newTab } = useLayout.getState();
  const ui = useUi.getState();

  return (
    <div className="tabbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <AureliaMark />
        <span className="brand-name" data-tauri-drag-region>
          AureliaSpace
        </span>
        <button className={`icon-btn${sidebarOpen ? " on" : ""}`} title="Projects sidebar (⌘\)" onClick={() => ui.set({ sidebarOpen: !sidebarOpen })}>
          <SidebarIcon />
        </button>
      </div>
      <div className="tabs" data-tauri-drag-region>
        {tabs.map((tab, i) => {
          const ids = paneIds(tab.root);
          const focused = panes[tab.focusedPaneId];
          const title = paneTitle(focused?.cwd, runtime[tab.focusedPaneId]?.running);
          const status = worstStatus(sessions, ids);
          const account = focused?.account ?? sessions[tab.focusedPaneId]?.account;
          return (
            <div
              key={tab.id}
              className={`tab${tab.id === activeTabId ? " active" : ""}`}
              onMouseDown={(e) => {
                if (e.button === 1) closeTab(tab.id);
                else activateTab(tab.id);
              }}
              title={`${focused?.cwd ?? ""}${i < 9 ? `  (⌘${i + 1})` : ""}`}
            >
              {status && <span className={`status-dot ${status}${ids.some((id) => sessions[id]?.attention) ? " attention" : ""}`} />}
              {account && <span className="tab-account">{account}</span>}
              <span className="tab-title">{title}</span>
              {ids.length > 1 && <span className="tab-count">{ids.length}</span>}
              <button
                className="tab-close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => closeTab(tab.id)}
                title="Close tab (⇧⌘W)"
              >
                <CloseIcon width={11} height={11} />
              </button>
            </div>
          );
        })}
        <button className="icon-btn tab-new" title="New tab (⌘T)" onClick={() => newTab({ launcher: true })}>
          <PlusIcon />
        </button>
        <button
          className="icon-btn tab-new claude"
          title="New Claude tab as account (⇧⌘E)"
          onClick={() => ui.set({ accountPicker: { target: "tab" } })}
        >
          <SparkIcon />
        </button>
        <button className="icon-btn tab-new" title="New grid tab (⌘G)" onClick={() => ui.set({ gridOpen: true })}>
          <GridIcon />
        </button>
      </div>
      <div className="mode-switch" role="tablist" aria-label="Mode">
        {(
          [
            ["agents", "Agents", "⇧⌘1"],
            ["terminals", "Terminals", "⇧⌘2"],
            ["review", "Review", "⇧⌘3"],
          ] as const
        ).map(([id, label, key]) => (
          <button
            key={id}
            role="tab"
            aria-selected={(reviewOpen ? "review" : mode) === id}
            className={(reviewOpen ? "review" : mode) === id ? "on" : ""}
            title={`${label} (${key})`}
            onClick={() => (id === "review" ? ui.set({ reviewOpen: true }) : ui.set({ mode: id }))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tabbar-right">
        {waiting.length > 0 && (
          <button
            className={`waiting-pill${waiting.some((w) => w.status === "needs_input") ? " urgent" : ""}`}
            onClick={jumpToWaiting}
            title="Jump to the agent waiting longest (⌘J)"
          >
            {waiting.length} waiting <kbd>⌘J</kbd>
          </button>
        )}
        <button className="icon-btn" title="Review changes (⇧⌘R)" onClick={() => ui.set({ reviewOpen: true })}>
          <DiffIcon />
        </button>
        <button
          className={`icon-btn${agentPanelOpen ? " on" : ""}`}
          title="Agent panel (⌘B)"
          onClick={() => ui.set({ agentPanelOpen: !agentPanelOpen })}
        >
          <PanelIcon />
        </button>
        <button className="icon-btn" title="Settings (⌘,)" onClick={() => ui.set({ settingsOpen: true })}>
          <GearIcon />
        </button>
      </div>
    </div>
  );
}
