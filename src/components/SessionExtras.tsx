import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { formatCost, formatTokens } from "../lib/format";
import { handOff } from "../lib/handoff";
import { answerPermission, permissionOptions, type PermissionChoice } from "../lib/permissions";
import { submitToPane } from "../lib/terminals";
import { useMetrics } from "../store/metrics";
import { useNotices } from "../store/notifications";
import { toast } from "../store/ui";
import { ReplyIcon } from "./Icons";

/** Compact age: "now", "45s", "12m", "3h", "2d". */
export function since(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Rows live inside a <button>, so these are role=button spans that never trigger the row's own click. */
function Act({ cls, onRun, children, k }: { cls?: string; onRun(): void; children: string; k?: string }) {
  const run = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onRun();
  };
  return (
    <span role="button" tabIndex={0} className={`mini-btn ${cls ?? ""}`} onClick={run} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && run(e)}>
      {children}
      {k && <kbd>{k}</kbd>}
    </span>
  );
}

/** Allow / Always / Deny, shown only while a permission dialog is actually on screen in the pane. */
export function PermissionButtons({ paneId, keys }: { paneId: string; keys?: boolean }) {
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
      <Act cls="primary" onRun={ask("allow")} k={keys ? "Y" : undefined}>Allow</Act>
      {opts.always && <Act onRun={ask("always")} k={keys ? "A" : undefined}>Always</Act>}
      <Act cls="danger" onRun={ask("deny")} k={keys ? "N" : undefined}>Deny</Act>
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

/**
 * One-line reply typed into the pane's Claude prompt and submitted, without leaving the
 * current view. Clears that pane's waiting cards, since the reply answers them.
 */
export function ReplyBox({ paneId, placeholder = "Reply to Claude…", inputRef }: { paneId: string; placeholder?: string; inputRef?: React.Ref<HTMLInputElement> }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (!submitToPane(paneId, text)) return toast("That pane is gone", true);
    setDraft("");
    useNotices.getState().resolvePane(paneId, ["finished", "needs_input"]);
  };
  return (
    <form
      className="reply-box"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") (e.target as HTMLElement).blur();
      }}
    >
      <ReplyIcon width={12} height={12} />
      <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} spellCheck={false} aria-label={placeholder} />
      {draft.trim() && <kbd>↵</kbd>}
    </form>
  );
}
