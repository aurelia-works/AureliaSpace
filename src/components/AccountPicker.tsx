import { useEffect, useState } from "react";
import { launchClaude } from "../lib/launch";
import { useConfig } from "../store/config";
import { useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { UsageMeter } from "./UsageMeter";

/** Launch a pane "as" a Claude account: sets CLAUDE_CONFIG_DIR and runs `claude`. */
export function AccountPicker() {
  const picker = useUi((s) => s.accountPicker);
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const worktree = useUi((s) => s.useWorktree);
  const usage = useUsage((s) => s.usage);
  const fetchedAt = useUsage((s) => s.fetchedAt);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!picker) return;
    setIndex(0);
    accounts.forEach((a) => useUsage.getState().refresh(a.name));
  }, [picker, accounts]);

  if (!picker) return null;
  const close = () => useUi.getState().set({ accountPicker: null });
  const { target, task } = picker;
  const setTarget = (t: "split" | "tab") => useUi.getState().set({ accountPicker: { target: t, task } });
  const toggleWorktree = () => useUi.getState().set({ useWorktree: !worktree });

  const launch = (name: string, where = target) => {
    close();
    launchClaude({ account: name, where, worktree, task });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "w" && !e.metaKey) toggleWorktree();
    else if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, accounts.length - 1));
    else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
    else if (e.key === "Tab") setTarget(target === "split" ? "tab" : "split");
    else if (e.key === "Enter" && accounts[index]) launch(accounts[index].name, e.shiftKey ? (target === "split" ? "tab" : "split") : target);
    else if (/^[1-9]$/.test(e.key) && accounts[Number(e.key) - 1]) launch(accounts[Number(e.key) - 1].name);
    else return;
    e.preventDefault();
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal picker" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="modal-head">
          <h2>{task ? "Start task with Claude as…" : "Open Claude as…"}</h2>
          <div className="seg">
            <button className={target === "split" ? "on" : ""} onClick={() => setTarget("split")}>
              Split
            </button>
            <button className={target === "tab" ? "on" : ""} onClick={() => setTarget("tab")}>
              New tab
            </button>
          </div>
        </div>
        {task && <div className="picker-task">◆ {task.title}</div>}
        <label className="picker-option">
          <input type="checkbox" checked={worktree} onChange={toggleWorktree} />
          <span>
            Own git worktree <span className="hint inline">new branch from HEAD, so parallel agents don't collide · W</span>
          </span>
        </label>
        <ul className="picker-list">
          {accounts.map((a, i) => (
            <li key={a.name}>
              <button className={i === index ? "sel" : ""} onMouseEnter={() => setIndex(i)} onClick={() => launch(a.name)}>
                <span className="picker-key">{i + 1}</span>
                <span className="picker-name">{a.name}</span>
                <span className="picker-dir">{a.configDir}</span>
                <UsageMeter usage={fetchedAt[a.name] ? usage[a.name] : undefined} />
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-foot">
          ↑↓ select · ↵ open · ⇧↵ open in {target === "split" ? "new tab" : "split"} · Tab toggles target · accounts are picked manually, never rotated automatically
        </div>
      </div>
    </div>
  );
}
