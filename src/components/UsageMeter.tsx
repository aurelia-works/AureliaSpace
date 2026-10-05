import type { Forecast } from "../lib/forecast";
import type { Usage } from "../lib/ipc";
import { formatDuration, formatReset, useUsage } from "../store/usage";

/** Forecast as text: the run-out ETA when it beats the reset, else null. */
export function forecastText(f: Forecast | undefined): string | null {
  if (!f) return null;
  if (f.state === "full") return "limit reached";
  return f.state === "out" ? `out in ~${formatDuration(f.outAt! - Date.now())}` : null;
}

function forecastTip(f: Forecast | undefined): string {
  if (!f || f.state === "unknown") return " · forecast: not enough data yet";
  const rate = f.perHour !== undefined ? ` (${f.perHour.toFixed(1)}%/h)` : "";
  return f.state === "safe" ? ` · on pace to last until reset${rate}` : ` · ${forecastText(f)}${rate}`;
}

function level(pct: number) {
  return pct >= 90 ? "crit" : pct >= 70 ? "warn" : "ok";
}

function Meter({ label, pct, reset, fc, compact }: { label: string; pct: number | null; reset: string | null; fc?: Forecast; compact?: boolean }) {
  const v = pct ?? 0;
  const resetIn = formatReset(reset);
  const eta = forecastText(fc);
  return (
    <span className={`meter${eta ? " out" : ""}`} title={`${label} window: ${pct === null ? "unknown" : `${Math.round(v)}% used`}${resetIn ? ` · resets in ${resetIn}` : ""}${forecastTip(fc)}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className={`meter-fill ${level(v)}`} style={{ width: `${Math.min(100, v)}%` }} />
      </span>
      <span className="meter-value">{pct === null ? "–" : `${Math.round(v)}%`}</span>
      {eta && !compact && <span className="meter-eta">{eta}</span>}
      {eta && compact && <span className="meter-eta" aria-label={eta}>⚠</span>}
    </span>
  );
}

export function UsageMeter({ usage, compact }: { usage: Usage | null | undefined; compact?: boolean }) {
  // Callers pass the Usage object; its account is whichever slot holds it.
  const account = useUsage((s) => (usage ? Object.keys(s.usage).find((k) => s.usage[k] === usage) : undefined));
  const fc = useUsage((s) => (account ? s.forecasts[account] : undefined));
  if (usage === undefined) return <span className="usage muted">usage…</span>;
  if (usage === null) return <span className="usage muted" title="No usage data (not logged in, or fetch-usage.sh missing)">usage n/a</span>;
  return (
    <span className={`usage${compact ? " compact" : ""}`}>
      <Meter label="5h" pct={usage.fiveHour} reset={usage.fiveHourResetsAt} fc={fc?.["5h"]} compact={compact} />
      <Meter label="7d" pct={usage.sevenDay} reset={usage.sevenDayResetsAt} fc={fc?.["7d"]} compact={compact} />
    </span>
  );
}
