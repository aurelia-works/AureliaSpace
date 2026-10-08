import { useEffect } from "react";
import { basename, shortenPath } from "../lib/format";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { BranchIcon } from "./Icons";
import { StatusGlyph, stateLabel, visualOf, type Visual } from "./StatusGlyph";
import { UsageMeter } from "./UsageMeter";

/** One pip per agent in tab order: the whole fleet at a glance from any mode. Click to go there. */
function Fleet() {
  const sessions = useAgents((s) => s.sessions);
  const tabs = useLayout((s) => s.tabs);
  const runtime = useRuntime((s) => s.panes);
  const order = tabs.flatMap((t, ti) => paneIds(t.root).map((id) => ({ id, tab: ti })));
  const agents = order.filter((p) => sessions[p.id]);
  const shellsBusy = order.filter((p) => !sessions[p.id] && runtime[p.id]?.running).length;
  const counts: Partial<Record<Visual, number>> = {};
  agents.forEach((p) => {
    const v = visualOf(sessions[p.id]);
    counts[v] = (counts[v] ?? 0) + 1;
  });
  const summary = (["needs_input", "done", "working", "idle"] as const)
    .filter((v) => counts[v])
    .map((v) => (
      <span key={v} className={`state-text ${v}`}>
        {counts[v]} {stateLabel[v]}
      </span>
    ));

  return (
    <div className="sb-fleet" aria-label="Agents">
      {agents.length === 0 ? (
        <span className="sb-dim">No agents running</span>
      ) : (
        <>
          <div className="pips">
            {agents.map(({ id, tab }) => {
              const s = sessions[id];
              const v = visualOf(s);
              const where = `${s.account ?? "claude"} · ${basename(s.cwd) || "—"} · tab ${tab + 1}`;
              return (
                <button key={id} className={`pip ${v}`} onClick={() => showPane(id)} title={`${where}: ${stateLabel[v]}`} aria-label={`${where}: ${stateLabel[v]}`}>
                  <StatusGlyph state={v} title="" />
                </button>
              );
            })}
          </div>
          <span className="sb-summary">{summary}</span>
        </>
      )}
      {shellsBusy > 0 && (
        <span className="sb-dim" title="Plain terminals running a command">
          · {shellsBusy} shell{shellsBusy > 1 ? "s" : ""} busy
        </span>
      )}
    </div>
  );
}

/** Where the focused pane is: folder, branch, and the running or last command's state. */
function FocusInfo() {
  const pane = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const cwd = useLayout((s) => (pane ? s.panes[pane]?.cwd : undefined));
  const agentCwd = useAgents((s) => (pane ? s.sessions[pane]?.cwd : undefined));
  const rt = useRuntime((s) => (pane ? s.panes[pane] : undefined));
  const dir = agentCwd ?? cwd ?? (pane ? paneDir(pane) : undefined);
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const fontDelta = useUi((s) => s.fontDelta);
  if (!pane) return <div className="sb-focus" />;
  return (
    <div className="sb-focus">
      <span className="sb-path mono" title={dir}>
        {shortenPath(dir) || "~"}
      </span>
      {git && (
        <span className="git-chip" title={git.worktree ? `Worktree: ${git.root}` : undefined}>
          <BranchIcon width={10} height={10} />
          {git.branch}
          {git.worktree && <span className="wt">wt</span>}
        </span>
      )}
      {rt?.running ? (
        <span className="sb-run mono" title={rt.running}>
          ▸ {rt.running}
        </span>
      ) : (
        rt?.lastExit !== undefined &&
        rt.lastExit !== 0 && (
          <span className="sb-exit num" title="Exit status of the last command">
            exit {rt.lastExit}
          </span>
        )
      )}
      {fontDelta !== 0 && (
        <button className="sb-font num" title="Font size offset (⌘0 resets)" onClick={() => useUi.getState().set({ fontDelta: 0 })}>
          A{fontDelta > 0 ? `+${fontDelta}` : fontDelta}
        </button>
      )}
    </div>
  );
}

/** 5h / 7d usage for every account that has a pane open (all accounts when none do). */
function Fuel() {
  const accounts = useConfig((s) => s.config?.accounts) ?? [];
  const inUse = useLayout((s) => [...new Set(Object.values(s.panes).map((p) => p.account).filter(Boolean))].join("\n"));
  const usage = useUsage((s) => s.usage);
  const used = inUse ? inUse.split("\n") : [];
  const shown = used.length ? accounts.filter((a) => used.includes(a.name)) : accounts;
  const missing = shown.filter((a) => !(a.name in usage)).map((a) => a.name).join("\n");
  // Polling only covers accounts with panes open; fetch the rest once so the bar isn't stuck on "usage…".
  useEffect(() => {
    if (missing) missing.split("\n").forEach((a) => void useUsage.getState().refresh(a));
  }, [missing]);
  if (!shown.length) return null;
  return (
    <div className="sb-fuel">
      {shown.map((a) => (
        <span key={a.name} className="sb-account">
          <span className="sb-account-name">{a.name}</span>
          <UsageMeter usage={usage[a.name]} compact />
        </span>
      ))}
    </div>
  );
}

export function StatusBar() {
  return (
    <footer className="statusbar">
      <Fleet />
      <FocusInfo />
      <Fuel />
    </footer>
  );
}
