import type { Usage } from "../lib/ipc";
import { formatReset } from "../store/usage";

function level(pct: number) {
  return pct >= 90 ? "crit" : pct >= 70 ? "warn" : "ok";
}

function Meter({ label, pct, reset }: { label: string; pct: number | null; reset: string | null }) {
  const v = pct ?? 0;
  const resetIn = formatReset(reset);
  return (
    <span className="meter" title={`${label} window: ${pct === null ? "unknown" : `${Math.round(v)}% used`}${resetIn ? ` · resets in ${resetIn}` : ""}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className={`meter-fill ${level(v)}`} style={{ width: `${Math.min(100, v)}%` }} />
      </span>
      <span className="meter-value">{pct === null ? "–" : `${Math.round(v)}%`}</span>
    </span>
  );
}

export function UsageMeter({ usage, compact }: { usage: Usage | null | undefined; compact?: boolean }) {
  if (usage === undefined) return <span className="usage muted">usage…</span>;
  if (usage === null) return <span className="usage muted" title="No usage data (not logged in, or fetch-usage.sh missing)">usage n/a</span>;
  return (
    <span className={`usage${compact ? " compact" : ""}`}>
      <Meter label="5h" pct={usage.fiveHour} reset={usage.fiveHourResetsAt} />
      <Meter label="7d" pct={usage.sevenDay} reset={usage.sevenDayResetsAt} />
    </span>
  );
}
