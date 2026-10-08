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

/** A saved lineup of agents that open together in one tab. */
export interface AgentTeam {
  id: string;
  name: string;
  /** Agent ids in pane order; the same agent may appear more than once. */
  agentIds: string[];
}

interface CustomAgentsState {
  agents: CustomAgent[];
  teams: AgentTeam[];
  save(agent: Omit<CustomAgent, "id"> & { id?: string }): string;
  remove(id: string): void;
  saveTeam(team: Omit<AgentTeam, "id"> & { id?: string }): string;
  removeTeam(id: string): void;
}

export const useCustomAgents = create<CustomAgentsState>((set, get) => ({
  agents: [],
  teams: [],
  save(agent) {
    const id = agent.id ?? uid("agent");
    const next = { ...agent, id, name: agent.name.trim() || "Agent" };
    const exists = get().agents.some((a) => a.id === id);
    set((s) => ({ agents: exists ? s.agents.map((a) => (a.id === id ? next : a)) : [...s.agents, next] }));
    return id;
  },
  // Deleting an agent also takes it out of every team.
  remove: (id) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      teams: s.teams.map((t) => ({ ...t, agentIds: t.agentIds.filter((x) => x !== id) })),
    })),
  saveTeam(team) {
    const id = team.id ?? uid("team");
    const next = { ...team, id, name: team.name.trim() || "Team" };
    const exists = get().teams.some((t) => t.id === id);
    set((s) => ({ teams: exists ? s.teams.map((t) => (t.id === id ? next : t)) : [...s.teams, next] }));
    return id;
  },
  removeTeam: (id) => set((s) => ({ teams: s.teams.filter((t) => t.id !== id) })),
}));

export const customAgentById = (id: string | undefined) => (id ? useCustomAgents.getState().agents.find((a) => a.id === id) : undefined);

/** Loads agents.json (agents and teams), then saves on every change. */
export async function loadCustomAgents() {
  const saved = await ipc.loadState<{ agents: CustomAgent[]; teams?: AgentTeam[] }>("agents").catch(() => null);
  if (Array.isArray(saved?.agents)) {
    const valid = saved.agents.filter((a) => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.variant === "string");
    useCustomAgents.setState({ agents: valid.map((a) => ({ ...a, color: AGENT_COLORS.includes(a.color) ? a.color : "gold" })) });
  }
  if (Array.isArray(saved?.teams)) {
    const ids = new Set(useCustomAgents.getState().agents.map((a) => a.id));
    const teams = saved.teams.filter((t) => t && typeof t.id === "string" && Array.isArray(t.agentIds));
    useCustomAgents.setState({ teams: teams.map((t) => ({ ...t, agentIds: t.agentIds.filter((x) => ids.has(x)) })) });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  useCustomAgents.subscribe((s, prev) => {
    if (s.agents === prev.agents && s.teams === prev.teams) return;
    clearTimeout(timer);
    timer = setTimeout(() => ipc.saveState("agents", { agents: useCustomAgents.getState().agents, teams: useCustomAgents.getState().teams }).catch(() => {}), 300);
  });
}
