import { useEffect, useMemo, useState } from "react";
import { basename, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { focusTerminal, showPane } from "../lib/terminals";
import { useAgents, type AgentSession } from "../store/agents";
import { useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { useTasks, type Task, type TaskStatus } from "../store/tasks";
import { useUi } from "../store/ui";
import { CacheBadge } from "./CacheBadge";
import { BranchIcon, CloseIcon, PinIcon, PlayIcon } from "./Icons";
import { MetricsLine, PermissionButtons, ReplyBox, since } from "./SessionExtras";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

function goToPane(paneId: string) {
  useLayout.getState().focusPane(paneId);
  requestAnimationFrame(() => focusTerminal(paneId));
}

function AgentRow({ s, tabIndex, now }: { s: AgentSession; tabIndex: number; now: number }) {
  const v = visualOf(s);
  const git = useGit((g) => (s.cwd ? g.info[s.cwd] : undefined));
  const detail =
    v === "needs_input" ? s.message || "Waiting for you" : v === "working" ? (s.tool ? `Running ${s.tool}` : "Thinking…") : v === "done" ? "Finished. Your turn." : "";
  return (
    <div className={`q-row ${v}`}>
      <button className="q-open" onClick={() => showPane(s.paneId)} title={`${shortenPath(s.cwd)} · open pane`}>
        <StatusGlyph state={v} />
        <span className="q-main">
          <span className="q-line">
            <span className="q-folder">{basename(s.cwd) || "—"}</span>
            <span className="account-chip">{s.account ?? "claude"}</span>
            <span className="q-ago num" title="Since last change">
              {since(now - s.updatedAt)}
            </span>
          </span>
          <span className="q-sub">
            <span className={`state-text ${v}`}>{stateLabel[v]}</span>
            {git && (
              <span className={`git-chip${git.worktree ? " worktree" : ""}`}>
                <BranchIcon width={10} height={10} />
                {git.branch}
              </span>
            )}
            <span className="q-tab num">tab {tabIndex + 1}</span>
          </span>
          {detail && <span className="q-detail">{detail}</span>}
        </span>
      </button>
      {v === "needs_input" && <PermissionButtons paneId={s.paneId} />}
      {(v === "needs_input" || v === "done") && <ReplyBox paneId={s.paneId} />}
      <span className="q-foot">
        <MetricsLine paneId={s.paneId} />
        <CacheBadge session={s} />
      </span>
    </div>
  );
}

function useNow(ms: number) {
  const [now, set] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const GROUPS: { id: Visual[]; label: string }[] = [
  { id: ["needs_input"], label: "Needs you" },
  { id: ["done"], label: "Finished" },
  { id: ["working", "starting"], label: "Working" },
  { id: ["idle"], label: "Idle" },
];

/** Agents by urgency: whoever needs you is always the first thing in the rail. */
function Queue() {
  const sessions = useAgents((s) => s.sessions);
  const tabs = useLayout((s) => s.tabs);
  const now = useNow(10_000);
  const list = Object.values(sessions).sort((a, b) => urgency[visualOf(a)] - urgency[visualOf(b)] || a.updatedAt - b.updatedAt);
  const tabIndex = (paneId: string) => tabs.findIndex((t) => paneIds(t.root).includes(paneId));
  return (
    <section className="rail-section" aria-label="Agent queue">
      <h3 className="rail-head">
        <span className="label">Queue</span>
        <span className="rail-count num">{list.length}</span>
      </h3>
      {list.length === 0 ? (
        <p className="empty">
          No Claude sessions. <kbd>⌘E</kbd> opens one as an account, or run <code>claude</code> in any pane.
        </p>
      ) : (
        GROUPS.map((g) => {
          const rows = list.filter((s) => g.id.includes(visualOf(s)));
          if (!rows.length) return null;
          return (
            <div key={g.label} className={`q-group ${g.id[0]}`}>
              <div className="q-group-head">
                <span>{g.label}</span>
                <span className="num">{rows.length}</span>
              </div>
              {rows.map((s) => (
                <AgentRow key={s.paneId} s={s} tabIndex={tabIndex(s.paneId)} now={now} />
              ))}
            </div>
          );
        })
      )}
    </section>
  );
}

const statusOrder: TaskStatus[] = ["doing", "todo", "done"];
const statusGlyph: Record<TaskStatus, string> = { todo: "○", doing: "◐", done: "●" };
const statusName: Record<TaskStatus, string> = { todo: "To do", doing: "Doing", done: "Done" };

function TaskRow({ project, task, focusedPane }: { project: string; task: Task; focusedPane?: string }) {
  const { cycle, remove, attach } = useTasks.getState();
  const attachedHere = !!focusedPane && task.paneId === focusedPane;
  const attachedElsewhere = !!task.paneId && !attachedHere;
  return (
    <div className={`task-row ${task.status}`}>
      <button className="task-status" onClick={() => cycle(project, task.id)} title={`${statusName[task.status]}: click to advance`} aria-label={`${statusName[task.status]}, advance status`}>
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
      <section className="rail-section">
        <h3 className="rail-head">
          <span className="label">Tasks</span>
        </h3>
        <p className="empty">Tasks follow the focused pane's project.</p>
      </section>
    );
  }

  return (
    <section className="rail-section tasks">
      <h3 className="rail-head" title={project}>
        <span className="label">Tasks</span>
        <span className="rail-project">{basename(project)}</span>
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
                <span className={`chev${showDone ? " open" : ""}`} aria-hidden>›</span> Done <span className="num">{list.length}</span>
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

function Recents() {
  const folders = useRecents((s) => s.folders);
  return (
    <section className="rail-section">
      <h3 className="rail-head">
        <span className="label">Recent folders</span>
        <span className="rail-count num">{folders.length}</span>
      </h3>
      {folders.length === 0 ? (
        <p className="empty">Folders you work in show up here.</p>
      ) : (
        folders.map((f) => (
          <div key={f} className="recent-row">
            <button className="recent-open" onClick={() => useLayout.getState().newTab({ launcher: true, cwd: f })} title={`Open ${f} in a new tab`}>
              <span className="recent-name">{basename(f)}</span>
              <span className="recent-path">{shortenPath(f)}</span>
            </button>
            <button className="icon-btn recent-del" onClick={() => useRecents.getState().remove(f)} title="Remove from recents">
              <CloseIcon width={11} height={11} />
            </button>
          </div>
        ))
      )}
    </section>
  );
}

/** Right rail (⌘B): the agent queue, tasks for the focused project, and recent folders. */
export function QueueRail() {
  return (
    <aside className="rail" aria-label="Queue">
      <Queue />
      <Tasks />
      <Recents />
    </aside>
  );
}
