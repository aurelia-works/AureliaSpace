import { basename, shortenPath } from "../lib/format";
import { useAgents, type AgentStatus } from "../store/agents";
import { useGit } from "../store/git";
import { useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { useUsage } from "../store/usage";
import { BranchIcon, CloseIcon, SplitDownIcon, SplitRightIcon } from "./Icons";
import { UsageMeter } from "./UsageMeter";

export const statusLabel: Record<AgentStatus, string> = {
  starting: "starting",
  idle: "idle",
  working: "working",
  needs_input: "needs input",
};

export function PaneHeader({ paneId }: { paneId: string }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const runtime = useRuntime((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const projects = useTasks((s) => s.projects);
  const account = pane?.account ?? agent?.account;
  const usage = useUsage((s) => (account ? s.usage[account] : undefined));
  const dir = agent?.cwd ?? pane?.cwd;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const { splitPane, closePane } = useLayout.getState();
  if (!pane) return null;

  const attached = tasksForPane(projects, paneId);
  const task = attached.find((t) => t.status === "doing") ?? attached[0];
  const running = runtime?.running;

  return (
    <div className="pane-header">
      <div className="pane-title">
        {agent ? (
          <span className={`status-dot ${agent.status}`} title={`Claude: ${statusLabel[agent.status]}`} />
        ) : (
          <span className={`status-dot shell${running ? " busy" : ""}`} />
        )}
        {account && <span className="account-chip">{account}</span>}
        <span className="pane-path" title={dir}>
          {shortenPath(dir) || "~"}
        </span>
        {git && (
          <span
            className={`git-chip${git.worktree ? " worktree" : ""}`}
            title={`${git.detached ? "Detached HEAD" : "Branch"} ${git.branch}${git.worktree ? `\nWorktree: ${git.root}` : ""}`}
          >
            <BranchIcon width={11} height={11} />
            {git.branch}
            {git.worktree && <span className="wt">worktree</span>}
          </span>
        )}
        {running && !agent && (
          <span className="pane-running" title={running}>
            {running}
          </span>
        )}
        {agent && agent.status !== "idle" && <span className={`agent-badge ${agent.status}`}>{statusLabel[agent.status]}</span>}
        {agent?.attention && agent.status === "idle" && <span className="agent-badge done">done</span>}
        {task && (
          <span className={`pane-task ${task.status}`} title={`Attached task (${task.status})`}>
            ◆ {task.title}
          </span>
        )}
      </div>
      <div className="pane-actions">
        {account && <UsageMeter usage={usage} compact />}
        <button className="icon-btn" title="Split right (⌘D)" onClick={() => splitPane(paneId, "row")}>
          <SplitRightIcon />
        </button>
        <button className="icon-btn" title="Split down (⇧⌘D)" onClick={() => splitPane(paneId, "column")}>
          <SplitDownIcon />
        </button>
        <button className="icon-btn" title="Close pane (⌘W)" onClick={() => closePane(paneId)}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

export function paneTitle(cwd: string | undefined, running: string | undefined): string {
  if (running) return running.split(/\s+/)[0];
  return basename(cwd) || "~";
}
