import { create } from "zustand";
import { ipc, type Usage } from "../lib/ipc";
import { useConfig } from "./config";
import { useLayout } from "./layout";

interface UsageState {
  usage: Record<string, Usage | null>;
  fetchedAt: Record<string, number>;
  refresh(account: string, force?: boolean): Promise<void>;
}

const inflight = new Set<string>();

export const useUsage = create<UsageState>((set) => ({
  usage: {},
  fetchedAt: {},
  async refresh(account, force = false) {
    if (inflight.has(account)) return;
    inflight.add(account);
    try {
      const u = await ipc.fetchUsage(account, force);
      set((s) => ({
        usage: { ...s.usage, [account]: u },
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
