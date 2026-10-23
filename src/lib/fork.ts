import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { forkChat } from "./chat";
import { shellQuote } from "./launch";
import { queueInit } from "./terminals";

/**
 * Branches a Claude conversation (T3 Chat style): a new pane beside it resumes the same
 * history as a separate session (`--fork-session`), so both can go different ways.
 */
export function forkConversation(paneId: string): string | null {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  const agent = useAgents.getState().sessions[paneId];
  if (pane?.mode === "chat") {
    const id = forkChat(paneId);
    if (!id) toast("No conversation to fork in this chat yet", true);
    return id;
  }
  if (!pane || !agent?.sessionId) {
    toast("No Claude conversation to fork in this pane yet", true);
    return null;
  }
  const id = layout.splitPane(paneId, "row", { account: pane.account ?? agent.account, cwd: agent.cwd ?? pane.cwd });
  queueInit(id, `claude --resume ${shellQuote(agent.sessionId)} --fork-session`);
  return id;
}
