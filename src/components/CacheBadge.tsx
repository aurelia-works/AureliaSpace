import { cacheState, cacheTtlMs, formatRemaining, useNow } from "../lib/cache";
import type { AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { ThermometerIcon } from "./Icons";

const HELP =
  "Claude's prompt cache. Messages sent while it is warm are cheap and fast. Once it goes cold, the next message re-writes the whole context (1.25x input price for a 5 minute cache, 2x for 1 hour).";

/** Prompt-cache countdown for a Claude session. */
export function CacheBadge({ session }: { session: AgentSession | undefined }) {
  const now = useNow();
  useConfig((c) => c.config?.cache?.ttlMinutes); // re-render when the TTL setting changes
  const c = cacheState(session, now, cacheTtlMs());
  if (c.kind === "none") return null;
  const text = c.kind === "live" ? "cache live" : c.kind === "cold" ? "cold" : `cache ${formatRemaining(c.remainingMs)}`;
  const tip =
    c.kind === "live" ? "Claude is working, so every request refreshes the cache." : c.kind === "cold" ? `Cache expired. ${HELP}` : HELP;
  return (
    <span className={`cache-badge ${c.kind}`} title={tip}>
      <ThermometerIcon width={11} height={11} />
      {text}
    </span>
  );
}
