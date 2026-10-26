import { create } from "zustand";
import { ipc, type PrInfo } from "../lib/ipc";
import { enqueue } from "../lib/outbox";
import { MAX_WAKES, kickoffText, prAction } from "../lib/prWake";
import { paneDir, useGit } from "./git";
import { useLayout } from "./layout";
import { alertUser } from "./notifications";
import { toast } from "./ui";

/** gh calls GitHub, so this polls far slower than the branch poll (store/git.ts). */
const POLL_MS = 60_000;
const TRUNKS = new Set(["main", "master", "trunk", "develop"]);

interface PrState {
  /** Keyed by directory; null = its branch has no PR. */
  byDir: Record<string, PrInfo | null>;
}

export const usePrs = create<PrState>(() => ({ byDir: {} }));

export function panePr(paneId: string): PrInfo | null | undefined {
  const dir = paneDir(paneId);
  return dir ? usePrs.getState().byDir[dir] : undefined;
}

/** Directories on a feature branch: only those can have a PR worth watching. */
function branchDirs() {
  const git = useGit.getState().info;
  const dirs = new Set<string>();
  for (const id of Object.keys(useLayout.getState().panes)) {
    const d = paneDir(id);
    const g = d ? git[d] : null;
    if (d && g && !g.detached && !TRUNKS.has(g.branch)) dirs.add(d);
  }
  return [...dirs];
}

function wake(paneId: string, text: string) {
  const layout = useLayout.getState();
  const wakes = (layout.panes[paneId]?.babysitWakes ?? 0) + 1;
  if (wakes > MAX_WAKES) {
    layout.updatePane(paneId, { babysit: false });
    alertUser({ kind: "info", paneId, title: "Babysitting stopped", body: `Woke this thread ${MAX_WAKES} times and the PR still needs work. Over to you.` });
    return;
  }
  layout.updatePane(paneId, { babysitWakes: wakes });
  enqueue(paneId, text);
}

let busy = false;

async function refresh() {
  // Overlapping reads would compare against the same previous state and wake twice.
  if (busy) return;
  busy = true;
  try {
    await read();
  } finally {
    busy = false;
  }
}

async function read() {
  const dirs = branchDirs();
  const results = await Promise.all(dirs.map((d) => ipc.prStatus(d).catch(() => undefined)));
  const prev = usePrs.getState().byDir;
  const next: Record<string, PrInfo | null> = {};
  dirs.forEach((d, i) => {
    // A failed call keeps the last answer rather than flickering to "no PR".
    const r = results[i];
    if (r !== undefined) next[d] = r;
    else if (d in prev) next[d] = prev[d];
  });
  if (JSON.stringify(next) === JSON.stringify(prev)) return;
  usePrs.setState({ byDir: next });

  const layout = useLayout.getState();
  for (const [id, pane] of Object.entries(layout.panes)) {
    const d = paneDir(id);
    if (!d || !(d in next)) continue;
    const action = prAction(prev[d], next[d], !!pane.babysit);
    if (action.kind === "wake") wake(id, action.text);
    else if (action.kind === "settle" && !pane.settled) {
      layout.updatePane(id, { settled: true, babysit: false });
      const inWorktree = useGit.getState().info[d]?.worktree;
      toast(`PR #${next[d]!.number} merged; its thread is settled.${inWorktree ? " Clean up its worktree from the threads list." : ""}`);
    }
  }
}

/** Turns babysitting on or off for a thread; turning it on sends the agent its first brief. */
export function setBabysit(paneId: string, on: boolean) {
  useLayout.getState().updatePane(paneId, { babysit: on, babysitWakes: 0 });
  if (!on) return;
  const pr = panePr(paneId) ?? null;
  const text = kickoffText(pr);
  if (text) enqueue(paneId, text);
  else toast(`Watching PR #${pr!.number}: nothing to fix yet.`);
  void refresh();
}

export function startPrPolling() {
  void refresh();
  setInterval(() => void refresh(), POLL_MS);
  // A pane moving onto a new branch gets its PR looked up now, not a minute later.
  let last = "";
  useGit.subscribe(() => {
    const key = branchDirs().sort().join("\n");
    if (key !== last) {
      last = key;
      void refresh();
    }
  });
}
