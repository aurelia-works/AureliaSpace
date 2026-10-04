import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { uid } from "./layout";

export type TaskStatus = "todo" | "doing" | "done";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** Pane this task is attached to, if any. */
  paneId?: string;
  createdAt: number;
}

interface TasksState {
  /** Keyed by project root (git root, or cwd outside a repo). */
  projects: Record<string, Task[]>;
  add(project: string, title: string, paneId?: string): void;
  setStatus(project: string, id: string, status: TaskStatus): void;
  cycle(project: string, id: string): void;
  remove(project: string, id: string): void;
  attach(project: string, id: string, paneId: string | undefined): void;
  rename(project: string, id: string, title: string): void;
}

const order: TaskStatus[] = ["todo", "doing", "done"];

export const useTasks = create<TasksState>((set, get) => {
  const update = (project: string, id: string, fn: (t: Task) => Task) =>
    set((s) => ({
      projects: { ...s.projects, [project]: (s.projects[project] ?? []).map((t) => (t.id === id ? fn(t) : t)) },
    }));
  return {
    projects: {},
    add(project, title, paneId) {
      const t = title.trim();
      if (!t) return;
      const task: Task = { id: uid("task"), title: t, status: "todo", paneId, createdAt: Date.now() };
      set((s) => ({ projects: { ...s.projects, [project]: [...(s.projects[project] ?? []), task] } }));
    },
    setStatus: (project, id, status) => update(project, id, (t) => ({ ...t, status })),
    cycle(project, id) {
      const task = get().projects[project]?.find((t) => t.id === id);
      if (!task) return;
      const status = order[(order.indexOf(task.status) + 1) % order.length];
      update(project, id, (t) => ({ ...t, status }));
    },
    remove: (project, id) =>
      set((s) => ({ projects: { ...s.projects, [project]: (s.projects[project] ?? []).filter((t) => t.id !== id) } })),
    attach: (project, id, paneId) => update(project, id, (t) => ({ ...t, paneId })),
    rename: (project, id, title) => update(project, id, (t) => ({ ...t, title: title.trim() || t.title })),
  };
});

export async function loadTasks() {
  const saved = await ipc.loadState<{ projects: Record<string, Task[]> }>("tasks").catch(() => null);
  if (saved?.projects) useTasks.setState({ projects: saved.projects });
  let timer: ReturnType<typeof setTimeout> | undefined;
  useTasks.subscribe((s, prev) => {
    if (s.projects === prev.projects) return;
    clearTimeout(timer);
    timer = setTimeout(() => ipc.saveState("tasks", { projects: useTasks.getState().projects }).catch(() => {}), 400);
  });
}

/** Unfinished tasks attached to a pane, across all projects. */
export function tasksForPane(projects: Record<string, Task[]>, paneId: string): Task[] {
  return Object.values(projects)
    .flat()
    .filter((t) => t.paneId === paneId && t.status !== "done");
}
