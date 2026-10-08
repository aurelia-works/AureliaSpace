import { providerById, variantOf } from "../lib/agents";
import { useCustomAgents, type CustomAgent } from "../store/customAgents";
import { useLayout } from "../store/layout";
import { AgentLogo } from "./AgentLogos";

/** The saved custom agent a pane was launched as, if any. */
export function usePaneAgent(paneId: string): CustomAgent | undefined {
  const id = useLayout((s) => s.panes[paneId]?.customAgent);
  return useCustomAgents((s) => (id ? s.agents.find((a) => a.id === id) : undefined));
}

/** Provider logo for an agent; the colour swatch tints it. */
export function AgentAvatar({ agent, size = 14 }: { agent: CustomAgent; size?: number }) {
  const provider = variantOf(agent)?.provider ?? "custom";
  return (
    <span className={`agent-avatar c-${agent.color}`} style={{ width: size + 8, height: size + 8 }} aria-hidden>
      <AgentLogo logo={providerById(provider)?.logo ?? "custom"} size={size} />
    </span>
  );
}

/** Name chip in the agent's colour: pane headers, board cards, the queue rail. */
export function AgentChip({ agent, title }: { agent: CustomAgent; title?: string }) {
  return (
    <span className={`agent-chip c-${agent.color}`} title={title ?? agent.name}>
      {agent.name}
    </span>
  );
}
