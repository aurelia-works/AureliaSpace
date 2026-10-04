import { useEffect, useMemo, useState } from "react";
import { parseDiff, type DiffFile, type DiffLine } from "../lib/diff";
import { basename } from "../lib/format";
import { ipc } from "../lib/ipc";
import { focusTerminal, insertAtPrompt, writeToPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { focusedPaneId, useLayout } from "../store/layout";
import { toast, useUi } from "../store/ui";

interface Comment {
  path: string;
  line?: number;
  kind: DiffLine["kind"];
  code: string;
  text: string;
}

const keyOf = (path: string, i: number) => `${path}\0${i}`;

function composeMessage(comments: Comment[], note: string) {
  const parts = ["Review comments on the uncommitted changes. Please address each one:", ""];
  comments.forEach((c, i) => {
    const where = c.line ? `${c.path}:${c.line}` : c.path;
    const removed = c.kind === "del" ? " (removed line)" : "";
    parts.push(`${i + 1}. ${where}${removed}`);
    if (c.code.trim()) parts.push(`   > ${c.code.trim()}`);
    parts.push(...c.text.trim().split("\n").map((l) => `   ${l}`));
    parts.push("");
  });
  if (note.trim()) parts.push(note.trim());
  return parts.join("\n").trim();
}

function FileView({
  file,
  comments,
  editing,
  setEditing,
  saveComment,
}: {
  file: DiffFile;
  comments: Record<string, Comment>;
  editing: string | null;
  setEditing: (k: string | null) => void;
  saveComment: (k: string, c: Comment | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const startEdit = (k: string) => {
    setDraft(comments[k]?.text ?? "");
    setEditing(k);
  };

  return (
    <section className="diff-file">
      <header onClick={() => setOpen(!open)}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className={`diff-status ${file.status}`}>{file.status[0].toUpperCase()}</span>
        <span className="diff-path">{file.path}</span>
        <span className="diff-counts">
          <span className="add">+{file.adds}</span> <span className="del">−{file.dels}</span>
        </span>
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            startEdit(keyOf(file.path, -1));
          }}
        >
          comment on file
        </button>
      </header>
      {open && (
        <div className="diff-lines">
          {file.binary && <div className="diff-note">Binary file</div>}
          {[{ kind: "hunk", text: "" } as DiffLine, ...file.lines].map((l, idx) => {
            const i = idx - 1; // -1 is the file-level comment slot
            const k = keyOf(file.path, i);
            const c = comments[k];
            const row =
              i < 0 ? null : l.kind === "hunk" ? (
                <div className="diff-line hunk">{l.text ? `@@ ${l.text}` : "@@"}</div>
              ) : (
                <div className={`diff-line ${l.kind}${c ? " commented" : ""}`} onClick={() => startEdit(k)}>
                  <span className="ln">{l.line}</span>
                  <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  <span className="code">{l.text || " "}</span>
                  <span className="add-comment">+</span>
                </div>
              );
            return (
              <div key={idx}>
                {row}
                {editing === k ? (
                  <div className="diff-comment-edit">
                    <textarea
                      autoFocus
                      value={draft}
                      placeholder="What should Claude change here?  ⌘↵ save · Esc cancel"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.metaKey) {
                          saveComment(k, draft.trim() ? { path: file.path, line: i < 0 ? undefined : l.line, kind: l.kind, code: i < 0 ? "" : l.text, text: draft } : null);
                          setEditing(null);
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <div className="diff-comment-actions">
                      {c && (
                        <button
                          className="link-btn danger"
                          onClick={() => {
                            saveComment(k, null);
                            setEditing(null);
                          }}
                        >
                          delete
                        </button>
                      )}
                      <button onClick={() => setEditing(null)}>Cancel</button>
                      <button
                        className="primary"
                        onClick={() => {
                          saveComment(k, draft.trim() ? { path: file.path, line: i < 0 ? undefined : l.line, kind: l.kind, code: i < 0 ? "" : l.text, text: draft } : null);
                          setEditing(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  c && (
                    <div className="diff-comment" onClick={() => startEdit(k)}>
                      {c.text}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Uncommitted changes with per-line comments that are sent to a Claude pane (⇧⌘R). */
export function DiffReview() {
  const open = useUi((s) => s.reviewOpen);
  const sessions = useAgents((s) => s.sessions);
  const gitInfo = useGit((s) => s.info);
  const [state, setState] = useState<{ root: string; files: DiffFile[]; truncated: boolean } | { error: string } | null>(null);
  const [comments, setComments] = useState<Record<string, Comment>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<string>("");

  const load = () => {
    const pane = focusedPaneId();
    const dir = pane ? paneDir(pane) : undefined;
    if (!dir) return setState({ error: "The focused pane has no working directory yet." });
    setState(null);
    ipc.gitDiff(dir).then(
      (d) => setState({ root: d.root, files: parseDiff(d.diff), truncated: d.truncated }),
      (e) => setState({ error: String(e) }),
    );
  };

  useEffect(() => {
    if (!open) return;
    setComments({});
    setEditing(null);
    setNote("");
    load();
  }, [open]);

  const root = state && "root" in state ? state.root : undefined;
  const agents = useMemo(() => Object.values(sessions), [sessions]);

  // Default target: the focused pane if it's an agent, else an agent in the same repo.
  useEffect(() => {
    if (!open) return;
    const focused = focusedPaneId();
    if (focused && sessions[focused]) return setTarget(focused);
    const sameRepo = agents.find((a) => a.cwd && gitInfo[a.cwd]?.root === root);
    setTarget(sameRepo?.paneId ?? agents[0]?.paneId ?? "");
  }, [open, root]);

  if (!open) return null;
  const close = () => useUi.getState().set({ reviewOpen: false });
  const list = Object.values(comments);

  const send = () => {
    if (!target || (!list.length && !note.trim())) return;
    insertAtPrompt(target, composeMessage(list, note));
    // Let the bracketed paste land before submitting it.
    setTimeout(() => writeToPane(target, "\r"), 120);
    close();
    useLayout.getState().focusPane(target);
    requestAnimationFrame(() => focusTerminal(target));
    toast(`Sent ${list.length} comment${list.length === 1 ? "" : "s"} to Claude`);
  };

  const agentLabel = (paneId: string) => {
    const a = sessions[paneId];
    return `${a?.account ?? "claude"} · ${basename(a?.cwd) || "—"}`;
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal review"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !editing && close()}
        tabIndex={-1}
        ref={(el) => {
          if (el && !el.contains(document.activeElement)) el.focus();
        }}
      >
        <div className="modal-head">
          <h2>
            Review changes {root && <span className="hint inline">{basename(root)}</span>}
          </h2>
          <button className="link-btn" onClick={load}>
            reload
          </button>
        </div>
        <div className="review-body">
          {!state && <p className="empty">Loading diff…</p>}
          {state && "error" in state && <p className="empty">{state.error}</p>}
          {state && "files" in state && state.files.length === 0 && <p className="empty">No uncommitted changes.</p>}
          {state && "files" in state && (
            <>
              {state.truncated && <p className="hint">Diff is large and was truncated.</p>}
              {state.files.map((f) => (
                <FileView
                  key={f.path}
                  file={f}
                  comments={comments}
                  editing={editing}
                  setEditing={setEditing}
                  saveComment={(k, c) =>
                    setComments((prev) => {
                      const next = { ...prev };
                      if (c) next[k] = c;
                      else delete next[k];
                      return next;
                    })
                  }
                />
              ))}
            </>
          )}
        </div>
        <div className="review-foot">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Overall note (optional)" rows={2} />
          <div className="review-send">
            <span className="msg">
              {list.length} comment{list.length === 1 ? "" : "s"} · click a line to comment
            </span>
            {agents.length ? (
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.paneId} value={a.paneId}>
                    {agentLabel(a.paneId)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="hint inline">No Claude panes running</span>
            )}
            <button onClick={close}>Close</button>
            <button className="primary" onClick={send} disabled={!target || (!list.length && !note.trim())}>
              Send to Claude
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
