import { useConfig } from "../store/config";
import type { SavedLayout } from "../store/layout";
import { toast } from "../store/ui";
import { ipc } from "./ipc";
import { queueInit } from "./terminals";

/** Claude session ids are uuids; anything else never reaches the shell. */
const SESSION_ID = /^[A-Za-z0-9-]+$/;

/**
 * Claude panes restored at launch, whose shell didn't survive in the terminal host,
 * reopen the conversation they last ran instead of starting a blank one: the pane's own session when its transcript is still there,
 * else the newest conversation that account had in the pane's folder. Two panes on the
 * same account and folder can't tell their fallbacks apart, so only one of them gets it.
 * Runs before the first render, while no terminal has spawned yet. Chat panes resume
 * their own session (lib/chat.ts).
 */
export async function planResume(saved: SavedLayout | null) {
  if (!saved || useConfig.getState().config?.resumeOnLaunch === false) return;
  // Panes whose shell kept running in the terminal host still have their Claude: nothing to reopen.
  const alive = new Set(await ipc.ptyAlive().catch(() => []));
  const panes = Object.values(saved.panes).filter((p) => p.account && !p.launcher && !p.browser && !p.editor && p.mode !== "chat" && !alive.has(p.id));
  const claimed = new Set<string>();
  const plans = await Promise.all(
    panes.map(async (p) => {
      const prefer = p.claudeSession && SESSION_ID.test(p.claudeSession) ? p.claudeSession : null;
      const id = await ipc.resumableSession(p.account!, p.cwd ?? "~", prefer).catch(() => null);
      return { pane: p, id, own: !!prefer && id === prefer };
    }),
  );
  let resumed = 0;
  // Panes that found their own session first, so a fallback never takes a conversation another pane owns.
  for (const { pane, id } of [...plans].sort((a, b) => Number(b.own) - Number(a.own))) {
    if (!id || !SESSION_ID.test(id)) continue;
    const key = `${pane.account}\n${id}`;
    if (claimed.has(key)) continue;
    claimed.add(key);
    queueInit(pane.id, `claude --resume ${id}`);
    resumed++;
  }
  if (resumed) toast(`Reopened ${resumed} Claude conversation${resumed === 1 ? "" : "s"}`);
}
