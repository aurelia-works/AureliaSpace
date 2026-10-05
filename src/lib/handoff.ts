import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { shellQuote } from "./launch";
import { queueInit, showPane } from "./terminals";

/** Opens a fresh Claude pane (same account and folder) that picks up from the old session's transcript. */
export function handOff(paneId: string): boolean {
  const s = useAgents.getState().sessions[paneId];
  const layout = useLayout.getState();
  if (!s?.transcriptPath || !layout.panes[paneId]) {
    toast("No transcript to hand off from yet", true);
    return false;
  }
  const prompt =
    `You are taking over from a previous Claude Code session whose context ran too large. ` +
    `Its full transcript (JSONL) is at ${s.transcriptPath}. Read it, starting from the end, to work out the goal, ` +
    `what is already done and what remains, then continue the work without redoing finished steps.`;
  const next = layout.splitPane(paneId, "row", { account: s.account ?? layout.panes[paneId].account, cwd: s.cwd ?? layout.panes[paneId].cwd });
  queueInit(next, `claude ${shellQuote(prompt)}`);
  showPane(next);
  return true;
}
