import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useNotices } from "../store/notifications";
import { useUi } from "../store/ui";
import { queueFirstMessage } from "./chat";
import { expandPath } from "./format";
import { ipc, type Routine } from "./ipc";
import { shellQuote } from "./launch";
import { isDue } from "./routineSchedule";
import { queueInit } from "./terminals";

/**
 * Routines: prompts that open a Claude pane on a schedule while AureliaSpace runs
 * (Settings → Routines). A run is skipped while the previous one is still working.
 */
let lastRun: Record<string, number> = {};
const lastPane = new Map<string, string>();
const startedAt = Date.now();

const save = () => ipc.saveState("routines", { lastRun }).catch(() => {});

/** Opens the routine's pane now, whatever the schedule says. */
export function runRoutine(r: Routine): string {
  const chat = useUi.getState().claudeAsChat;
  const paneId = useLayout.getState().newTab({ account: r.account || undefined, cwd: r.cwd ? expandPath(r.cwd) : undefined, ...(chat && { mode: "chat" as const }) });
  if (chat) queueFirstMessage(paneId, r.prompt);
  else queueInit(paneId, `claude ${shellQuote(r.prompt)}`);
  lastPane.set(r.id, paneId);
  lastRun = { ...lastRun, [r.id]: Date.now() };
  void save();
  useNotices.getState().push({ kind: "info", key: `routine:${r.id}`, paneId, title: `Routine started: ${r.name || "untitled"}`, body: r.prompt.slice(0, 160) });
  return paneId;
}

function stillBusy(id: string): boolean {
  const pane = lastPane.get(id);
  const status = pane ? useAgents.getState().sessions[pane]?.status : undefined;
  return status === "working" || status === "starting" || status === "needs_input";
}

function tick() {
  const now = Date.now();
  for (const r of useConfig.getState().config?.routines ?? []) {
    const last = lastRun[r.id] ?? (r.kind === "every" ? startedAt : 0);
    if (isDue(r, last, now) && !stillBusy(r.id)) runRoutine(r);
  }
}

export async function startRoutines() {
  const saved = await ipc.loadState<{ lastRun: Record<string, number> }>("routines").catch(() => null);
  lastRun = saved?.lastRun ?? {};
  setInterval(tick, 30_000);
  setTimeout(tick, 5_000);
}
