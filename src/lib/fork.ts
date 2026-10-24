import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { forkChat, releaseChat } from "./chat";
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

/**
 * Turns a chat into a terminal running the same conversation (`claude --resume`), for the
 * rare times you need Claude's own screen. The chat's process is stopped first, so two
 * Claudes never write to one transcript. A fork that hasn't had its first turn resumes
 * as a copy again.
 */
export function openChatInTerminal(paneId: string): boolean {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  if (pane?.mode !== "chat") return false;
  releaseChat(paneId);
  useAgents.getState().remove(paneId);
  const init = pane.claudeSession ? `claude --resume ${shellQuote(pane.claudeSession)}${pane.chatFork ? " --fork-session" : ""}` : "claude";
  queueInit(paneId, init);
  layout.updatePane(paneId, { mode: undefined, chatFork: undefined });
  toast("Opened in a terminal. The conversation carries on there.");
  return true;
}

/**
 * Continues a terminal Claude's conversation in a chat pane beside it. The chat resumes a
 * copy (`--fork-session`), so the terminal's transcript is never written by two Claudes;
 * close the terminal pane once the chat has taken over.
 */
export function openInChat(paneId: string): string | null {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  const agent = useAgents.getState().sessions[paneId];
  if (!pane || pane.mode === "chat" || !agent?.sessionId) {
    toast("No Claude conversation to open as a chat in this pane yet", true);
    return null;
  }
  const account = pane.account ?? agent.account;
  const id = layout.splitPane(paneId, "row", { account, cwd: agent.cwd ?? pane.cwd, mode: "chat" });
  layout.updatePane(id, { claudeSession: agent.sessionId, chatFork: true, chatUsed: true, ...(agent.permissionMode && { chatPermission: agent.permissionMode }) });
  toast("Continuing as a chat beside this pane. Close this one when you're done with it.");
  return id;
}
