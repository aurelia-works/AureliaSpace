import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useNotices } from "../store/notifications";
import { toast } from "../store/ui";
import { ipc } from "./ipc";
import { shellQuote } from "./launch";
import { queueInit, respawnPane, showPane, writeToPane } from "./terminals";

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

/** Account for a new Claude pane in `folder`: workspace override, then the default, else undefined (ask). */
export function accountForFolder(folder?: string): string | undefined {
  const cfg = useConfig.getState().config;
  if (!cfg) return undefined;
  const known = (n?: string) => (n && cfg.accounts.some((a) => a.name === n) ? n : undefined);
  const dir = folder?.replace(/\/+$/, "") ?? "";
  // Longest matching folder wins, so a subfolder override beats its parent's.
  const hit = Object.keys(cfg.workspaceAccounts ?? {})
    .map((k) => k.replace(/\/+$/, ""))
    .filter((k) => k && (dir === k || dir.startsWith(k + "/")))
    .sort((a, b) => b.length - a.length)[0];
  const raw = hit ? Object.entries(cfg.workspaceAccounts).find(([k]) => k.replace(/\/+$/, "") === hit)?.[1] : undefined;
  return known(raw) ?? known(cfg.defaultAccount);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks Claude to exit (clearing any half-typed input first) and waits for its SessionEnd. */
async function exitClaude(paneId: string) {
  if (!useAgents.getState().sessions[paneId]) return;
  writeToPane(paneId, "\x03");
  await sleep(150);
  writeToPane(paneId, "/exit\r");
  for (let i = 0; i < 15 && useAgents.getState().sessions[paneId]; i++) await sleep(200);
}

/**
 * Moves a pane's Claude session to another account without losing the thread: the
 * transcript is copied into the target account (the original is untouched), the pane's
 * shell is restarted with that account's CLAUDE_CONFIG_DIR, and `claude --resume <id>`
 * continues the same conversation. Falls back to a fresh session seeded with a summary
 * of the recent conversation when the transcript can't be moved.
 */
export async function switchAccount(paneId: string, to: string): Promise<boolean> {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  if (!pane) return false;
  if (pane.account === to) return true;
  const agent = useAgents.getState().sessions[paneId];

  let init = "claude";
  let how = "";
  if (agent?.sessionId && agent.transcriptPath) {
    try {
      const prepared = await ipc.handoffPrepare(agent.transcriptPath, to);
      init = `claude --resume ${shellQuote(prepared.sessionId)}`;
      how = "same conversation";
    } catch (e) {
      try {
        const recent = await ipc.handoffSummary(agent.transcriptPath, 6000);
        if (recent) {
          init =
            `claude ${shellQuote(
              "You are continuing work from a previous session on another account (its transcript could not be resumed). " +
                "Here is the recent conversation; pick up where it left off without redoing finished work.\n\n" +
                recent,
            )}`;
          how = "fresh session seeded with a summary (resume wasn't possible)";
        }
      } catch {
        /* nothing to seed with: plain claude below */
      }
      toast(`Couldn't move the transcript: ${e}`, true);
    }
  }

  await exitClaude(paneId);
  useAgents.getState().remove(paneId);
  useNotices.getState().resolvePane(paneId, ["limit"]);
  layout.updatePane(paneId, { account: to, cwd: agent?.cwd ?? pane.cwd });
  if (!respawnPane(paneId, init)) return false;
  toast(`Continuing on ${to}${how ? ` · ${how}` : ""}`);
  return true;
}
