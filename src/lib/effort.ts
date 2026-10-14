import { create } from "zustand";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useLive } from "../store/live";
import { ipc, type EffortLevel, type EffortPick } from "./ipc";
import { screenText, submitToPane, writeToPane } from "./terminals";

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Changing effort between requests keeps the prompt cache only on these models (measured
 * by Effortless: elsewhere the next request rewrote 56–100% of it, which costs more than
 * any effort saves). Auto effort leaves every other model alone.
 */
export const cacheSafe = (model: string | undefined) => !!model && /(opus|sonnet)-5-5/.test(model);

/** What auto effort last decided for each pane (shown on the pane header's effort chip). */
export const useEffortPicks = create<{ byPane: Record<string, EffortPick & { at: number; switched: boolean }> }>(() => ({ byPane: {} }));

/** The level each pane was last switched to here, until the status line reports one newer. */
const switched = new Map<string, { level: EffortLevel; at: number }>();

export function currentEffort(paneId: string): string | undefined {
  const live = useLive.getState().byPane[paneId];
  const mine = switched.get(paneId);
  return mine && (!live || mine.at > live.at) ? mine.level : live?.effort;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForScreen(paneId: string, text: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (screenText(paneId).includes(text)) return true;
    await sleep(40);
  }
  return false;
}

/**
 * Sets the pane's effort for this session only. `/effort low` would also save the level
 * as the model's default for new sessions; the bare `/effort` picker has a session-only
 * key instead. Its slider stops at the left edge, so six ← always reach "low".
 */
async function setSessionEffort(paneId: string, level: EffortLevel): Promise<boolean> {
  writeToPane(paneId, "/effort");
  await sleep(150);
  writeToPane(paneId, "\r");
  if (!(await waitForScreen(paneId, "this session only", 2500))) {
    // Not the picker we know (another Claude Code version?): back out without changing anything.
    writeToPane(paneId, "\x1b");
    return false;
  }
  writeToPane(paneId, "\x1b[D".repeat(6) + "\x1b[C".repeat(EFFORT_LEVELS.indexOf(level)));
  await sleep(60);
  writeToPane(paneId, "s");
  await sleep(250);
  switched.set(paneId, { level, at: Date.now() });
  return true;
}

export interface SendResult {
  sent: boolean;
  /** What auto effort decided, when it ran. */
  pick?: EffortPick;
  /** Set when the level was changed before sending. */
  switchedTo?: EffortLevel;
}

/**
 * Sends a prompt to a pane. For a Claude pane that is idle at its prompt on a cache-safe
 * model, the effort is chosen first (`override`, else rules and the Haiku judge) and
 * switched if it differs. Anywhere else the text is sent as is.
 */
export async function sendPrompt(paneId: string, text: string, override?: EffortLevel): Promise<SendResult> {
  const pane = useLayout.getState().panes[paneId];
  const cfg = useConfig.getState().config?.effort;
  const agent = useAgents.getState().sessions[paneId];
  const live = useLive.getState().byPane[paneId];
  const eligible = !!pane?.account && agent?.status === "idle" && cacheSafe(live?.model) && (!!override || cfg?.auto !== false);
  if (!eligible) return { sent: submitToPane(paneId, text) };

  const pick: EffortPick = override
    ? { level: override, source: "rules", why: "your choice", pending: false }
    : await ipc.chooseEffort(pane.account ?? null, text, true).catch(() => ({ level: null, source: "keep" as const, why: "couldn't decide", pending: false }));
  let switchedTo: EffortLevel | undefined;
  if (pick.level && pick.level !== currentEffort(paneId) && (await setSessionEffort(paneId, pick.level))) switchedTo = pick.level;
  useEffortPicks.setState((s) => ({ byPane: { ...s.byPane, [paneId]: { ...pick, at: Date.now(), switched: !!switchedTo } } }));
  return { sent: submitToPane(paneId, text), pick, switchedTo };
}
