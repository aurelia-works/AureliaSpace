import { cacheState, cacheTtlFor, formatRemaining, useNow } from "../lib/cache";
import type { AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { useLive } from "../store/live";
import { ThermometerIcon } from "./Icons";

const HELP =
  "Claude's prompt cache. Messages sent while it is warm are cheap and fast. Once it goes cold, the next message re-writes the whole context (1.25x input price for a 5 minute cache, 2x for 1 hour).";

/** Prompt-cache countdown for a Claude session. */
export function CacheBadge({ session }: { session: AgentSession | undefined }) {
  const now = useNow();
  useConfig((c) => c.config?.cache?.ttlMinutes); // re-render when the TTL setting changes
  const live = useLive((s) => (session ? s.byPane[session.paneId] : undefined));
  const c = cacheState(session, now, session ? cacheTtlFor(session.paneId) : undefined, live);
  if (c.kind === "none") return null;
  const text = c.kind === "live" ? "cache live" : c.kind === "cold" ? "cold" : `cache ${formatRemaining(c.remainingMs)}`;
  const pc = live?.cache;
  const stats = pc?.requests
    ? `\n\n${pc.requests} requests · ${Math.round((pc.hitRatio ?? 0) * 100)}% read from cache${pc.misses ? ` · ${pc.misses} miss${pc.misses === 1 ? "" : "es"}${pc.lastMissCause ? ` (last: ${pc.lastMissCause.replace(/_/g, " ")})` : ""}` : ""}${pc.ttl ? ` · ${pc.ttl} cache` : ""}`
    : "";
  const tip =
    (c.kind === "live" ? "Claude is working, so every request refreshes the cache." : c.kind === "cold" ? `Cache expired. ${HELP}` : HELP) + stats;
  return (
    <span className={`cache-badge ${c.kind}`} title={tip}>
      <ThermometerIcon width={11} height={11} />
      {text}
    </span>
  );
}
