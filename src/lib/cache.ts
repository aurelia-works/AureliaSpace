import { useSyncExternalStore } from "react";
import { label, useAgents, type AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { useLive, type LiveStatus } from "../store/live";
import { useMetrics } from "../store/metrics";
import { alertUser } from "../store/notifications";

/** Amber (and the one-time notification) once this fraction of the TTL is left... */
export const WARN_FRACTION = 0.15;
/** ...but never earlier than this long before it cools, so a 1-hour cache warns at 5 minutes. */
export const WARN_MAX_MS = 5 * 60_000;

export const cacheTtlMs = () => (useConfig.getState().config?.cache?.ttlMinutes === 5 ? 5 : 60) * 60_000;

/** Below this much context a cold cache costs too little to warn about. */
export const COLD_WARN_TOKENS = 40_000;

/**
 * The cache lifetime for one pane, best source first: what Claude Code reports, then the
 * lifetime its cache writes got in the transcript, then the setting.
 */
export function cacheTtlFor(paneId: string): number {
  const ttl = useLive.getState().byPane[paneId]?.cache?.ttl;
  if (ttl === "1h") return 60 * 60_000;
  if (ttl === "5m") return 5 * 60_000;
  return useMetrics.getState().byPane[paneId]?.cacheTtlMs ?? cacheTtlMs();
}

export type CacheState =
  | { kind: "none" }
  | { kind: "live" }
  | { kind: "warm" | "warn"; remainingMs: number }
  | { kind: "cold" };

export function cacheState(s: AgentSession | undefined, now: number, ttl = cacheTtlMs(), live?: LiveStatus): CacheState {
  // The CLI's own expiry is exact (it knows every request, subagents included); the hook
  // timestamp plus the lifetime is the fallback.
  const exact = live?.cache?.expiresAt ?? null;
  if (!s?.lastRequestAt && exact === null) return { kind: "none" };
  if (s?.status === "working") return { kind: "live" };
  const expires = exact ?? s!.lastRequestAt! + ttl;
  const remainingMs = expires - now;
  if (remainingMs <= 0) return { kind: "cold" };
  return { kind: remainingMs < Math.min(ttl * WARN_FRACTION, WARN_MAX_MS) ? "warn" : "warm", remainingMs };
}

export function formatRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.ceil(s / 60)}m`;
}

// One shared 1s ticker for every badge; it only runs while something is subscribed.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Current time, re-rendering the caller once a second (shared ticker). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}

/** Desktop notification, once per session per cache window, when an idle agent's cache is about to cool, and again when it has. */
export function startCacheWatch() {
  const notified = new Map<string, number>();
  const cooled = new Map<string, number>();
  setInterval(() => {
    const cfg = useConfig.getState().config;
    if (!cfg) return;
    const t = Date.now();
    const sessions = useAgents.getState().sessions;
    const live = useLive.getState().byPane;
    const metrics = useMetrics.getState().byPane;
    for (const id of notified.keys()) if (!sessions[id]) notified.delete(id);
    for (const id of cooled.keys()) if (!sessions[id]) cooled.delete(id);
    for (const s of Object.values(sessions)) {
      if (s.status !== "idle" && s.status !== "needs_input") continue;
      const c = cacheState(s, t, cacheTtlFor(s.paneId), live[s.paneId]);
      const stamp = live[s.paneId]?.cache?.expiresAt ?? s.lastRequestAt!;
      // It went cold after we warned about this same window (so a session restored cold stays quiet).
      if (c.kind === "cold" && notified.get(s.paneId) === stamp && cooled.get(s.paneId) !== stamp) {
        cooled.set(s.paneId, stamp);
        alertUser({
          kind: "cache",
          key: `cache:${s.paneId}`,
          paneId: s.paneId,
          sound: "cacheExpired",
          title: `${label(s)}: cache went cold`,
          body: "The next message will re-write the whole context at a higher cost.",
        });
        continue;
      }
      if (c.kind !== "warn" || notified.get(s.paneId) === stamp) continue;
      // Re-writing a small context is cheap; only a big one is worth an interruption.
      const tokens = live[s.paneId]?.contextTokens ?? metrics[s.paneId]?.contextTokens ?? 0;
      if (tokens < COLD_WARN_TOKENS) continue;
      notified.set(s.paneId, stamp);
      const mins = Math.ceil(c.remainingMs / 60_000);
      alertUser({
        kind: "cache",
        key: `cache:${s.paneId}`,
        paneId: s.paneId,
        title: `${label(s)}: cache cools ${c.remainingMs < 60_000 ? "in under a minute" : `in ${mins} min`}`,
        body: "The next message will re-write the whole context at a higher cost.",
      });
    }
  }, 1000);
}
