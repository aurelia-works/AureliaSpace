import type { AgentSession, AgentStatus } from "../store/agents";

/**
 * What a pane looks like to the user: the hook status plus "finished and you haven't
 * looked yet" (attention on an idle session), which the board and rail treat as its own state.
 */
export type Visual = AgentStatus | "done";

export function visualOf(s: AgentSession): Visual {
  if (s.status === "idle" && s.attention) return "done";
  return s.status;
}

export const stateLabel: Record<Visual, string> = {
  needs_input: "needs you",
  working: "working",
  done: "finished",
  idle: "idle",
  starting: "starting",
};

/** Lower sorts first: who needs you, then unseen results, then work in flight. */
export const urgency: Record<Visual, number> = { needs_input: 0, done: 1, working: 2, starting: 3, idle: 4 };

/** Shape + colour status mark (see base.css: diamond, ring, disc, hollow, square). */
export function StatusGlyph({ state, busy, title }: { state: Visual | "shell"; busy?: boolean; title?: string }) {
  const label = title ?? (state === "shell" ? (busy ? "shell, running a command" : "shell") : stateLabel[state]);
  return <span className={`glyph ${state}${busy ? " busy" : ""}`} role="img" aria-label={label} title={label} />;
}
