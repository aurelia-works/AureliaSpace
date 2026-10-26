import { basename } from "../lib/format";
import { ipc } from "../lib/ipc";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { usePrs } from "../store/prs";
import { useUi } from "../store/ui";
import { usePaneAgent } from "./AgentChip";
import { BottomPanelIcon, BranchIcon, GridIcon, PrIcon, RightPanelIcon, WorktreeIcon } from "./Icons";
import { useChatTitle } from "./ProjectsSidebar";

/** "AureliaSpace" → "AS", "mtr-addon" → "MA", "web" → "WE". */
export function repoBadge(name: string) {
  const caps = name.match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps.slice(0, 2).join("");
  const words = name.split(/[-_ .]+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * Above the stage: where you are (repo / thread, its branch and PR) and the three views of it:
 * Colony (every thread of the tab at once), a shell below it, and its changes on the right.
 */
export function ThreadHeader() {
  const single = useUi((s) => s.single);
  const board = useUi((s) => s.mode === "agents");
  const railOpen = useUi((s) => s.agentPanelOpen && s.railTab === "changes");
  const tab = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const paneId = tab?.focusedPaneId;
  const tabRoot = tab?.root;
  const pane = useLayout((s) => (paneId ? s.panes[paneId] : undefined));
  const sessions = useAgents((s) => s.sessions);
  const dir = paneId ? paneDir(paneId) : undefined;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const pr = usePrs((s) => (dir ? s.byDir[dir] : undefined));
  const title = useChatTitle(paneId ?? "");
  const custom = usePaneAgent(paneId ?? "");
  const ui = useUi.getState();

  const tools = (
    <div className="th-tools">
      <button className="ib" aria-label="Colony: every thread of this tab at once" title="Colony: every thread of this tab at once" aria-pressed={!single || board} onClick={() => ui.set(board ? { mode: "terminals" } : { single: !single })}>
        <GridIcon />
      </button>
      <button
        className="ib"
        aria-label="Shell below this thread"
        title="Open a shell below this thread (⇧⌘D)"
        onClick={() => {
          if (!paneId) return;
          useLayout.getState().splitPane(paneId, "column", { cwd: dir });
          ui.set({ single: false });
        }}
      >
        <BottomPanelIcon />
      </button>
      <button
        className="ib"
        aria-label="Changes"
        title="This thread's changes (⌘B)"
        aria-pressed={railOpen}
        onClick={() => ui.set(railOpen ? { agentPanelOpen: false } : { agentPanelOpen: true, railTab: "changes" })}
      >
        <RightPanelIcon />
      </button>
    </div>
  );

  if (board)
    return (
      <div className="thread-head">
        <div className="crumb">
          <h1>Board</h1>
          <span>· every agent, by what it needs</span>
        </div>
        <span className="sp" />
        {tools}
      </div>
    );

  if (!single) {
    const ids = tabRoot ? paneIds(tabRoot) : [];
    const working = ids.filter((id) => sessions[id]?.status === "working").length;
    return (
      <div className="thread-head">
        <div className="crumb">
          <h1>Colony</h1>
          <span className="num">
            · {ids.length} {ids.length === 1 ? "thread" : "threads"}
            {working ? `, ${working} working` : ""}
          </span>
        </div>
        <span className="sp" />
        {tools}
      </div>
    );
  }

  const repo = basename(git?.repo ?? dir) || "~";
  const agent = paneId ? sessions[paneId] : undefined;
  const name = title ?? (pane?.launcher ? "New thread" : pane?.browser ? "Browser" : pane?.editor ? basename(pane.editor.path) : custom?.name ?? (pane?.account || agent ? "Claude" : "Terminal"));
  const prTone = pr && (pr.state === "MERGED" ? "merged" : pr.conflicts || pr.checks === "fail" ? "bad" : pr.checks === "pass" ? "ok" : "");
  const prWhat = pr && (pr.state !== "OPEN" ? pr.state.toLowerCase() : pr.conflicts ? "conflicts" : pr.checks === "none" ? (pr.draft ? "draft" : "open") : `checks ${pr.checks}`);

  return (
    <div className="thread-head">
      <div className="crumb" title={dir}>
        <span className="mono-badge">{repoBadge(repo)}</span>
        {repo}
        <span>/</span>
        <h1>{name}</h1>
      </div>
      {git && (
        <span className={`chip${git.worktree ? " wt" : ""}`} title={`${git.detached ? "Detached HEAD" : "Branch"} ${git.branch}${git.worktree ? `\nWorktree: ${git.root}` : ""}`}>
          {git.worktree ? <WorktreeIcon width={13} height={13} /> : <BranchIcon width={13} height={13} />}
          {git.branch}
        </span>
      )}
      {pr && (
        <button className={`chip pr ${prTone}`} title={`PR #${pr.number}: ${pr.title}\nClick to open on GitHub`} onClick={() => void ipc.openUrl(pr.url)}>
          <PrIcon width={13} height={13} />#{pr.number} {prWhat}
        </button>
      )}
      <span className="sp" />
      {tools}
    </div>
  );
}
