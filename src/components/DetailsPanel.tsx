import { useEffect, useState, type ReactNode } from "react";
import { threadName } from "../lib/chain";
import { useChat } from "../lib/chat";
import { formatTokens } from "../lib/format";
import { MODES, modeKey } from "../lib/permissionMode";
import { prAttention } from "../lib/threads";
import { ipc } from "../lib/ipc";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { setBabysit, usePrs } from "../store/prs";
import { toast, useUi } from "../store/ui";
import { stateLabel, visualOf } from "./StatusGlyph";

const TRUNKS = new Set(["main", "master", "trunk", "develop"]);

function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="detail-row" title={title}>
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}

const DEFAULT_NOTE = "Pick up from there.";

/** "When this finishes, wake that thread": the other Claude threads, and the note it sends them. */
function ThenSection({ paneId }: { paneId: string }) {
  const then = useLayout((s) => s.panes[paneId]?.then);
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const others = tabs.flatMap((t) => paneIds(t.root)).filter((id) => id !== paneId && (panes[id]?.account || panes[id]?.mode === "chat"));
  const sessions = useAgents((s) => s.sessions);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState(DEFAULT_NOTE);
  const update = useLayout.getState().updatePane;
  if (!others.length && !then) return null;
  return (
    <section className="rail-section">
      <h3 className="rail-head">When it finishes</h3>
      {then ? (
        <>
          <Row label="Wakes">{threadName(then.paneId)}</Row>
          <Row label="With" title={then.text}>
            {then.text || "its last reply"}
          </Row>
          <div className="detail-actions">
            <button className="btn" onClick={() => update(paneId, { then: undefined })}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <form
          className="detail-then"
          onSubmit={(e) => {
            e.preventDefault();
            const to = target || others[0];
            if (to) update(paneId, { then: { paneId: to, text: note } });
          }}
        >
          <label className="detail-row">
            <span className="detail-label">Wake</span>
            <select className="detail-input" value={target || others[0]} onChange={(e) => setTarget(e.target.value)}>
              {others.map((id) => (
                <option key={id} value={id}>
                  {threadName(id)}
                  {sessions[id] ? ` (${stateLabel[visualOf(sessions[id])]})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="detail-row">
            <span className="detail-label">With</span>
            <input className="detail-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note after its last reply" />
          </label>
          <div className="detail-actions">
            <button className="btn" type="submit" title="Once, on this thread's next finished turn: the other thread gets this thread's last reply and your note">
              Wake it when this finishes
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Everything about the focused thread in one place: where it works, its branch and PR, and what it has cost. */
export function DetailsPanel() {
  const paneId = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const pane = useLayout((s) => (paneId ? s.panes[paneId] : undefined));
  const agent = useAgents((s) => (paneId ? s.sessions[paneId] : undefined));
  const chat = useChat((s) => (paneId ? s.byPane[paneId] : undefined));
  const dir = paneId ? paneDir(paneId) : undefined;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const pr = usePrs((s) => (dir ? s.byDir[dir] : undefined));
  // Looking at the PR here counts as having seen its comments.
  useEffect(() => {
    if (paneId && pr) useLayout.getState().updatePane(paneId, { prSeenFeedback: pr.feedback });
  }, [paneId, pr?.feedback]);
  if (!paneId || !pane) return <p className="changes-empty">No thread selected.</p>;

  const isClaude = !!agent || !!pane.account;
  const tokens = chat?.tokens || pane.chatTokens;
  const cost = chat?.costUsd || pane.chatCost;
  // Comments count as read here, so only problems that still need doing.
  const attention = prAttention(pr, pr?.feedback);
  const canBabysit = isClaude && !!git && !git.detached && !TRUNKS.has(git.branch) && pr?.state !== "MERGED";
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast("Copied"));

  return (
    <div className="details">
      {(agent || pane.account || chat) && (
        <section className="rail-section">
          <h3 className="rail-head">Thread</h3>
          {agent && <Row label="Status">{agent.status === "working" && agent.tool ? `Working: ${agent.tool}` : stateLabel[visualOf(agent)]}</Row>}
          {pane.account && <Row label="Account">{pane.account}</Row>}
          {(chat?.model || pane.chatModel) && <Row label="Model">{chat?.model ?? pane.chatModel}</Row>}
          {(agent?.permissionMode || chat?.mode) && <Row label="Mode">{MODES[modeKey(chat?.mode ?? agent?.permissionMode)]?.label ?? chat?.mode ?? agent?.permissionMode}</Row>}
          {chat?.context && (
            <Row label="Context" title={`${formatTokens(chat.context.totalTokens)} of ${formatTokens(chat.context.maxTokens)}`}>
              <span className="detail-meter">
                <span style={{ width: `${Math.min(100, chat.context.percentage)}%` }} />
              </span>
              {Math.round(chat.context.percentage)}%
            </Row>
          )}
          {!!tokens && <Row label="Tokens">{formatTokens(tokens)}</Row>}
          {!!cost && <Row label="Cost">${cost.toFixed(2)}</Row>}
          {pane.claudeSession && (
            <Row label="Session" title="Click to copy">
              <button className="link-btn mono" onClick={() => copy(pane.claudeSession!)}>
                {pane.claudeSession.slice(0, 8)}
              </button>
            </Row>
          )}
        </section>
      )}

      <section className="rail-section">
        <h3 className="rail-head">Workspace</h3>
        {dir && (
          <Row label="Folder" title={`${dir}\nClick to show in Finder`}>
            <button className="link-btn mono ellipsis" onClick={() => void ipc.openPath(dir).catch((e) => toast(String(e), true))}>
              {dir.replace(/^\/Users\/[^/]+/, "~")}
            </button>
          </Row>
        )}
        {git ? (
          <>
            <Row label="Branch">
              <span className="mono">{git.branch}</span>
              {git.detached && " (detached)"}
            </Row>
            {git.worktree && <Row label="Worktree">of {git.repo.split("/").pop()}</Row>}
          </>
        ) : (
          dir && <Row label="Git">not a repository</Row>
        )}
        {isClaude && dir && git && (
          <Row label="Checkpoints">
            <button className="link-btn" onClick={() => useUi.getState().set({ checkpointsPaneId: paneId })}>
              Show and restore…
            </button>
          </Row>
        )}
      </section>

      {git && !git.detached && !TRUNKS.has(git.branch) && (
        <section className="rail-section">
          <h3 className="rail-head">Pull request</h3>
          {pr ? (
            <>
              <Row label="PR">
                <button className="link-btn" title={pr.url} onClick={() => void ipc.openUrl(pr.url)}>
                  #{pr.number} {pr.title}
                </button>
              </Row>
              <Row label="State">
                {[pr.state.toLowerCase(), pr.draft && "draft", pr.conflicts && "conflicts"].filter(Boolean).join(", ")}
                {pr.state === "OPEN" && pr.checks !== "none" && (
                  <span className={`detail-checks ${pr.checks}`}>
                    · checks {pr.checks}
                    {pr.failing.length > 0 && `: ${pr.failing.join(", ")}`}
                  </span>
                )}
              </Row>
              {pr.review && <Row label="Review">{pr.review.toLowerCase().replace(/_/g, " ")}</Row>}
            </>
          ) : (
            <p className="changes-empty">No PR for this branch yet.</p>
          )}
          {attention && <p className="detail-attn">Needs you: {attention}</p>}
          {canBabysit && (
            <div className="detail-actions">
              <button
                className="btn"
                title="Let this agent push the branch, open a PR and fix failed checks, reviews and conflicts as they come in. It never merges."
                onClick={() => setBabysit(paneId, !pane.babysit)}
              >
                {pane.babysit ? `Stop babysitting (${pane.babysitWakes ?? 0} wakes)` : "Babysit this PR"}
              </button>
            </div>
          )}
        </section>
      )}

      {isClaude && <ThenSection paneId={paneId} />}
    </div>
  );
}
