import { useSyncExternalStore } from "react";
import { label, useAgents, type AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { notify } from "./notify";

/** Amber (and the one-time notification) once this fraction of the TTL is left. */
export const WARN_FRACTION = 0.15;

export const cacheTtlMs = () => (useConfig.getState().config?.cache?.ttlMinutes === 5 ? 5 : 60) * 60_000;

export type CacheState =
  | { kind: "none" }
  | { kind: "live" }
  | { kind: "warm" | "warn"; remainingMs: number }
  | { kind: "cold" };

export function cacheState(s: AgentSession | undefined, now: number, ttl = cacheTtlMs()): CacheState {
  if (!s?.lastRequestAt) return { kind: "none" };
  if (s.status === "working") return { kind: "live" };
  const remainingMs = s.lastRequestAt + ttl - now;
  if (remainingMs <= 0) return { kind: "cold" };
  return { kind: remainingMs < ttl * WARN_FRACTION ? "warn" : "warm", remainingMs };
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

/** Desktop notification, once per session per cache window, when an idle agent's cache is about to cool. */
export function startCacheWatch() {
  const notified = new Map<string, number>();
  setInterval(() => {
    const cfg = useConfig.getState().config;
    if (!cfg || cfg.notifications === false) return;
    const t = Date.now();
    const ttl = cacheTtlMs();
    const sessions = useAgents.getState().sessions;
    for (const id of notified.keys()) if (!sessions[id]) notified.delete(id);
    for (const s of Object.values(sessions)) {
      if (s.status !== "idle" && s.status !== "needs_input") continue;
      const c = cacheState(s, t, ttl);
      if (c.kind !== "warn" || notified.get(s.paneId) === s.lastRequestAt) continue;
      notified.set(s.paneId, s.lastRequestAt!);
      const mins = Math.ceil(c.remainingMs / 60_000);
      void notify(`${label(s)}: cache cools ${c.remainingMs < 60_000 ? "in under a minute" : `in ${mins} min`}`, "The next message will re-write the whole context at a higher cost.");
    }
  }, 1000);
}
