/**
 * When to suggest handing a Claude session off to a fresh one, and what to say. Pure (no
 * imports) so `node --test` can run it; lib/handoffAdvisor.ts feeds it live numbers.
 *
 * Prices are relative to an uncached input token: a cache write costs 1.25×, a cache
 * read 0.1×. A turn on a cold cache re-writes the whole context, about 12.5× what the same
 * context costs warm, every time the cache cools again.
 */

const WRITE = 1.25;
const READ = 0.1;
/** Below this, a cold cache costs too little to interrupt anyone. */
export const COLD_ADVICE_TOKENS = 60_000;
/** Claude Code compacts near the top of the window, losing detail. */
export const FULL_ADVICE_PCT = 80;

export interface AdviceInput {
  contextTokens: number;
  contextWindow: number;
  cacheCold: boolean;
  /** $ per million uncached input tokens for the pane's model. */
  inputPricePerMTok: number;
}

export interface Advice {
  reason: "full" | "cold";
  title: string;
  body: string;
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-US"));
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

export function handoffAdvice(x: AdviceInput): Advice | null {
  if (!x.contextTokens || !x.contextWindow) return null;
  const pct = (x.contextTokens / x.contextWindow) * 100;
  if (pct >= FULL_ADVICE_PCT) {
    return {
      reason: "full",
      title: `Context ${Math.round(pct)}% full`,
      body: "Claude will compact soon and lose detail. A handoff starts a fresh session that reads this one's transcript.",
    };
  }
  if (x.cacheCold && x.contextTokens >= COLD_ADVICE_TOKENS) {
    const cold = (x.contextTokens * WRITE * x.inputPricePerMTok) / 1e6;
    const ratio = Math.round(WRITE / READ);
    return {
      reason: "cold",
      title: `Cache went cold on ${k(x.contextTokens)} tokens`,
      body: `Your next message re-writes all of it (about ${usd(cold)}, ${ratio}× a warm turn). A handoff starts fresh instead.`,
    };
  }
  return null;
}
