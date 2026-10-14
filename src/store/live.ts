import { create } from "zustand";

/**
 * What Claude Code itself reports for a pane, through the status line bridge
 * (src-tauri/resources/statusline.sh). These are the CLI's own numbers, so they win over
 * anything derived from transcripts or polling: rate limits come from the API response
 * headers of the pane's latest request, the context window is the model's real size, and
 * the prompt-cache expiry is exact.
 */
export interface LiveStatus {
  model?: string;
  modelName?: string;
  /** "low" | "medium" | "high" | "xhigh" | "max"; absent on models without effort. */
  effort?: string;
  /** Tokens in the latest request's context (input + cache read + cache write). */
  contextTokens?: number;
  contextWindow?: number;
  /** contextTokens / contextWindow, 0–100, unrounded. */
  contextPct?: number;
  /** Utilization 0–100 (0.1 precision) per window, with reset time as epoch ms. */
  fiveHour?: { pct: number; resetsAt: number | null };
  sevenDay?: { pct: number; resetsAt: number | null };
  cache?: {
    warm: boolean;
    /** Epoch ms the cache goes cold; null when unknown. */
    expiresAt: number | null;
    ttl?: string;
    requests?: number;
    misses?: number;
    hitRatio?: number;
    lastMissCause?: string;
  };
  costUsd?: number;
  sessionId?: string;
  transcriptPath?: string;
  /** When this snapshot arrived (epoch ms). */
  at: number;
}

interface LiveState {
  byPane: Record<string, LiveStatus>;
  remove(paneId: string): void;
}

export const useLive = create<LiveState>((set) => ({
  byPane: {},
  remove(paneId) {
    set((s) => {
      if (!s.byPane[paneId]) return s;
      const byPane = { ...s.byPane };
      delete byPane[paneId];
      return { byPane };
    });
  },
}));

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
/** Status line times are unix seconds. */
const secs = (v: unknown): number | null => {
  const n = num(v);
  return n === undefined ? null : n * 1000;
};

function windowOf(v: unknown): LiveStatus["fiveHour"] {
  const w = obj(v);
  const pct = num(w?.used_percentage);
  return pct === undefined ? undefined : { pct, resetsAt: secs(w?.resets_at) };
}

/** Parses one status line payload; unknown or missing fields are simply left out. */
export function parseLive(payload: unknown, at = Date.now()): LiveStatus {
  const p = obj(payload) ?? {};
  const model = obj(p.model);
  const ctx = obj(p.context_window);
  const usage = obj(ctx?.current_usage);
  const window = num(ctx?.context_window_size);
  const tokens = usage
    ? (num(usage.input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0)
    : undefined;
  const rl = obj(p.rate_limits);
  const pc = obj(p.prompt_cache);
  const out: LiveStatus = {
    model: str(model?.id),
    modelName: str(model?.display_name),
    effort: str(obj(p.effort)?.level),
    contextWindow: window,
    contextTokens: tokens,
    contextPct: tokens !== undefined && window ? (tokens / window) * 100 : num(ctx?.used_percentage),
    fiveHour: windowOf(rl?.five_hour),
    sevenDay: windowOf(rl?.seven_day),
    costUsd: num(obj(p.cost)?.total_cost_usd),
    sessionId: str(p.session_id),
    transcriptPath: str(p.transcript_path),
    at,
  };
  if (pc) {
    out.cache = {
      warm: pc.warm === true,
      expiresAt: secs(pc.expires_at),
      ttl: str(pc.ttl),
      requests: num(pc.requests),
      misses: num(pc.misses),
      hitRatio: num(pc.hit_ratio),
      lastMissCause: str(pc.last_miss_cause),
    };
  }
  return out;
}

/** Stores a pane's snapshot, keeping fields a partial payload left out (before the first request
 *  the CLI sends no cache or usage block). */
export function ingestLive(paneId: string, payload: unknown): LiveStatus {
  const next = parseLive(payload);
  const prev = useLive.getState().byPane[paneId];
  const merged: LiveStatus = { ...prev, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)), at: next.at };
  // A new conversation (/clear, --resume) starts with a fresh cache and context.
  if (prev?.sessionId && next.sessionId && prev.sessionId !== next.sessionId) {
    if (!next.cache) delete merged.cache;
    if (next.contextTokens === undefined) {
      delete merged.contextTokens;
      delete merged.contextPct;
    }
  }
  useLive.setState((s) => ({ byPane: { ...s.byPane, [paneId]: merged } }));
  return merged;
}
