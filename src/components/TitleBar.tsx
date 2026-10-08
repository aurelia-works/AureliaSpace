import { basename } from "../lib/format";
import { jumpToWaiting } from "../lib/shortcuts";
import { waitingAgents, worstStatus, useAgents } from "../store/agents";
import { useCustomAgents } from "../store/customAgents";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useUi, type Mode } from "../store/ui";
import { AureliaMark, CloseIcon, GearIcon, GridIcon, PanelIcon, PlusIcon, SearchIcon, SidebarIcon, SparkIcon } from "./Icons";
import { NoticeBell } from "./Notices";
import { StatusGlyph } from "./StatusGlyph";

/** A pane's short title: the command running in it, else its folder. */
export function paneTitle(cwd: string | undefined, running: string | undefined): string {
  if (running) return running.split(/\s+/)[0];
  return basename(cwd) || "~";
}

const MODES: { id: Mode | "review"; label: string; key: string }[] = [
  { id: "agents", label: "Agents", key: "⇧⌘1" },
  { id: "terminals", label: "Terminals", key: "⇧⌘2" },
  { id: "review", label: "Review", key: "⇧⌘3" },
];

function ModeSwitch() {
  const mode = useUi((s) => s.mode);
  const reviewOpen = useUi((s) => s.reviewOpen);
  const current = reviewOpen ? "review" : mode;
  return (
    <div className="mode-switch" role="tablist" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={current === m.id}
          className={current === m.id ? "on" : ""}
          title={`${m.label} (${m.key})`}
          onClick={() =>
            m.id === "review" ? useUi.getState().set({ reviewOpen: true }) : useUi.getState().set({ mode: m.id, reviewOpen: false })
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function Tabs() {
  const tabs = useLayout((s) => s.tabs);
  const activeTabId = useLayout((s) => s.activeTabId);
  const panes = useLayout((s) => s.panes);
  const runtime = useRuntime((s) => s.panes);
  const sessions = useAgents((s) => s.sessions);
  const customAgents = useCustomAgents((s) => s.agents);
  const mode = useUi((s) => s.mode);
  const { activateTab, closeTab } = useLayout.getState();

  return (
    <div className="tabs" role="tablist" aria-label="Tabs" data-tauri-drag-region>
      {tabs.map((tab, i) => {
        const ids = paneIds(tab.root);
        const focused = panes[tab.focusedPaneId];
        const agent = sessions[tab.focusedPaneId];
        // An agent pane is named for its project; "claude" as a title says nothing.
        const title = agent ? basename(agent.cwd ?? focused?.cwd) || "~" : paneTitle(focused?.cwd, runtime[tab.focusedPaneId]?.running);
        const status = worstStatus(sessions, ids);
        const done = ids.some((id) => sessions[id]?.attention);
        const account =
          customAgents.find((a) => a.id === focused?.customAgent)?.name ?? focused?.account ?? sessions[tab.focusedPaneId]?.account;
        const active = tab.id === activeTabId && mode === "terminals";
        const needs = status === "needs_input";
        const select = () => {
          activateTab(tab.id);
          if (useUi.getState().mode !== "terminals") useUi.getState().set({ mode: "terminals" });
        };
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={-1}
            aria-selected={active}
            className={`tab${active ? " active" : ""}${needs ? " needs" : ""}`}
            onMouseDown={(e) => {
              if (e.button === 1) closeTab(tab.id);
              else select();
            }}
            title={`${focused?.cwd ?? ""}${i < 9 ? `  (⌘${i + 1})` : ""}`}
          >
            <span className="tab-index num">{i + 1}</span>
            {status && <StatusGlyph state={status === "idle" && done ? "done" : status} />}
            <span className="tab-title">{title}</span>
            {account && <span className="tab-account">{account}</span>}
            {ids.length > 1 && <span className="tab-count num">×{ids.length}</span>}
            <button
              className="tab-close"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => closeTab(tab.id)}
              title="Close tab (⇧⌘W)"
              aria-label="Close tab"
            >
              <CloseIcon width={10} height={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** "N need you" beacon: the only gold in the title bar; ⌘J cycles through them. */
function Beacon() {
  const sessions = useAgents((s) => s.sessions);
  const waiting = waitingAgents(sessions);
  if (!waiting.length) return null;
  const needs = waiting.filter((w) => w.status === "needs_input").length;
  const text = needs ? `${needs} need${needs === 1 ? "s" : ""} you` : `${waiting.length} finished`;
  return (
    <button
      className={`beacon${needs ? " urgent" : ""}`}
      onClick={jumpToWaiting}
      title="Jump to the agent waiting longest (⌘J)"
      aria-live="polite"
    >
      <StatusGlyph state={needs ? "needs_input" : "done"} />
      <span>{text}</span>
      {needs > 0 && waiting.length > needs && <span className="beacon-more num">+{waiting.length - needs}</span>}
      <kbd>⌘J</kbd>
    </button>
  );
}

export function TitleBar() {
  const nav = useUi((s) => s.nav);
  const agentPanelOpen = useUi((s) => s.agentPanelOpen);
  const ui = useUi.getState();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <AureliaMark />
        <span className="brand-name" data-tauri-drag-region>
          Aurelia<span>Space</span>
        </span>
      </div>
      <button
        className={`icon-btn${nav ? " on" : ""}`}
        title="Navigator (⌘\ workspace · ⇧⌘F files)"
        aria-pressed={!!nav}
        onClick={() => ui.set({ nav: nav ? null : "projects" })}
      >
        <SidebarIcon />
      </button>
      <ModeSwitch />
      <div className="tabstrip" data-tauri-drag-region>
        <Tabs />
        <div className="tab-actions">
          <button className="icon-btn sm" title="New tab (⌘T)" aria-label="New tab" onClick={() => useLayout.getState().newTab({ launcher: true })}>
            <PlusIcon />
          </button>
          <button className="icon-btn sm" title="Launch agents (⇧⌘E)" aria-label="Launch agents" onClick={() => ui.set({ accountPicker: { target: "tab" } })}>
            <SparkIcon />
          </button>
          <button className="icon-btn sm" title="New grid tab (⌘G)" aria-label="New grid tab" onClick={() => ui.set({ gridOpen: true })}>
            <GridIcon />
          </button>
        </div>
      </div>
      <div className="titlebar-right">
        <Beacon />
        <button className="cmdk-trigger" onClick={() => ui.set({ paletteOpen: true })} title="Command palette (⌘P)">
          <SearchIcon width={12} height={12} />
          <span>Go to…</span>
          <kbd>⌘P</kbd>
        </button>
        <NoticeBell />
        <button
          className={`icon-btn${agentPanelOpen ? " on" : ""}`}
          title="Queue rail (⌘B)"
          aria-pressed={agentPanelOpen}
          onClick={() => ui.set({ agentPanelOpen: !agentPanelOpen })}
        >
          <PanelIcon />
        </button>
        <button className="icon-btn" title="Settings (⌘,)" aria-label="Settings" onClick={() => ui.set({ settingsOpen: true })}>
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
