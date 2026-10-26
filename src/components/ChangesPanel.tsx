import { useEffect, useState } from "react";
import { sendChat, useChat } from "../lib/chat";
import { parseDiff, type DiffFile } from "../lib/diff";
import { ipc, type Diff } from "../lib/ipc";
import { openFile } from "../lib/openFile";
import { useAgents } from "../store/agents";
import { paneDir } from "../store/git";
import { useLayout } from "../store/layout";
import { usePrs } from "../store/prs";
import { useUi } from "../store/ui";
import { RerunIcon } from "./Icons";

type Scope = "turn" | "branch" | "uncommitted";

const SCOPES: { scope: Scope; label: string; title: string }[] = [
  { scope: "turn", label: "This turn", title: "What the thread's last turn changed (since the checkpoint before its last prompt)" },
  { scope: "branch", label: "Branch", title: "Everything this branch changes against its base (origin's default branch, main or master)" },
  { scope: "uncommitted", label: "Uncommitted", title: "Changes not committed yet, against HEAD" },
];

function FileDiff({ file, root, open, toggle }: { file: DiffFile; root: string; open: boolean; toggle: () => void }) {
  return (
    <section className="diff-file side">
      <header onClick={toggle}>
        <span className={`chev${open ? " open" : ""}`} aria-hidden>
          ›
        </span>
        <span className={`diff-status ${file.status}`}>{file.status[0].toUpperCase()}</span>
        <span
          className="diff-path"
          title={`${file.path}\nClick to open`}
          onClick={(e) => {
            e.stopPropagation();
            void openFile(`${root}/${file.path}`, file.lines.find((l) => l.kind === "add")?.line);
          }}
        >
          {file.path}
        </span>
        <span className="diff-counts">
          <span className="add">+{file.adds}</span> <span className="del">−{file.dels}</span>
        </span>
      </header>
      {open && (
        <div className="diff-lines">
          {file.binary && <div className="diff-note">Binary file</div>}
          {file.lines.map((l, i) =>
            l.kind === "hunk" ? (
              <div key={i} className="diff-line hunk">
                {l.text ? `@@ ${l.text}` : "@@"}
              </div>
            ) : (
              <div key={i} className={`diff-line ${l.kind}`}>
                <span className="ln">{l.line}</span>
                <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                <span className="code">{l.text || " "}</span>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The focused thread's changes, beside it: its last turn (from the checkpoint taken before
 * the prompt), its whole branch, or what's uncommitted. Reloads when the thread's turn ends.
 */
export function ChangesPanel() {
  const paneId = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const status = useAgents((s) => (paneId ? s.sessions[paneId]?.status : undefined));
  const chatStatus = useChat((s) => (paneId ? s.byPane[paneId]?.status : undefined));
  const [scope, setScope] = useState<Scope>("turn");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const dir = paneId ? paneDir(paneId) : undefined;
    if (!paneId || !dir) {
      setDiff(null);
      setError("No thread selected.");
      return;
    }
    let live = true;
    setLoading(true);
    (scope === "uncommitted" ? ipc.gitDiff(dir) : ipc.diffScope(dir, paneId, scope))
      .then((d) => {
        if (!live) return;
        setDiff(d);
        setError(undefined);
      })
      .catch((e) => {
        if (!live) return;
        setDiff(null);
        setError(String(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // Status changes: a finished turn (or a new one) changes what there is to show.
  }, [paneId, scope, status, chatStatus, nonce]);

  const files = diff ? parseDiff(diff.diff) : [];
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const dels = files.reduce((n, f) => n + f.dels, 0);
  const many = files.length > 6;

  return (
    <div className="changes">
      <div className="changes-head">
        <div className="seg" role="tablist" aria-label="Which changes">
          {SCOPES.map((s) => (
            <button key={s.scope} role="tab" aria-selected={scope === s.scope} className={scope === s.scope ? "on" : ""} title={s.title} onClick={() => setScope(s.scope)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className={`icon-btn sm${loading ? " spinning" : ""}`} title="Reload" aria-label="Reload" onClick={() => setNonce((n) => n + 1)}>
          <RerunIcon />
        </button>
      </div>
      {error ? (
        <p className="changes-empty">{error}</p>
      ) : !files.length ? (
        <p className="changes-empty">{loading ? "Loading…" : "No changes."}</p>
      ) : (
        <>
          <div className="changes-summary">
            <span>
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            <span className="diff-counts">
              <span className="add">+{adds}</span> <span className="del">−{dels}</span>
            </span>
            {diff?.truncated && <span className="changes-cut">cut short</span>}
            <button className="link-btn" title="Uncommitted changes as a full page, with line comments for Claude" onClick={() => useUi.getState().set({ reviewOpen: true })}>
              Review
            </button>
          </div>
          <div className="changes-files">
            {files.map((f) => {
              // Many files: start folded so the list reads as an overview.
              const open = closed[f.path] === undefined ? !many : !closed[f.path];
              return <FileDiff key={f.path} file={f} root={diff!.root} open={open} toggle={() => setClosed({ ...closed, [f.path]: open })} />;
            })}
          </div>
          {paneId && <PrActions paneId={paneId} />}
        </>
      )}
    </div>
  );
}

/** Under a chat's diff: babysit its PR, or ask Claude to open one or to commit and push. */
function PrActions({ paneId }: { paneId: string }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const pr = usePrs((s) => {
    const d = paneDir(paneId);
    return d ? s.byDir[d] : undefined;
  });
  const busy = useChat((s) => s.byPane[paneId]?.status === "working");
  if (pane?.mode !== "chat") return null;
  const ask = (text: string) => void sendChat(paneId, text);
  return (
    <div className="pact">
      {pr?.state === "OPEN" && (
        <button
          className="btn"
          aria-pressed={!!pane.babysit}
          title="Watch this PR and wake the thread on failed checks, new reviews or conflicts"
          onClick={() => useLayout.getState().updatePane(paneId, { babysit: !pane.babysit, babysitWakes: 0 })}
        >
          {pane.babysit ? "Babysitting" : "Babysit PR"}
        </button>
      )}
      <span className="sp" />
      {!pr && (
        <button className="btn" disabled={busy} title="Ask Claude to push the branch and open a pull request" onClick={() => ask("Push this branch and open a pull request for it.")}>
          Open PR
        </button>
      )}
      <button className="btn solid" disabled={busy} title="Ask Claude to commit these changes and push" onClick={() => ask("Commit these changes with a clear message and push.")}>
        Commit and push
      </button>
    </div>
  );
}
