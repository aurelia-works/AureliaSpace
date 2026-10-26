import { useEffect } from "react";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { formatReset, useUsage } from "../store/usage";
import { AgentLogo } from "./AgentLogos";

const resetClock = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
};

/** What is LEFT on each account's 5-hour window, with the reset time and the week on hover. */
export function UsageStrip() {
  const accounts = useConfig((s) => s.config?.accounts) ?? [];
  const inUse = useLayout((s) => [...new Set(Object.values(s.panes).map((p) => p.account).filter(Boolean))].join("\n"));
  const usage = useUsage((s) => s.usage);
  const used = inUse ? inUse.split("\n") : [];
  const shown = used.length ? accounts.filter((a) => used.includes(a.name)) : accounts;
  const missing = shown.filter((a) => !(a.name in usage)).map((a) => a.name).join("\n");
  // Polling only covers accounts with panes open; fetch the rest once so the strip isn't empty.
  useEffect(() => {
    if (missing) missing.split("\n").forEach((a) => void useUsage.getState().refresh(a));
  }, [missing]);
  if (!shown.length) return null;

  return (
    <div className="usage-strip" role="group" aria-label="Usage left">
      <span className="usage-lbl">Left</span>
      {shown.map((a) => {
        const u = usage[a.name];
        const five = u?.fiveHour ?? null;
        const week = u?.sevenDay ?? null;
        const left = five === null ? null : Math.max(0, Math.round(100 - five));
        const weekLeft = week === null ? null : Math.max(0, Math.round(100 - week));
        const resetIn = formatReset(u?.fiveHourResetsAt);
        return (
          <button
            key={a.name}
            className={`u${left !== null && left < 20 ? " low" : ""}`}
            aria-label={left === null ? `${a.name}: usage unknown` : `${a.name}: ${left}% left, resets ${resetClock(u!.fiveHourResetsAt)}`}
            onClick={() => void useUsage.getState().refresh(a.name, true)}
          >
            <span className="u-logo">
              <AgentLogo logo="claude" size={13} />
            </span>
            <span className="u-name">{a.name}</span>
            <span className="u-pct num">{left === null ? "–" : `${left}%`}</span>
            <span className="u-bar">
              <b style={{ width: `${left ?? 0}%` }} />
            </span>
            <span className="u-tip" role="tooltip">
              <span className="u-tip-h">
                {a.name}
                <span>{u?.source === "live" ? "live" : "Claude"}</span>
              </span>
              <span className="u-tip-dl">
                <span className="k">5-hour window</span>
                <span className="v">{left === null ? "unknown" : `${left}% left`}</span>
                <span className="u-meter">
                  <b style={{ width: `${left ?? 0}%` }} />
                </span>
                <span className="k">Resets</span>
                <span className="v">{u?.fiveHourResetsAt ? `${resetClock(u.fiveHourResetsAt)}${resetIn ? `, in ${resetIn}` : ""}` : "not started"}</span>
                <span className="k">This week</span>
                <span className="v">{weekLeft === null ? "unknown" : `${weekLeft}% left`}</span>
                <span className="u-meter">
                  <b style={{ width: `${weekLeft ?? 0}%` }} />
                </span>
                <span className="k">Week resets</span>
                <span className="v">{resetClock(u?.sevenDayResetsAt ?? null) || "–"}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
