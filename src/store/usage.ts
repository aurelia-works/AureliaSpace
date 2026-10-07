import { create } from "zustand";
import { FORECAST_5H, FORECAST_7D, forecast, trimAfterReset, type Forecast, type Sample } from "../lib/forecast";
import { ipc, type Usage } from "../lib/ipc";
import { useConfig } from "./config";
import { useLayout } from "./layout";
import { offerForAccount } from "../lib/limits";
import { alertUser } from "./notifications";

export type WindowId = "5h" | "7d";
export type Forecasts = Record<WindowId, Forecast>;

interface UsageState {
  usage: Record<string, Usage | null>;
  /** Run-out projection per account, recomputed on every fetch (history is in memory only). */
  forecasts: Record<string, Forecasts>;
  fetchedAt: Record<string, number>;
  refresh(account: string, force?: boolean): Promise<void>;
}

const inflight = new Set<string>();
const history = new Map<string, Record<WindowId, { samples: Sample[]; resetAt: number | null }>>();
const MAX_SAMPLES = 800;
/** Windows already alerted for, keyed by account + window + reset hour, so each period warns once. */
const alerted = new Set<string>();

const WINDOWS: { id: WindowId; pct: (u: Usage) => number | null; reset: (u: Usage) => string | null; opts: typeof FORECAST_5H; soonMs: number; name: string }[] = [
  { id: "5h", pct: (u) => u.fiveHour, reset: (u) => u.fiveHourResetsAt, opts: FORECAST_5H, soonMs: 60 * 60_000, name: "5-hour" },
  { id: "7d", pct: (u) => u.sevenDay, reset: (u) => u.sevenDayResetsAt, opts: FORECAST_7D, soonMs: 24 * 3600_000, name: "7-day" },
];

function parseT(iso: string | null): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** Records a sample, projects both windows, and warns once per window period. */
function track(account: string, u: Usage): Forecasts {
  const now = Date.now();
  const h = history.get(account) ?? { "5h": { samples: [], resetAt: null }, "7d": { samples: [], resetAt: null } };
  history.set(account, h);
  const out = {} as Forecasts;
  for (const w of WINDOWS) {
    const pct = w.pct(u);
    const resetAt = parseT(w.reset(u));
    if (pct !== null) {
      const cur = h[w.id];
      const samples = trimAfterReset(cur.samples, { t: now, pct }, cur.resetAt, resetAt);
      h[w.id] = { samples: samples.length > MAX_SAMPLES ? samples.slice(-MAX_SAMPLES) : samples, resetAt };
    }
    const f = forecast(h[w.id].samples, now, resetAt, w.opts);
    out[w.id] = f;
    const hot = (pct ?? 0) >= 90;
    const soon = f.state === "out" && f.outAt! - now <= w.soonMs;
    const period = `${account}:${w.id}:${resetAt === null ? "" : Math.round(resetAt / 3600_000)}`;
    if (pct !== null && (hot || soon) && !alerted.has(period)) {
      alerted.add(period);
      // At the cap, panes still working on this account get a "continue elsewhere" card instead.
      if (pct >= 100 && offerForAccount(account) > 0) continue;
      const left = resetAt === null ? "" : ` Resets in ${formatReset(w.reset(u))}.`;
      alertUser({
        kind: "limit",
        key: `limit:${account}:${w.id}`,
        title: `${account}: ${w.name} limit ${hot ? `at ${Math.round(pct)}%` : "running out"}`,
        body: soon ? `At this pace it runs out in ~${formatDuration(f.outAt! - now)}.${left}` : `${Math.round(pct)}% used.${left}`,
      });
    }
  }
  return out;
}

export const useUsage = create<UsageState>((set) => ({
  usage: {},
  forecasts: {},
  fetchedAt: {},
  async refresh(account, force = false) {
    if (inflight.has(account)) return;
    inflight.add(account);
    try {
      const u = await ipc.fetchUsage(account, force);
      const forecasts = u ? track(account, u) : null;
      set((s) => ({
        usage: { ...s.usage, [account]: u },
        forecasts: forecasts ? { ...s.forecasts, [account]: forecasts } : s.forecasts,
        fetchedAt: { ...s.fetchedAt, [account]: Date.now() },
      }));
    } catch {
      set((s) => ({ fetchedAt: { ...s.fetchedAt, [account]: Date.now() } }));
    } finally {
      inflight.delete(account);
    }
  },
}));

/** Refreshes usage for every account that has a pane open. */
export function startUsagePolling() {
  const tick = () => {
    const cfg = useConfig.getState().config;
    if (!cfg) return;
    const every = Math.max(30, cfg.usageRefreshSeconds) * 1000;
    const used = new Set(
      Object.values(useLayout.getState().panes)
        .map((p) => p.account)
        .filter((a): a is string => !!a),
    );
    const { fetchedAt, refresh } = useUsage.getState();
    used.forEach((a) => {
      if (Date.now() - (fetchedAt[a] ?? 0) >= every) refresh(a);
    });
  };
  tick();
  const id = setInterval(tick, 15_000);
  // New Claude panes get their usage immediately.
  const unsub = useLayout.subscribe((s, prev) => {
    if (s.panes !== prev.panes) tick();
  });
  return () => {
    clearInterval(id);
    unsub();
  };
}

/** "1h 40m" style duration for a forward-looking span in ms. */
export function formatDuration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export function formatReset(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  let s = Math.max(0, Math.round((t - Date.now()) / 1000));
  if (s === 0) return "now";
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
