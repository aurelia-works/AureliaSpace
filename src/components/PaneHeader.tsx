import { basename } from "../lib/format";
import { openInBrowserPane } from "../lib/browser";
import { cacheSafe, currentEffort, useEffortPicks } from "../lib/effort";
import { closePaneSafely, openFile, useEditors } from "../lib/openFile";
import { useConfig } from "../store/config";
import { useLive } from "../store/live";
import { useUi } from "../store/ui";
import { toggleVoice, useVoice } from "../lib/voice";
import { useAgents } from "../store/agents";
import { useGit } from "../store/git";
import { focusedPaneId, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { AccountSwitch } from "./AccountSwitch";
import { AgentChip, usePaneAgent } from "./AgentChip";
import { BranchIcon, CloseIcon, GlobeIcon, MicIcon, OpenIcon, SplitDownIcon, SplitRightIcon } from "./Icons";
import { startPaneDrag } from "./PaneDrag";
import { PermissionButtons } from "./SessionExtras";
import { StatusGlyph, stateLabel, visualOf } from "./StatusGlyph";

function PaneActions({ paneId, browser, editor }: { paneId: string; browser?: boolean; editor?: string }) {
  const { splitPane } = useLayout.getState();
  return (
    <span className="pane-tools">
      {editor && (
        <button className="icon-btn sm hide-narrow" title="Open in external editor" aria-label="Open in external editor" onClick={() => void openFile(editor, undefined, undefined, { external: true })}>
          <OpenIcon width={12} height={12} />
        </button>
      )}
      {!browser && !editor && (
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
      <button className="icon-btn sm" title="Close pane (⌘W)" aria-label="Close pane" onClick={() => closePaneSafely(paneId)}>
        <CloseIcon width={11} height={11} />
      </button>
    </span>
  );
}

/**
 * A Claude pane's effort, live from its status line, and what auto effort last chose.
 * Click opens the composer (⌘L), the one place prompts get their effort picked: text
 * typed straight into the terminal reaches Claude untouched.
 */
function EffortChip({ paneId }: { paneId: string }) {
  const live = useLive((s) => s.byPane[paneId]);
  const pick = useEffortPicks((s) => s.byPane[paneId]);
  const auto = useConfig((s) => s.config?.effort.auto !== false);
  if (!live?.effort) return null;
  const level = currentEffort(paneId) ?? live.effort;
  const safe = cacheSafe(live.model);
  const lines = [
    `Effort: ${level} (live from Claude)`,
    pick ? `Last auto pick: ${pick.level ?? "kept"} (${pick.source}) · ${pick.why}` : "No prompt sent through the composer yet",
    !auto ? "Auto effort is off in Settings" : safe ? "⌘L or click: send through the composer, which picks effort per prompt" : "This model loses its cache on effort changes: auto effort leaves it alone",
  ];
  return (
    <button
      className={`effort-chip hide-tight${pick?.switched ? " picked" : ""}${!auto || !safe ? " off" : ""}`}
      title={lines.join("\n")}
      onClick={() => useUi.getState().set({ composerPaneId: paneId })}
    >
      <span className="effort-bolt" aria-hidden>⚡</span>
      {level}
      {auto && safe && <span className="effort-auto">auto</span>}
    </button>
  );
}

/**
 * One line, 28px: identity on the left (state, account, folder, branch), live signals in
 * the middle (state, permission answers, task), tools on hover. Usage lives in the status
 * bar and the cache timer on the board and rail, so the header stays quiet. Sits above the
 * terminal, never over it; narrow panes shed the least important parts (container queries).
 */
export function PaneHeader({ paneId }: { paneId: string }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const runtime = useRuntime((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const custom = usePaneAgent(paneId);
  const projects = useTasks((s) => s.projects);
  const account = pane?.account ?? agent?.account;
  const dir = agent?.cwd ?? pane?.cwd;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const voiceInstalled = useVoice((s) => s.installed);
  const voiceState = useVoice((s) => (focusedPaneId() === paneId ? s.state : "idle"));
  const dirty = useEditors((s) => !!s.dirty[paneId]);
  if (!pane) return null;

  if (pane.editor) {
    const file = pane.editor.path;
    const root = git?.root ?? dir;
    const rel = root && file.startsWith(root + "/") ? file.slice(root.length + 1) : file;
    const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    return (
      <div className="pane-header" onPointerDown={(e) => startPaneDrag(e, paneId)}>
        <div className="pane-id" title={file}>
          <span className={`edit-dot${dirty ? " dirty" : ""}`} aria-label={dirty ? "Unsaved changes" : undefined} />
          <span className="pane-name">{basename(file)}</span>
          {/* LRM keeps a leading "/" in place under the rtl ellipsis trick. */}
          {folder && <span className="pane-folder hide-tight">{"\u200e" + folder}</span>}
        </div>
        <PaneActions paneId={paneId} editor={file} />
      </div>
    );
  }

  if (pane.browser) {
    return (
      <div className="pane-header" onPointerDown={(e) => startPaneDrag(e, paneId)}>
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
    <div className="pane-header" onPointerDown={(e) => startPaneDrag(e, paneId)}>
      <div className="pane-id">
        {v ? <StatusGlyph state={v} /> : <StatusGlyph state="shell" busy={!!running} />}
        {custom && <AgentChip agent={custom} />}
        {account && (agent || pane.account ? <AccountSwitch paneId={paneId} account={account} /> : <span className="account-chip">{account}</span>)}
        <span className="pane-name" title={dir}>
          {pane.launcher ? "New tab" : basename(dir) || "~"}
        </span>
        {(agent || pane.account) && <EffortChip paneId={paneId} />}
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
        {task && (
          <span className={`pane-task hide-narrow ${task.status}`} title={`Attached task (${task.status}): ${task.title}`}>
            ◆ {task.title}
          </span>
        )}
      </div>
      <div className="pane-end">
        {voiceState !== "idle" && <span className={`voice-dot ${voiceState}`} title={`Dictation: ${voiceState}`} />}
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
