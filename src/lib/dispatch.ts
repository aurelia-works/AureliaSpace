import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useTasks } from "../store/tasks";
import { toast } from "../store/ui";
import { shellQuote } from "./launch";
import { queueInit } from "./terminals";

/**
 * Dispatch with review (BridgeMind style): when the agent on a task marked for review
 * finishes its turn, a second Claude opens below it in the same folder (its worktree, if it
 * has one), in plan mode so it can't edit, and reports on the changes.
 */
function reviewPrompt(title: string) {
  return (
    `Review the work another agent just did in this folder for the task: "${title}". ` +
    "Read the uncommitted changes (git status, git diff HEAD, and any new files) and the code around them. " +
    "Report bugs, missing pieces, risky changes and anything that doesn't match the task, each with file:line and why. " +
    "Do not edit anything. End with a one-line verdict: ready, or what must change first."
  );
}

/** Another account than the worker's when there is one, so the review is a second pair of eyes. */
function reviewerAccount(worker: string | undefined): string | undefined {
  const names = useConfig.getState().config?.accounts.map((a) => a.name) ?? [];
  return names.find((n) => n !== worker) ?? worker;
}

export function startDispatchWatch() {
  useAgents.subscribe((s, prev) => {
    for (const [paneId, session] of Object.entries(s.sessions)) {
      if (!(session.status === "idle" && prev.sessions[paneId]?.status === "working")) continue;
      for (const [project, tasks] of Object.entries(useTasks.getState().projects)) {
        const task = tasks.find((t) => t.paneId === paneId && t.review === "pending");
        if (!task) continue;
        useTasks.getState().setReview(project, task.id, "started");
        const worker = useLayout.getState().panes[paneId]?.account ?? session.account;
        const account = reviewerAccount(worker);
        const reviewer = useLayout.getState().splitPane(paneId, "column", { account, cwd: session.cwd });
        queueInit(reviewer, `claude --permission-mode plan ${shellQuote(reviewPrompt(task.title))}`);
        toast(`Reviewing "${task.title}" as ${account ?? "claude"}`);
      }
    }
  });
}
