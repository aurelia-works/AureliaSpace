import { basename, shortenPath } from "../lib/format";
import { openInBrowserPane } from "../lib/browser";
import { toggleVoice, useVoice } from "../lib/voice";
import { useAgents } from "../store/agents";
import { useGit } from "../store/git";
import { focusedPaneId, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { useUsage } from "../store/usage";
import { AccountSwitch } from "./AccountSwitch";
import { CacheBadge } from "./CacheBadge";
import { BranchIcon, CloseIcon, GlobeIcon, MicIcon, SplitDownIcon, SplitRightIcon } from "./Icons";
import { PermissionButtons } from "./SessionExtras";
import { StatusGlyph, stateLabel, visualOf } from "./StatusGlyph";
import { UsageMeter } from "./UsageMeter";

function PaneActions({ paneId, browser }: { paneId: string; browser?: boolean }) {
  const { splitPane, closePane } = useLayout.getState();
  return (
    <span className="pane-tools">
      {!browser && (
        <button className="icon-btn sm hide-narrow" title="Open browser pane (⇧⌘B)" aria-label="Open browser pane" onClick={() => openInBrowserPane(paneId, "")}>
          <GlobeIcon />
        </button>
      )}
      <button className="icon-btn sm hide-narrow" title="Split right (⌘D)" aria-label="Split right" onClick={() => splitPane(paneId, "row")}>
        <SplitRightIcon />
      </button>
      <button className="icon-btn sm hide-narrow" title="Split down (⇧⌘D)" aria-label="Split down" onClick={() => splitPane(paneId, "column")}>
        <SplitDownIcon />
      </button>
      <button className="icon-btn sm" title="Close pane (⌘W)" aria-label="Close pane" onClick={() => closePane(paneId)}>
        <CloseIcon width={11} height={11} />
      </button>
    </span>
  );
}

/**
 * One line, 28px: identity on the left (state, account, folder, branch), live signals in
 * the middle (permission answers, cache, task), tools on the right. Sits above the
 * terminal, never over it; narrow panes shed the least important parts (container queries).
 */
export function PaneHeader({ paneId }: { paneId: string }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const runtime = useRuntime((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const projects = useTasks((s) => s.projects);
  const account = pane?.account ?? agent?.account;
  const usage = useUsage((s) => (account ? s.usage[account] : undefined));
  const dir = agent?.cwd ?? pane?.cwd;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const voiceInstalled = useVoice((s) => s.installed);
  const voiceState = useVoice((s) => (focusedPaneId() === paneId ? s.state : "idle"));
  if (!pane) return null;

  if (pane.browser) {
    return (
      <div className="pane-header">
        <div className="pane-id">
          <GlobeIcon width={12} height={12} className="pane-kind" />
          <span className="pane-name">{pane.browser.url ? hostOf(pane.browser.url) : "Browser"}</span>
        </div>
        <PaneActions paneId={paneId} browser />
      </div>
    );
  }

  const attached = tasksForPane(projects, paneId);
  const task = attached.find((t) => t.status === "doing") ?? attached[0];
  const running = runtime?.running;
  const v = agent ? visualOf(agent) : undefined;

  return (
    <div className="pane-header">
      <div className="pane-id">
        {v ? <StatusGlyph state={v} /> : <StatusGlyph state="shell" busy={!!running} />}
        {account && (agent || pane.account ? <AccountSwitch paneId={paneId} account={account} /> : <span className="account-chip">{account}</span>)}
        <span className="pane-name" title={dir}>
          {pane.launcher ? "New tab" : basename(dir) || "~"}
        </span>
        {!pane.launcher && dir && shortenPath(dir) !== basename(dir) && (
          <span className="pane-path hide-narrow" title={dir}>
            {shortenPath(dir)}
          </span>
        )}
        {git && (
          <span
            className={`git-chip hide-tight${git.worktree ? " worktree" : ""}`}
            title={`${git.detached ? "Detached HEAD" : "Branch"} ${git.branch}${git.worktree ? `\nWorktree: ${git.root}` : ""}`}
          >
            <BranchIcon width={10} height={10} />
            {git.branch}
            {git.worktree && <span className="wt">wt</span>}
          </span>
        )}
      </div>
      <div className="pane-signals">
        {running && !agent && (
          <span className="pane-running mono" title={running}>
            ▸ {running}
          </span>
        )}
        {v && v !== "idle" && (
          <span className={`state-text ${v}`} title={agent?.message || agent?.tool || undefined}>
            {v === "working" && agent?.tool ? agent.tool : stateLabel[v]}
          </span>
        )}
        {v === "needs_input" && <PermissionButtons paneId={paneId} />}
        {agent && <span className="hide-tight"><CacheBadge session={agent} /></span>}
        {task && (
          <span className={`pane-task hide-narrow ${task.status}`} title={`Attached task (${task.status}): ${task.title}`}>
            ◆ {task.title}
          </span>
        )}
      </div>
      <div className="pane-end">
        {voiceState !== "idle" && <span className={`voice-dot ${voiceState}`} title={`Dictation: ${voiceState}`} />}
        {account && (
          <span className="hide-narrow">
            <UsageMeter usage={usage} compact />
          </span>
        )}
        {voiceInstalled && !pane.launcher && (
          <button className={`icon-btn sm mic${voiceState !== "idle" ? " live" : ""}`} title="Dictate (⌥⌘V)" aria-label="Dictate" onClick={() => toggleVoice(paneId)}>
            <MicIcon />
          </button>
        )}
        <PaneActions paneId={paneId} />
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
