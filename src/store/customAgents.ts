import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { uid } from "./layout";

/** Named swatches; the hue sits on the agent's avatar and its pane chip. */
export const AGENT_COLORS = ["gold", "coral", "rose", "violet", "blue", "teal", "green", "slate"] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];

/** A saved, named agent: which CLI to run and how, launched in one click. */
export interface CustomAgent {
  id: string;
  name: string;
  /** Launcher variant id from `agentVariants` (e.g. "claude:work", "codex:oss") or "custom". */
  variant: string;
  /** Full command line when `variant` is "custom". */
  command?: string;
  /** Claude only: appended to Claude Code's system prompt (`--append-system-prompt`). */
  instructions?: string;
  /** Other CLIs: extra arguments typed after the binary. */
  args?: string;
  color: AgentColor;
  /** Starting folder; empty = the focused pane's folder. */
  folder?: string;
  worktree?: boolean;
}

interface CustomAgentsState {
  agents: CustomAgent[];
  save(agent: Omit<CustomAgent, "id"> & { id?: string }): string;
  remove(id: string): void;
}

export const useCustomAgents = create<CustomAgentsState>((set, get) => ({
  agents: [],
  save(agent) {
    const id = agent.id ?? uid("agent");
    const next = { ...agent, id, name: agent.name.trim() || "Agent" };
    const exists = get().agents.some((a) => a.id === id);
    set((s) => ({ agents: exists ? s.agents.map((a) => (a.id === id ? next : a)) : [...s.agents, next] }));
    return id;
  },
  remove: (id) => set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),
}));

export const customAgentById = (id: string | undefined) => (id ? useCustomAgents.getState().agents.find((a) => a.id === id) : undefined);

/** Loads agents.json, then saves on every change. */
export async function loadCustomAgents() {
  const saved = await ipc.loadState<{ agents: CustomAgent[] }>("agents").catch(() => null);
  if (Array.isArray(saved?.agents)) {
    const valid = saved.agents.filter((a) => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.variant === "string");
    useCustomAgents.setState({ agents: valid.map((a) => ({ ...a, color: AGENT_COLORS.includes(a.color) ? a.color : "gold" })) });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  useCustomAgents.subscribe((s, prev) => {
    if (s.agents === prev.agents) return;
    clearTimeout(timer);
    timer = setTimeout(() => ipc.saveState("agents", { agents: useCustomAgents.getState().agents }).catch(() => {}), 300);
  });
}
