import { label, useAgents } from "../store/agents";
import { useLive } from "../store/live";
import { price, useMetrics } from "../store/metrics";
import { useNotices } from "../store/notifications";
import { handoffAdvice } from "./advice";
import { cacheState, cacheTtlFor } from "./cache";
import { handOff } from "./handoff";

/**
 * Suggests a handoff for an idle Claude pane once its context is nearly full, or once its
 * cache has gone cold on a context big enough that the next message is expensive
 * (lib/advice.ts). One card per pane per reason per cache window, never a desktop alert.
 */
export function startHandoffAdvisor() {
  const shown = new Map<string, string>();
  setInterval(() => {
    const now = Date.now();
    const sessions = useAgents.getState().sessions;
    const live = useLive.getState().byPane;
    const metrics = useMetrics.getState().byPane;
    for (const id of shown.keys()) if (!sessions[id]) shown.delete(id);
    for (const s of Object.values(sessions)) {
      if (s.status !== "idle") continue;
      const l = live[s.paneId];
      const m = metrics[s.paneId];
      const contextTokens = l?.contextTokens ?? m?.contextTokens ?? 0;
      const contextWindow = l?.contextWindow ?? (m && m.contextPct ? (m.contextTokens * 100) / m.contextPct : 0);
      const advice = handoffAdvice({
        contextTokens,
        contextWindow,
        cacheCold: cacheState(s, now, cacheTtlFor(s.paneId), l).kind === "cold",
        inputPricePerMTok: price(l?.model ?? m?.model)[0],
      });
      if (!advice) continue;
      // Once per session and reason, and again after each new cache window.
      const stamp = `${s.sessionId}:${advice.reason}:${l?.cache?.expiresAt ?? s.lastRequestAt ?? ""}`;
      if (shown.get(s.paneId) === stamp) continue;
      shown.set(s.paneId, stamp);
      useNotices.getState().push({
        kind: "cache",
        key: `handoff:${s.paneId}`,
        paneId: s.paneId,
        title: `${label(s)}: ${advice.title}`,
        body: advice.body,
        sticky: true,
        actions: [{ label: "Hand off", tone: "primary", run: () => void handOff(s.paneId) }],
      });
    }
  }, 5000);
}
