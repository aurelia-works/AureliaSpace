import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { formatCost, formatTokens } from "../lib/format";
import { handOff } from "../lib/handoff";
import { answerPermission, permissionOptions, type PermissionChoice } from "../lib/permissions";
import { useMetrics } from "../store/metrics";

/** Rows live inside a <button>, so these are role=button spans that never trigger the row's own click. */
function Act({ cls, onRun, children }: { cls?: string; onRun(): void; children: string }) {
  const run = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onRun();
  };
  return (
    <span role="button" tabIndex={0} className={`mini-btn ${cls ?? ""}`} onClick={run} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && run(e)}>
      {children}
    </span>
  );
}

/** Allow / Always / Deny, shown only while a permission dialog is actually on screen in the pane. */
export function PermissionButtons({ paneId }: { paneId: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 700);
    return () => clearInterval(id);
  }, []);
  const opts = permissionOptions(paneId);
  if (!opts) return null;
  const ask = (c: PermissionChoice) => () => {
    answerPermission(paneId, c);
    tick((n) => n + 1);
  };
  return (
    <span className="perm-buttons">
      <Act cls="primary" onRun={ask("allow")}>Allow</Act>
      {opts.always && <Act onRun={ask("always")}>Always</Act>}
      <Act cls="danger" onRun={ask("deny")}>Deny</Act>
    </span>
  );
}

/** Context bar, tokens and cost; a hot marker with a hand-off button when burning fast. */
export function MetricsLine({ paneId }: { paneId: string }) {
  const m = useMetrics((s) => s.byPane[paneId]);
  if (!m || (!m.totalTokens && !m.contextTokens)) return null;
  const level = m.contextPct > 85 ? "hot" : m.contextPct > 65 ? "warn" : "";
  return (
    <span className="metrics-line">
      <span className="ctx-bar" title={`Context ${formatTokens(m.contextTokens)} (${Math.round(m.contextPct)}%)`}>
        <span className={`ctx-fill ${level}`} style={{ width: `${m.contextPct}%` }} />
      </span>
      <span>{Math.round(m.contextPct)}%</span>
      <span title="Input + output, cache included">{formatTokens(m.totalTokens)}</span>
      <span title="Estimated at API prices">{formatCost(m.costUsd)}</span>
      {m.hot && (
        <>
          <span className="hot-tag" title={`${formatTokens(m.tokensPerMin)} tokens/min`}>hot</span>
          <Act onRun={() => handOff(paneId)}>Hand off</Act>
        </>
      )}
    </span>
  );
}
