import { create } from "zustand";
import { ipc, type GitInfo } from "../lib/ipc";
import { useAgents } from "./agents";
import { useLayout } from "./layout";

const POLL_MS = 3000;

interface GitState {
  /** Keyed by directory; null = not in a repo. */
  info: Record<string, GitInfo | null>;
}

export const useGit = create<GitState>(() => ({ info: {} }));

/** The directory a pane is "in": Claude's own cwd when an agent runs there. */
export function paneDir(paneId: string): string | undefined {
  return useAgents.getState().sessions[paneId]?.cwd ?? useLayout.getState().panes[paneId]?.cwd;
}

function dirsInUse() {
  const dirs = new Set<string>();
  for (const id of Object.keys(useLayout.getState().panes)) {
    const d = paneDir(id);
    if (d) dirs.add(d);
  }
  return dirs;
}

async function refresh() {
  const dirs = [...dirsInUse()];
  const results = await Promise.all(dirs.map((d) => ipc.gitInfo(d).catch(() => null)));
  const prev = useGit.getState().info;
  const next: Record<string, GitInfo | null> = {};
  dirs.forEach((d, i) => (next[d] = results[i]));
  // Skip the update (and re-renders) when nothing changed.
  if (JSON.stringify(next) !== JSON.stringify(prev)) useGit.setState({ info: next });
}

export function startGitPolling() {
  refresh();
  setInterval(refresh, POLL_MS);
  // Pick up cd's right away rather than on the next tick.
  let last = "";
  const onChange = () => {
    const key = [...dirsInUse()].sort().join("\n");
    if (key !== last) {
      last = key;
      refresh();
    }
  };
  useLayout.subscribe(onChange);
  useAgents.subscribe(onChange);
}
