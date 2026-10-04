import { useEffect, useState } from "react";
import { startDir } from "../lib/launch";
import { useConfig } from "../store/config";
import { focusedPaneId, useLayout, type NewPaneOpts } from "../store/layout";
import { toast, useUi } from "../store/ui";

const grids = [
  { n: 2, rows: 1, cols: 2 },
  { n: 4, rows: 2, cols: 2 },
  { n: 6, rows: 2, cols: 3 },
  { n: 9, rows: 3, cols: 3 },
  { n: 12, rows: 3, cols: 4 },
  { n: 16, rows: 4, cols: 4 },
];

function GridGlyph({ rows, cols }: { rows: number; cols: number }) {
  return (
    <span className="grid-glyph" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {Array.from({ length: rows * cols }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/** Opens a new tab laid out as an even grid of shells or Claude panes (⌘G). */
export function GridPicker() {
  const open = useUi((s) => s.gridOpen);
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const worktree = useUi((s) => s.useWorktree);
  const [grid, setGrid] = useState(1);
  /** "" = plain shells, else the account every pane runs Claude as. */
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  if (!open) return null;
  const close = () => useUi.getState().set({ gridOpen: false });
  const g = grids[grid];

  const create = async () => {
    setBusy(true);
    const layout = useLayout.getState();
    const from = focusedPaneId();
    const cwd = from ? layout.panes[from]?.cwd : undefined;
    const opts: NewPaneOpts[] = [];
    // One at a time: concurrent `git worktree add` calls fight over the repo lock.
    for (let i = 0; i < g.n; i++) {
      const dir = account ? await startDir(cwd, worktree, `${account}-${i + 1}`) : cwd;
      opts.push({ account: account || undefined, cwd: dir });
      if (account && worktree && dir === cwd) break; // creation failed; startDir already said why
    }
    while (opts.length < g.n) opts.push({ account: account || undefined, cwd });
    layout.newGridTab(g.rows, g.cols, opts);
    if (account && worktree && opts[0].cwd !== cwd) toast(`${g.n} worktrees created next to the repo`);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") setGrid((i) => Math.min(i + 1, grids.length - 1));
    else if (e.key === "ArrowLeft") setGrid((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && !busy) create();
    else return;
    e.preventDefault();
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal grid-picker" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="modal-head">
          <h2>New grid tab</h2>
        </div>
        <div className="grid-body">
          <div className="grid-options">
            {grids.map((x, i) => (
              <button key={x.n} className={i === grid ? "sel" : ""} onClick={() => setGrid(i)}>
                <GridGlyph rows={x.rows} cols={x.cols} />
                <span>{x.n}</span>
              </button>
            ))}
          </div>
          <h4>Each pane runs</h4>
          <div className="seg wide">
            <button className={account === "" ? "on" : ""} onClick={() => setAccount("")}>
              Shell
            </button>
            {accounts.map((a) => (
              <button key={a.name} className={account === a.name ? "on" : ""} onClick={() => setAccount(a.name)}>
                Claude · {a.name}
              </button>
            ))}
          </div>
          {account && (
            <label className="picker-option flush">
              <input type="checkbox" checked={worktree} onChange={() => useUi.getState().set({ useWorktree: !worktree })} />
              <span>
                One git worktree per pane <span className="hint inline">each agent gets its own branch</span>
              </span>
            </label>
          )}
        </div>
        <div className="modal-foot actions">
          <span className="msg">←→ size · ↵ create</span>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : `Open ${g.n} panes`}
          </button>
        </div>
      </div>
    </div>
  );
}
