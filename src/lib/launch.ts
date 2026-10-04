import { focusedPaneId, useLayout, type NewPaneOpts } from "../store/layout";
import { useTasks } from "../store/tasks";
import { toast, type PickerTask } from "../store/ui";
import { ipc } from "./ipc";
import { queueInit } from "./terminals";

/** Single-quotes a string for zsh. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The directory a new Claude pane starts in: a fresh git worktree when asked for
 * (falling back to `cwd` with a toast if that fails, e.g. outside a repo).
 */
export async function startDir(cwd: string | undefined, worktree: boolean, label: string): Promise<string | undefined> {
  if (!worktree || !cwd) return cwd;
  try {
    return await ipc.createWorktree(cwd, label);
  } catch (e) {
    toast(`No worktree created: ${e}`, true);
    return cwd;
  }
}

export interface LaunchOpts {
  account: string;
  where: "split" | "tab";
  worktree: boolean;
  task?: PickerTask;
}

/** Opens a Claude pane as `account`, optionally in its own worktree and starting on a task. */
export async function launchClaude({ account, where, worktree, task }: LaunchOpts) {
  const layout = useLayout.getState();
  const from = focusedPaneId();
  const base = from ? layout.panes[from]?.cwd : undefined;
  const cwd = await startDir(base, worktree, task?.title ?? account);
  const opts: NewPaneOpts = { account, cwd };
  const paneId = where === "split" && from && layout.panes[from] ? layout.splitPane(from, "row", opts) : layout.newTab(opts);
  if (task) {
    queueInit(paneId, `claude ${shellQuote(task.title)}`);
    const tasks = useTasks.getState();
    tasks.attach(task.project, task.id, paneId);
    tasks.setStatus(task.project, task.id, "doing");
  }
  if (cwd !== base) toast(`New worktree: ${cwd}`);
  return paneId;
}
