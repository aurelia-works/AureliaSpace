import { create } from "zustand";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { sendPrompt } from "./effort";

/**
 * Messages queued for a busy Claude pane (Queue, the composer's Enter while Claude works).
 * Each one goes out when Claude finishes its turn, one per turn, through the same path as
 * the composer (auto effort included). Steer (⌘Enter) skips this and types it in now.
 */
export const useOutbox = create<{ byPane: Record<string, string[]> }>(() => ({ byPane: {} }));

function setQueue(paneId: string, list: string[]) {
  useOutbox.setState((s) => {
    const byPane = { ...s.byPane };
    if (list.length) byPane[paneId] = list;
    else delete byPane[paneId];
    return { byPane };
  });
}

export function enqueue(paneId: string, text: string) {
  setQueue(paneId, [...(useOutbox.getState().byPane[paneId] ?? []), text]);
  // Finished between the keypress and now: nothing will announce the next idle, so send it.
  if (useAgents.getState().sessions[paneId]?.status === "idle") void flush(paneId);
}

export function unqueue(paneId: string, index: number) {
  setQueue(paneId, (useOutbox.getState().byPane[paneId] ?? []).filter((_, i) => i !== index));
}

const sending = new Set<string>();

async function flush(paneId: string) {
  const next = useOutbox.getState().byPane[paneId]?.[0];
  if (next === undefined || sending.has(paneId)) return;
  sending.add(paneId);
  setQueue(paneId, (useOutbox.getState().byPane[paneId] ?? []).slice(1));
  try {
    const { sent } = await sendPrompt(paneId, next);
    // Pane gone: put it back so it isn't lost silently; the pane-removal sweep drops it.
    if (!sent) setQueue(paneId, [next, ...(useOutbox.getState().byPane[paneId] ?? [])]);
  } finally {
    sending.delete(paneId);
  }
}

/** Sends the next queued message whenever a pane's turn ends; forgets queues of closed panes. */
export function startOutbox() {
  useAgents.subscribe((s, prev) => {
    for (const paneId of Object.keys(useOutbox.getState().byPane)) {
      const now = s.sessions[paneId]?.status;
      if (now === "idle" && prev.sessions[paneId]?.status !== "idle") void flush(paneId);
    }
  });
  useLayout.subscribe((s, prev) => {
    if (s.panes === prev.panes) return;
    for (const paneId of Object.keys(useOutbox.getState().byPane)) if (!s.panes[paneId]) setQueue(paneId, []);
  });
}
