import { useEffect, useMemo, useState } from "react";
import { basename, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { focusTerminal, showPane } from "../lib/terminals";
import { useAgents, type AgentSession } from "../store/agents";
import { focusedPaneId, paneIds, useLayout } from "../store/layout";
import { draftInPane, usePrompts, type SavedPrompt } from "../store/prompts";
import { useRecents } from "../store/recents";
import { useTasks, type Task, type TaskStatus } from "../store/tasks";
import { useUi } from "../store/ui";
import { AgentChip, usePaneAgent } from "./AgentChip";
import { CloseIcon, PinIcon, PlayIcon } from "./Icons";
import { PermissionButtons, ReplyBox, since } from "./SessionExtras";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

function goToPane(paneId: string) {
  useLayout.getState().focusPane(paneId);
  requestAnimationFrame(() => focusTerminal(paneId));
}

/**
 * One line per agent: glyph, project, account, age. Only an agent that needs you grows: its
 * question, the permission answers and a reply box. Metrics live on the board and pane header.
 */
function AgentRow({ s, tabIndex, now }: { s: AgentSession; tabIndex: number; now: number }) {
  const v = visualOf(s);
  const custom = usePaneAgent(s.paneId);
  return (
    <div className={`q-row ${v}`}>
      <button className="q-open" onClick={() => showPane(s.paneId)} title={`${shortenPath(s.cwd)} · tab ${tabIndex + 1} · ${stateLabel[v]}`}>
        <StatusGlyph state={v} />
        <span className="q-main">
          <span className="q-line">
            <span className="q-folder">{basename(s.cwd) || "—"}</span>
            {custom ? <AgentChip agent={custom} /> : <span className="q-account">{s.account ?? "claude"}</span>}
            <span className="q-ago num" title="Since last change">
              {since(now - s.updatedAt)}
            </span>
          </span>
          {v === "needs_input" && <span className="q-detail">{s.message || "Waiting for you"}</span>}
          {v === "working" && s.tool && <span className="q-detail quiet">{s.tool}</span>}
        </span>
      </button>
      {v === "needs_input" && <PermissionButtons paneId={s.paneId} />}
      {v === "needs_input" && <ReplyBox paneId={s.paneId} />}
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

/**
 * Drags a saved prompt with the pointer (Tauri's native drop handler eats HTML5 drags); let
 * go over a pane to open its composer with the prompt in it. A plain click uses the focused pane.
 */
function dragPrompt(e: React.PointerEvent, p: SavedPrompt) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  let over: HTMLElement | null = null;
  const target = (ev: PointerEvent) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-pane-id]") ?? null;
  const hover = (el: HTMLElement | null) => {
    if (el === over) return;
    over?.classList.remove("drop-target");
    el?.classList.add("drop-target");
    over = el;
  };
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    if (!active) document.body.classList.add("prompt-dragging");
    active = true;
    hover(target(ev));
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("prompt-dragging");
    hover(null);
    const paneId = active ? target(ev)?.dataset.paneId : focusedPaneId();
    if (paneId) draftInPane(paneId, p.text);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function Prompts() {
  const saved = usePrompts((s) => s.saved);
  return (
    <section className="rail-section">
      <h3 className="rail-head">
        <span className="label">Prompts</span>
        <span className="rail-count num">{saved.length}</span>
      </h3>
      {saved.length === 0 ? (
        <p className="empty">
          Write a prompt or command in the composer (<kbd>⌘L</kbd>) and press Save. Click one to use it, or drag it onto any pane. <code>{"{{name}}"}</code> fields are asked for each time.
        </p>
      ) : (
        saved.map((p) => (
          <div key={p.id} className="recent-row prompt-row">
            <button className="recent-open" onPointerDown={(e) => dragPrompt(e, p)} title={`${p.text}\n\nClick: put it in the focused pane's composer · drag onto a pane`}>
              <span className="recent-name prompt-title">{p.title}</span>
            </button>
            <button className="icon-btn recent-del" onClick={() => usePrompts.getState().remove(p.id)} title="Delete prompt">
              <CloseIcon width={11} height={11} />
            </button>
          </div>
        ))
      )}
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

/** Right rail (⌘B): the agent queue, tasks for the focused project, saved prompts, and recent folders. */
/** The right column's Queue tab (components/RightPanel.tsx). */
export function QueueRail() {
  return (
    <>
      <Queue />
      <Tasks />
      <Prompts />
      <Recents />
    </>
  );
}
