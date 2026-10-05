import { create } from "zustand";
import { handOff } from "../lib/handoff";
import { ipc } from "../lib/ipc";
import { formatTokens } from "../lib/format";
import { useAgents, label } from "./agents";
import { alertUser } from "./notifications";

/** Per-session token / cost / context numbers, read from the Claude transcript. */
export interface SessionMetrics {
  model?: string;
  /** Tokens in the most recent request's context (input + cache read + cache write). */
  contextTokens: number;
  /** contextTokens as a share of the model's context window, 0–100. */
  contextPct: number;
  /** All input + output tokens this session (cache included). */
  totalTokens: number;
  /** Estimated API-price cost in USD. */
  costUsd: number;
  /** Recent burn rate, tokens per minute. */
  tokensPerMin: number;
  /** Burning unusually fast. */
  hot: boolean;
  updatedAt: number;
}

interface MetricsState {
  byPane: Record<string, SessionMetrics>;
}

export const useMetrics = create<MetricsState>(() => ({ byPane: {} }));

const POLL_MS = 3000;
const RATE_WINDOW_MS = 5 * 60_000;
const HOT_RATE = 150_000;
const HOT_CTX = 85;
const COOL_CTX = 75;

/** $ per MTok (input, output) by model family, from the Claude API pricing table (cached 2026-09-25). */
function price(model = ""): [number, number] {
  const m = model.toLowerCase();
  if (/fable|mythos/.test(m)) return [10, 50];
  if (m.includes("opus")) {
    if (/opus-4(-1)?(-\d{8})?(\[|$)/.test(m)) return [15, 75];
    return /opus-5-5/.test(m) ? [4, 20] : [5, 25];
  }
  if (m.includes("haiku")) return /haiku-3/.test(m) ? [0.8, 4] : [1, 5];
  if (m.includes("sonnet")) return /sonnet-5/.test(m) ? [2, 10] : [3, 15];
  return [3, 15];
}

interface Track {
  path: string;
  offset: number;
  seen: Set<string>;
  model?: string;
  context: number;
  total: number;
  cost: number;
  /** Fresh (non-cache-read) tokens per request, for the burn rate. */
  recent: { t: number; tok: number }[];
  hot: boolean;
}

const tracks = new Map<string, Track>();
let busy = false;

function snapshot(t: Track, now: number): SessionMetrics {
  t.recent = t.recent.filter((r) => now - r.t < RATE_WINDOW_MS);
  const sum = t.recent.reduce((a, r) => a + r.tok, 0);
  // Over the span actually observed (at least a minute) so one burst doesn't read as sustained.
  const span = t.recent.length ? Math.min(RATE_WINDOW_MS, Math.max(60_000, now - t.recent[0].t)) : 60_000;
  const tokensPerMin = sum / (span / 60_000);
  const window = /\[1m\]/i.test(t.model ?? "") || t.context > 200_000 ? 1_000_000 : 200_000;
  const contextPct = Math.min(100, (t.context / window) * 100);
  t.hot = t.hot ? tokensPerMin > HOT_RATE * 0.7 || contextPct > COOL_CTX : tokensPerMin > HOT_RATE || contextPct > HOT_CTX;
  return { model: t.model, contextTokens: t.context, contextPct, totalTokens: t.total, costUsd: t.cost, tokensPerMin, hot: t.hot, updatedAt: now };
}

async function pollOne(paneId: string, path: string) {
  let t = tracks.get(paneId);
  // /clear or --resume starts a new transcript file.
  if (!t || t.path !== path) {
    t = { path, offset: 0, seen: new Set(), context: 0, total: 0, cost: 0, recent: [], hot: false };
    tracks.set(paneId, t);
  }
  let batch;
  try {
    batch = await ipc.transcriptUsage(path, t.offset);
  } catch {
    return;
  }
  t.offset = batch.offset;
  for (const e of batch.entries) {
    if (e.id && t.seen.has(e.id)) continue;
    if (e.id) t.seen.add(e.id);
    const [pin, pout] = price(e.model);
    const fresh = e.input_tokens + e.cache_creation_input_tokens;
    t.model = e.model || t.model;
    t.context = e.input_tokens + e.cache_read_input_tokens + e.cache_creation_input_tokens;
    t.total += fresh + e.cache_read_input_tokens + e.output_tokens;
    t.cost += (e.input_tokens * pin + e.output_tokens * pout + e.cache_read_input_tokens * pin * 0.1 + (e.cache_creation_input_tokens - e.cache_creation_1h_tokens) * pin * 1.25 + e.cache_creation_1h_tokens * pin * 2) / 1e6;
    const at = Date.parse(e.timestamp);
    t.recent.push({ t: Number.isFinite(at) ? at : Date.now(), tok: fresh + e.output_tokens });
  }
  const was = t.hot;
  const m = snapshot(t, Date.now());
  useMetrics.setState((s) => ({ byPane: { ...s.byPane, [paneId]: m } }));
  if (m.hot && !was) {
    const s = useAgents.getState().sessions[paneId];
    const why = m.contextPct > HOT_CTX ? `context ${Math.round(m.contextPct)}% full` : `${formatTokens(m.tokensPerMin)} tokens/min`;
    alertUser({
      kind: "burn",
      key: `burn:${paneId}`,
      paneId,
      title: `${s ? label(s) : "Claude"} is burning fast`,
      body: `${why}. A fresh session seeded from this transcript starts cheaper.`,
      sticky: true,
      actions: [{ label: "Hand off", tone: "primary", run: () => handOff(paneId) }],
    });
  }
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const sessions = useAgents.getState().sessions;
    for (const id of [...tracks.keys()]) if (!sessions[id]) tracks.delete(id);
    const { byPane } = useMetrics.getState();
    if (Object.keys(byPane).some((id) => !sessions[id])) {
      useMetrics.setState((s) => ({ byPane: Object.fromEntries(Object.entries(s.byPane).filter(([id]) => sessions[id])) }));
    }
    await Promise.all(Object.values(sessions).filter((s) => s.transcriptPath).map((s) => pollOne(s.paneId, s.transcriptPath!)));
  } finally {
    busy = false;
  }
}

export function startMetrics() {
  void poll();
  setInterval(poll, POLL_MS);
}
