import { useEffect, useState } from "react";
import { basename, formatDuration, shortenPath } from "../lib/format";
import { focusTerminal } from "../lib/terminals";
import { useAgents, type AgentSession } from "../store/agents";
import { useGit } from "../store/git";
import { useLayout } from "../store/layout";
import { tasksForPane, useTasks } from "../store/tasks";
import { useUi } from "../store/ui";
import { BranchIcon, SparkIcon } from "./Icons";
import { statusLabel } from "./PaneHeader";

const urgency = { needs_input: 0, working: 1, starting: 2, idle: 3 } as const;

function Card({ s, now }: { s: AgentSession; now: number }) {
  const projects = useTasks((t) => t.projects);
  const dir = s.cwd ?? useLayout.getState().panes[s.paneId]?.cwd;
  const git = useGit((g) => (dir ? g.info[dir] : undefined));
  const attached = tasksForPane(projects, s.paneId);
  const task = attached.find((t) => t.status === "doing") ?? attached[0];

  const open = () => {
    useUi.getState().set({ mode: "terminals" });
    useLayout.getState().focusPane(s.paneId);
    requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(s.paneId)));
  };

  return (
    <button className={`board-card ${s.status}${s.attention ? " attention" : ""}`} onClick={open} title={shortenPath(dir)}>
      <span className="board-card-top">
        <span className="account-chip">{s.account ?? "claude"}</span>
        <span className={`status-dot ${s.status}`} />
        <span className={`agent-status ${s.status}`}>{statusLabel[s.status]}</span>
        <span className="board-since">{formatDuration(Math.max(0, now - s.updatedAt))}</span>
      </span>
      <span className="board-folder">{basename(dir) || "—"}</span>
      {git && (
        <span className="board-branch">
          <BranchIcon width={10} height={10} />
          {git.branch}
        </span>
      )}
      {task && <span className="board-task">◆ {task.title}</span>}
      {s.status === "working" && s.tool && <span className="board-detail">{s.tool}</span>}
      {s.status === "needs_input" && s.message && <span className="board-detail">{s.message}</span>}
    </button>
  );
}

/** Every running Claude session as a card; click one to jump to its pane. */
export function AgentsBoard() {
  const sessions = useAgents((s) => s.sessions);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const list = Object.values(sessions)
    .filter((s) => useLayout.getState().panes[s.paneId])
    .sort((a, b) => urgency[a.status] - urgency[b.status] || a.updatedAt - b.updatedAt);

  return (
    <div className="agents-board">
      {list.length === 0 ? (
        <div className="board-empty">
          <SparkIcon width={28} height={28} />
          <h2>No Claude sessions running</h2>
          <p>Sessions show up here with their status, project and task.</p>
          <button className="primary" onClick={() => useUi.getState().set({ accountPicker: { target: "tab" } })}>
            New Claude pane
          </button>
        </div>
      ) : (
        <div className="board-grid">
          {list.map((s) => (
            <Card key={s.paneId} s={s} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
