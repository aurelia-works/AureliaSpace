import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cacheSafe, currentEffort, useEffortPicks } from "../lib/effort";
import { formatCost, formatTokens } from "../lib/format";
import { useInlinePicking } from "../lib/inlineEffort";
import { useConfig } from "../store/config";
import { useLive, type LiveStatus } from "../store/live";

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function left(ms: number) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function rows(live: LiveStatus): [string, string][] {
  const out: [string, string][] = [];
  if (live.modelName || live.model) out.push(["Model", `${live.modelName ?? live.model}${live.effort ? ` · ${live.effort}` : ""}`]);
  if (live.contextTokens !== undefined)
    out.push(["Context", `${formatTokens(live.contextTokens)}${live.contextWindow ? ` of ${formatTokens(live.contextWindow)}` : ""}${live.contextPct !== undefined ? ` · ${live.contextPct.toFixed(1)}%` : ""}`]);
  if (live.costUsd !== undefined) out.push(["This session", `${formatCost(live.costUsd)} at API prices`]);
  const c = live.cache;
  if (c) {
    const state = c.warm && c.expiresAt ? `warm until ${clock(c.expiresAt)}${c.ttl ? ` (${c.ttl})` : ""}` : c.warm ? "warm" : "cold";
    out.push(["Prompt cache", state]);
    if (c.hitRatio !== undefined) out.push(["Cache hits", `${Math.round(c.hitRatio * 100)}% of ${c.requests ?? "?"} requests${c.misses ? ` · ${c.misses} missed` : ""}`]);
    if (c.lastMissCause) out.push(["Last miss", c.lastMissCause]);
  }
  if (live.fiveHour) out.push(["5-hour limit", `${live.fiveHour.pct.toFixed(1)}% used${live.fiveHour.resetsAt ? ` · resets in ${left(live.fiveHour.resetsAt)}` : ""}`]);
  if (live.sevenDay) out.push(["7-day limit", `${live.sevenDay.pct.toFixed(1)}% used${live.sevenDay.resetsAt ? ` · resets ${new Date(live.sevenDay.resetsAt).toLocaleDateString([], { weekday: "short" })}` : ""}`]);
  return out;
}

/**
 * A Claude pane's effort and session cost in one chip; click for what its status line
 * reports (model, context, cache, the account's limits) and what auto effort last chose.
 */
export function UsageChip({ paneId }: { paneId: string }) {
  const live = useLive((s) => s.byPane[paneId]);
  const pick = useEffortPicks((s) => s.byPane[paneId]);
  const picking = useInlinePicking((s) => !!s.panes[paneId]);
  const auto = useConfig((s) => s.config?.effort?.auto !== false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [pos]);

  if (!live || (live.costUsd === undefined && !live.effort)) return null;
  const level = currentEffort(paneId) ?? live.effort;
  const autoLine = !auto
    ? "Off (Settings → Effort)"
    : !cacheSafe(live.model)
      ? "Left alone: this model loses its cache on effort changes"
      : pick
        ? `${pick.switched ? `switched to ${pick.level}` : `kept ${level ?? ""}`.trim()} · ${pick.why}`
        : "Picks a level when you press Enter at Claude's prompt";
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos(pos ? null : { x: Math.min(r.left, window.innerWidth - 270), y: r.bottom + 4 });
  };

  return (
    <>
      <button ref={btn} className={`usage-chip hide-tight${pick?.switched ? " picked" : ""}${picking ? " picking" : ""}`} title="Effort, usage and cost" onClick={open}>
        {picking ? "picking…" : level}
        {level && live.costUsd !== undefined && !picking && <span className="usage-sep" aria-hidden>·</span>}
        {!picking && live.costUsd !== undefined && formatCost(live.costUsd)}
      </button>
      {pos &&
        createPortal(
          <div className="account-menu usage-menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="account-menu-head">Live from Claude Code · updated {clock(live.at)}</div>
            <dl>
              <div>
                <dt>Auto effort</dt>
                <dd>{autoLine}</dd>
              </div>
              {rows(live).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </>
  );
}
