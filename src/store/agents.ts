import { create } from "zustand";
import { notify } from "../lib/notify";
import { useConfig } from "./config";
import { activeTab, useLayout } from "./layout";
import { useUi } from "./ui";

export type AgentStatus = "starting" | "idle" | "working" | "needs_input";

export interface AgentSession {
  paneId: string;
  sessionId?: string;
  status: AgentStatus;
  account?: string;
  cwd?: string;
  message?: string;
  tool?: string;
  /** Finished or needs input while in the background, and not looked at since. */
  attention?: boolean;
  /** Start of the last model request (user prompt or tool result); drives the prompt-cache timer. */
  lastRequestAt?: number;
  updatedAt: number;
}

/** Shape written by src-tauri/resources/hook.sh. */
export interface AgentEvent {
  pane: string;
  event: string;
  configDir: string;
  ts: number;
  payload: {
    session_id?: string;
    cwd?: string;
    notification_type?: string;
    message?: string;
    tool_name?: string;
  };
}

interface AgentsState {
  sessions: Record<string, AgentSession>;
  handle(ev: AgentEvent): void;
  markStarting(paneId: string, account?: string): void;
  clearAttention(paneId: string): void;
  remove(paneId: string): void;
}

function accountFor(paneId: string, configDir: string): string | undefined {
  const fromPane = useLayout.getState().panes[paneId]?.account;
  if (fromPane) return fromPane;
  const accounts = useConfig.getState().config?.accounts ?? [];
  const base = (p: string) => p.replace(/\/+$/, "").split("/").pop();
  const target = configDir ? base(configDir) : ".claude";
  return accounts.find((a) => base(a.configDir) === target)?.name;
}

function statusFor(ev: AgentEvent, prev?: AgentStatus): AgentStatus | null {
  switch (ev.event) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return "working";
    case "Stop":
      return "idle";
    case "Notification": {
      const type = ev.payload.notification_type ?? "";
      const msg = (ev.payload.message ?? "").toLowerCase();
      // "Claude is waiting for your input" after a finished turn is just idle.
      if (type === "idle_prompt" || (!type && msg.includes("waiting for your input"))) {
        return prev === "working" ? "needs_input" : (prev ?? "idle");
      }
      return "needs_input";
    }
    default:
      return null;
  }
}

/** A pane counts as background if the window is unfocused or it isn't the focused pane. */
function isBackground(paneId: string): boolean {
  if (!useUi.getState().windowFocused) return true;
  return activeTab()?.focusedPaneId !== paneId;
}

export const label = (s: AgentSession) => {
  const where = s.cwd ? s.cwd.split("/").filter(Boolean).pop() : undefined;
  return [s.account ?? "claude", where].filter(Boolean).join(" · ");
};

export const useAgents = create<AgentsState>((set, get) => ({
  sessions: {},

  handle(ev) {
    if (!ev?.pane || !useLayout.getState().panes[ev.pane]) return;
    const prev = get().sessions[ev.pane];
    if (ev.event === "SessionEnd") return get().remove(ev.pane);
    const status = statusFor(ev, prev?.status);
    if (!status) return;
    const next: AgentSession = {
      paneId: ev.pane,
      sessionId: ev.payload.session_id ?? prev?.sessionId,
      status,
      account: accountFor(ev.pane, ev.configDir) ?? prev?.account,
      cwd: ev.payload.cwd ?? prev?.cwd,
      message: ev.event === "Notification" ? ev.payload.message : status === "working" ? undefined : prev?.message,
      tool: ev.event === "PreToolUse" ? ev.payload.tool_name : status === "working" ? prev?.tool : undefined,
      attention: status === "working" ? false : prev?.attention,
      // Each prompt and each tool result triggers a new API request that refreshes the cache.
      lastRequestAt: ev.event === "UserPromptSubmit" || ev.event === "PostToolUse" ? Date.now() : prev?.lastRequestAt,
      updatedAt: Date.now(),
    };
    const finished = ev.event === "Stop" && prev?.status === "working";
    const asking = status === "needs_input" && prev?.status !== "needs_input";
    const background = isBackground(ev.pane);
    if ((finished || asking) && background) next.attention = true;
    set((s) => ({ sessions: { ...s.sessions, [ev.pane]: next } }));

    if (useConfig.getState().config?.notifications === false || !background) return;
    if (finished) {
      notify(`${label(next)} finished`, "Claude is done and waiting for you.");
    } else if (asking) {
      notify(`${label(next)} needs input`, next.message || "Claude needs your attention.");
    }
  },

  clearAttention(paneId) {
    const s = get().sessions[paneId];
    if (s?.attention) set((st) => ({ sessions: { ...st.sessions, [paneId]: { ...s, attention: false } } }));
  },

  markStarting(paneId, account) {
    if (get().sessions[paneId]) return;
    set((s) => ({
      sessions: { ...s.sessions, [paneId]: { paneId, status: "starting", account, updatedAt: Date.now() } },
    }));
  },

  remove(paneId) {
    if (!get().sessions[paneId]) return;
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[paneId];
      return { sessions };
    });
  },
}));

const rank: Record<AgentStatus, number> = { needs_input: 3, working: 2, starting: 1, idle: 0 };

/** Most urgent status among a set of panes (for tab badges). */
export function worstStatus(sessions: Record<string, AgentSession>, ids: string[]): AgentStatus | undefined {
  let best: AgentStatus | undefined;
  for (const id of ids) {
    const s = sessions[id]?.status;
    if (s && (!best || rank[s] > rank[best])) best = s;
  }
  return best;
}

/**
 * Agents waiting on you, most urgent first: needs-input before finished, then oldest
 * first so nothing waits forever.
 */
export function waitingAgents(sessions: Record<string, AgentSession>): AgentSession[] {
  return Object.values(sessions)
    .filter((s) => s.attention || s.status === "needs_input")
    .sort((a, b) => Number(b.status === "needs_input") - Number(a.status === "needs_input") || a.updatedAt - b.updatedAt);
}

/** Looking at a pane clears its attention flag. */
export function trackAttention() {
  const clear = () => {
    const pane = activeTab()?.focusedPaneId;
    if (pane && useUi.getState().windowFocused) useAgents.getState().clearAttention(pane);
  };
  useLayout.subscribe(clear);
  useUi.subscribe((s, prev) => s.windowFocused !== prev.windowFocused && clear());
}
