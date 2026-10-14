import { useMemo, useState } from "react";
import { create } from "zustand";
import { basename } from "../lib/format";
import { ipc, type Problem } from "../lib/ipc";
import { openFile } from "../lib/openFile";
import { focusedPaneId } from "../store/layout";
import { useFocusedProject } from "./FilesPanel";
import { RerunIcon } from "./Icons";

interface Check {
  problems: Problem[];
  ran: string[];
  at: number;
  seconds: number;
  error?: string;
}

/** Last check per project root, so switching views or panes doesn't rerun the checkers. */
const useChecks = create<{ byRoot: Record<string, Check>; running: Record<string, boolean> }>(() => ({ byRoot: {}, running: {} }));

async function runCheck(root: string) {
  if (useChecks.getState().running[root]) return;
  useChecks.setState((s) => ({ running: { ...s.running, [root]: true } }));
  const t0 = performance.now();
  let check: Check;
  try {
    const r = await ipc.checkProject(root);
    check = { ...r, at: Date.now(), seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    check = { problems: [], ran: [], at: Date.now(), seconds: 0, error: String(e) };
  }
  useChecks.setState((s) => ({ byRoot: { ...s.byRoot, [root]: check }, running: { ...s.running, [root]: false } }));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The project's own checkers (tsc, cargo check) as a clickable list (⇧⌘M). */
export function ProblemsPanel() {
  const { root } = useFocusedProject();
  const check = useChecks((s) => (root ? s.byRoot[root] : undefined));
  const running = useChecks((s) => (root ? !!s.running[root] : false));
  const [warnings, setWarnings] = useState(true);

  const groups = useMemo(() => {
    const by = new Map<string, Problem[]>();
    for (const p of check?.problems ?? []) if (warnings || p.severity === "error") by.set(p.path, [...(by.get(p.path) ?? []), p]);
    return [...by.entries()];
  }, [check, warnings]);
  const errors = check?.problems.filter((p) => p.severity === "error").length ?? 0;
  const warns = (check?.problems.length ?? 0) - errors;
  const rel = (p: string) => (root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p);

  return (
    <div className="nav-files">
      <div className="nav-subhead" title={root}>
        <span className="nav-subhead-name">
          {check && !check.error ? (
            <>
              <span className={errors ? "count err" : "count"}>{plural(errors, "error")}</span> · <span className="count">{plural(warns, "warning")}</span>
            </>
          ) : (
            basename(root ?? "") || "No folder"
          )}
        </span>
        <button className={`toggle${warnings ? " on" : ""}`} title="Show warnings" aria-pressed={warnings} onClick={() => setWarnings(!warnings)}>
          ⚠
        </button>
        <button className="icon-btn sm" disabled={!root || running} onClick={() => root && runCheck(root)} title="Run the checkers" aria-label="Run the checkers">
          <RerunIcon width={12} height={12} className={running ? "spin" : undefined} />
        </button>
      </div>
      <div className="file-tree search-results">
        {!root && <p className="empty">Focus a pane to check its project.</p>}
        {root && !check && !running && (
          <div className="empty">
            <p>Runs this project's own type checkers and lists what they find.</p>
            <button className="btn" onClick={() => runCheck(root)}>
              Check {basename(root)}
            </button>
          </div>
        )}
        {running && !check && <p className="empty">Running tsc / cargo check…</p>}
        {check?.error && <p className="empty">{check.error}</p>}
        {check && !check.error && !check.problems.length && <p className="empty">No problems. ✓</p>}
        {groups.map(([path, ps]) => (
          <div key={path} className="search-group">
            <div className="search-file" title={path} onClick={() => void openFile(path, ps[0].line, ps[0].col, { fromPane: focusedPaneId() })}>
              <span className="file-name">{basename(path)}</span>
              <span className="search-dir">{rel(path).slice(0, -basename(path).length - 1)}</span>
              <span className="search-count">{ps.length}</span>
            </div>
            {ps.map((p, i) => (
              <div
                key={i}
                className={`search-hit problem ${p.severity}`}
                title={`${p.source}: ${p.message}`}
                onClick={() => void openFile(p.path, p.line, p.col, { fromPane: focusedPaneId() })}
              >
                <span className="search-ln">{p.line}</span>
                <span className="search-text">{p.message}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="nav-foot">
        {running
          ? "Checking…"
          : check && !check.error
            ? `${check.ran.join(" · ")} · ${check.seconds.toFixed(1)} s · ${new Date(check.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "tsc --noEmit and cargo check, run on demand"}
      </p>
    </div>
  );
}
