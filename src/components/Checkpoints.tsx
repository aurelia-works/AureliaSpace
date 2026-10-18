import { useEffect, useState } from "react";
import { since } from "./SessionExtras";
import { ipc, type Checkpoint } from "../lib/ipc";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { toast, useUi } from "../store/ui";

/**
 * The pane's checkpoints, newest first: each is the repo as it was just before that prompt.
 * Restore asks twice; it saves the current state as a checkpoint first, so it can be undone.
 */
export function Checkpoints() {
  const paneId = useUi((s) => s.checkpointsPaneId);
  const cwd = useAgents((s) => (paneId ? s.sessions[paneId]?.cwd : undefined)) ?? useLayout.getState().panes[paneId ?? ""]?.cwd;
  const [list, setList] = useState<Checkpoint[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setList(null);
    setArmed(null);
    if (paneId && cwd) ipc.checkpointList(cwd, paneId).then(setList, () => setList([]));
  }, [paneId, cwd]);

  if (!paneId) return null;
  const close = () => useUi.getState().set({ checkpointsPaneId: null });
  const restore = async (c: Checkpoint) => {
    if (armed !== c.sha) return setArmed(c.sha);
    if (!cwd) return;
    setBusy(true);
    try {
      const n = await ipc.checkpointRestore(cwd, paneId, c.sha);
      toast(`Restored ${n} file${n === 1 ? "" : "s"} to before “${c.label}”. What you had is saved as a checkpoint.`);
      close();
    } catch (e) {
      toast(`Couldn't restore: ${e}`, true);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal checkpoints" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="modal-head">
          <h2>Checkpoints</h2>
        </div>
        <div className="checkpoints-body">
          {list === null ? (
            <p className="empty">Loading…</p>
          ) : list.length === 0 ? (
            <p className="empty">None yet. Each prompt you send in a git repo saves one first, covering tracked and new files (not ignored ones).</p>
          ) : (
            <ol>
              {list.map((c) => (
                <li key={c.sha}>
                  <span className="cp-ago num">{since(Date.now() - c.at)}</span>
                  <span className="cp-label" title={c.label}>
                    {c.label === "Before restore" ? <em>Before a restore</em> : c.label}
                  </span>
                  <button className={armed === c.sha ? "danger" : ""} disabled={busy} onClick={() => restore(c)}>
                    {armed === c.sha ? "Click to confirm" : "Restore"}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="modal-foot actions">
          <span className="msg">Restores the files to just before that prompt; the conversation itself is unchanged.</span>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
