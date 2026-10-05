import { useEffect, useMemo, useState } from "react";
import { basename, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { focusTerminal } from "../lib/terminals";
import { useAgents, type AgentSession, type AgentStatus } from "../store/agents";
import { useConfig } from "../store/config";
import { useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { useTasks, type Task, type TaskStatus } from "../store/tasks";
import { useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { BranchIcon, CloseIcon, PinIcon, PlayIcon } from "./Icons";
import { statusLabel } from "./PaneHeader";
import { MetricsLine, PermissionButtons } from "./SessionExtras";
import { UsageMeter } from "./UsageMeter";

const urgency: Record<AgentStatus, number> = { needs_input: 0, working: 1, starting: 2, idle: 3 };

function goToPane(paneId: string) {
  useLayout.getState().focusPane(paneId);
  requestAnimationFrame(() => focusTerminal(paneId));
}

function AgentRow({ s, tabIndex }: { s: AgentSession; tabIndex: number }) {
  const ago = Math.max(0, Math.round((Date.now() - s.updatedAt) / 1000));
  const when = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago / 60)}m` : `${Math.round(ago / 3600)}h`;
  const git = useGit((g) => (s.cwd ? g.info[s.cwd] : undefined));
  return (
    <button className={`agent-row ${s.status}${s.attention ? " attention" : ""}`} onClick={() => goToPane(s.paneId)} title={shortenPath(s.cwd)}>
      <span className={`status-dot ${s.status}`} />
      <span className="agent-main">
        <span className="agent-line">
          <span className="account-chip">{s.account ?? "claude"}</span>
          <span className="agent-cwd">{basename(s.cwd) || "—"}</span>
          <span className="agent-tab">tab {tabIndex + 1}</span>
        </span>
        <span className="agent-sub">
          <span className={`agent-status ${s.status}`}>{statusLabel[s.status]}</span>
          {s.status === "working" && s.tool && <span className="agent-detail">· {s.tool}</span>}
          {s.status === "needs_input" && s.message && <span className="agent-detail">· {s.message}</span>}
          {s.status === "idle" && s.attention && <span className="agent-detail done">· finished</span>}
          {git && (
            <span className={`agent-branch${git.worktree ? " worktree" : ""}`}>
              <BranchIcon width={10} height={10} />
              {git.branch}
            </span>
          )}
          <span className="agent-ago">{when}</span>
        </span>
        {s.status === "needs_input" && <PermissionButtons paneId={s.paneId} />}
        <MetricsLine paneId={s.paneId} />
      </span>
    </button>
  );
}

function useNow(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Agents() {
  const sessions = useAgents((s) => s.sessions);
  const tabs = useLayout((s) => s.tabs);
  useNow(10_000);
  const list = Object.values(sessions).sort((a, b) => urgency[a.status] - urgency[b.status] || b.updatedAt - a.updatedAt);
  const tabIndex = (paneId: string) => tabs.findIndex((t) => paneIds(t.root).includes(paneId));
  return (
    <section className="panel-section">
      <h3>
        Agents <span className="count">{list.length}</span>
      </h3>
      {list.length === 0 ? (
        <p className="empty">
          No Claude sessions. Press <kbd>⌘E</kbd> to open one as an account, or run <code>claude</code> in any pane.
        </p>
      ) : (
        list.map((s) => <AgentRow key={s.paneId} s={s} tabIndex={tabIndex(s.paneId)} />)
      )}
    </section>
  );
}

const statusOrder: TaskStatus[] = ["doing", "todo", "done"];
const statusGlyph: Record<TaskStatus, string> = { todo: "○", doing: "◐", done: "●" };

function TaskRow({ project, task, focusedPane }: { project: string; task: Task; focusedPane?: string }) {
  const { cycle, remove, attach } = useTasks.getState();
  const attachedHere = !!focusedPane && task.paneId === focusedPane;
  const attachedElsewhere = !!task.paneId && !attachedHere;
  return (
    <div className={`task-row ${task.status}`}>
      <button className="task-status" onClick={() => cycle(project, task.id)} title={`${task.status} — click to advance`}>
        {statusGlyph[task.status]}
      </button>
      <span className="task-title" onDoubleClick={() => task.paneId && goToPane(task.paneId)}>
        {task.title}
      </span>
      {task.status !== "done" && !task.paneId && (
        <button
          className="icon-btn task-run"
          onClick={() => useUi.getState().set({ accountPicker: { target: "split", task: { project, id: task.id, title: task.title } } })}
          title="Start this task in a new Claude pane"
        >
          <PlayIcon width={11} height={11} />
        </button>
      )}
      {attachedElsewhere && (
        <button className="task-attached" onClick={() => goToPane(task.paneId!)} title="Attached to another pane — go there">
          ↗
        </button>
      )}
      <button
        className={`icon-btn task-pin${attachedHere ? " on" : ""}`}
        onClick={() => attach(project, task.id, attachedHere ? undefined : focusedPane)}
        disabled={!focusedPane}
        title={attachedHere ? "Detach from this pane" : "Attach to focused pane"}
      >
        <PinIcon width={12} height={12} />
      </button>
      <button className="icon-btn task-del" onClick={() => remove(project, task.id)} title="Delete task">
        <CloseIcon width={11} height={11} />
      </button>
    </div>
  );
}

function Tasks() {
  const focusedPane = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const cwd = useLayout((s) => (focusedPane ? s.panes[focusedPane]?.cwd : undefined));
  const projects = useTasks((s) => s.projects);
  const [project, setProject] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!cwd) {
      setProject(null);
      return;
    }
    ipc.projectRoot(cwd).then((root) => alive && setProject(root), () => alive && setProject(cwd));
    return () => {
      alive = false;
    };
  }, [cwd]);

  const tasks = useMemo(() => (project ? projects[project] ?? [] : []), [project, projects]);
  const grouped = statusOrder.map((st) => [st, tasks.filter((t) => t.status === st)] as const);

  if (!project) {
    return (
      <section className="panel-section">
        <h3>Tasks</h3>
        <p className="empty">Tasks follow the focused pane's project.</p>
      </section>
    );
  }

  return (
    <section className="panel-section tasks">
      <h3 title={project}>
        Tasks <span className="project">{basename(project)}</span>
      </h3>
      <form
        className="task-add"
        onSubmit={(e) => {
          e.preventDefault();
          useTasks.getState().add(project, draft);
          setDraft("");
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task…" spellCheck={false} />
      </form>
      {grouped.map(([st, list]) =>
        st === "done" ? (
          list.length > 0 && (
            <div key={st}>
              <button className="task-group-toggle" onClick={() => setShowDone(!showDone)}>
                {showDone ? "▾" : "▸"} done ({list.length})
              </button>
              {showDone && list.map((t) => <TaskRow key={t.id} project={project} task={t} focusedPane={focusedPane} />)}
            </div>
          )
        ) : (
          list.map((t) => <TaskRow key={t.id} project={project} task={t} focusedPane={focusedPane} />)
        ),
      )}
      {tasks.length === 0 && <p className="empty">No tasks for this project yet.</p>}
    </section>
  );
}

function Accounts() {
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const usage = useUsage((s) => s.usage);
  const fetchedAt = useUsage((s) => s.fetchedAt);
  const refreshSecs = useConfig((s) => s.config?.usageRefreshSeconds ?? 180);
  useEffect(() => {
    const tick = () => {
      const { refresh, fetchedAt } = useUsage.getState();
      accounts.forEach((a) => {
        if (Date.now() - (fetchedAt[a.name] ?? 0) > refreshSecs * 1000) refresh(a.name);
      });
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [accounts, refreshSecs]);

  return (
    <section className="panel-section">
      <h3>
        Accounts
        <button
          className="link-btn"
          onClick={() => accounts.forEach((a) => useUsage.getState().refresh(a.name, true))}
          title="Refresh usage now"
        >
          refresh
        </button>
      </h3>
      {accounts.map((a) => (
        <div key={a.name} className="account-row" title={a.configDir}>
          <span className="account-chip">{a.name}</span>
          <UsageMeter usage={fetchedAt[a.name] ? usage[a.name] : undefined} />
        </div>
      ))}
    </section>
  );
}

export function AgentPanel() {
  return (
    <aside className="agent-panel">
      <Agents />
      <Tasks />
      <Accounts />
    </aside>
  );
}
