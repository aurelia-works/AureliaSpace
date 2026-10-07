import { basename, shortenPath } from "../lib/format";
import { openInBrowserPane } from "../lib/browser";
import { useAgents, type AgentStatus } from "../store/agents";
import { useGit } from "../store/git";
import { focusedPaneId, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { useUsage } from "../store/usage";
import { toggleVoice, useVoice } from "../lib/voice";
import { BranchIcon, CloseIcon, MicIcon, SplitDownIcon, SplitRightIcon } from "./Icons";
import { AccountSwitch } from "./AccountSwitch";
import { CacheBadge } from "./CacheBadge";
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
  const voiceInstalled = useVoice((s) => s.installed);
  const voiceState = useVoice((s) => (focusedPaneId() === paneId ? s.state : "idle"));
  if (!pane) return null;

  if (pane.browser) {
    return (
      <div className="pane-header">
        <div className="pane-title">
          <span className="pane-path">🌐 {pane.browser.url ? hostOf(pane.browser.url) : "Browser"}</span>
        </div>
        <div className="pane-actions">
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
        {account && (agent || pane.account ? <AccountSwitch paneId={paneId} account={account} /> : <span className="account-chip">{account}</span>)}
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
        {agent && <CacheBadge session={agent} />}
        {agent?.attention && agent.status === "idle" && <span className="agent-badge done">done</span>}
        {task && (
          <span className={`pane-task ${task.status}`} title={`Attached task (${task.status})`}>
            ◆ {task.title}
          </span>
        )}
      </div>
      <div className="pane-actions">
        {voiceState !== "idle" && <span className={`voice-dot ${voiceState}`} title={`Dictation: ${voiceState}`} />}
        {account && <UsageMeter usage={usage} compact />}
        {voiceInstalled && (
          <button className={`icon-btn mic${voiceState !== "idle" ? " live" : ""}`} title="Dictate (⌥⌘V)" onClick={() => toggleVoice(paneId)}>
            <MicIcon />
          </button>
        )}
        <button className="icon-btn" title="Open browser pane (⇧⌘B)" onClick={() => openInBrowserPane(paneId, "")}>
          🌐
        </button>
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

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function paneTitle(cwd: string | undefined, running: string | undefined): string {
  if (running) return running.split(/\s+/)[0];
  return basename(cwd) || "~";
}
