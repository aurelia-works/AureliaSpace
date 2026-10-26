import { useEffect, useState } from "react";
import { useChat } from "../lib/chat";
import { basename } from "../lib/format";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { usePrs } from "../store/prs";
import { useRuntime } from "../store/runtime";
import { ipc, type PrInfo } from "../lib/ipc";
import { usePaneAgent } from "./AgentChip";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

interface Project {
  root: string;
  name: string;
  branch?: string;
  panes: { id: string; tab: number }[];
}

const SNOOZE_MS = 60 * 60_000;
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A chat's first message, as the thread's name. */
function useChatTitle(paneId: string) {
  return useChat((s) => {
    const first = s.byPane[paneId]?.transcript.items.find((i) => i.kind === "user");
    return first?.kind === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 80) : undefined;
  });
}

function PrBadge({ pr }: { pr: PrInfo }) {
  const tone = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.conflicts ? "fail" : pr.checks;
  const what =
    pr.state !== "OPEN"
      ? pr.state.toLowerCase()
      : [pr.draft && "draft", pr.checks !== "none" && `checks ${pr.checks}`, pr.conflicts && "conflicts", pr.review && pr.review.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(", ");
  return (
    <span
      role="link"
      className={`nav-pr num ${tone}`}
      title={`PR #${pr.number}: ${pr.title}${what ? `\n${what}` : ""}\nClick to open on GitHub`}
      onClick={(e) => {
        e.stopPropagation();
        void ipc.openUrl(pr.url);
      }}
    >
      #{pr.number}
    </span>
  );
}

function PaneRow({ paneId, tab, focused, projectBranch, snoozed }: { paneId: string; tab: number; focused: boolean; projectBranch?: string; snoozed: boolean }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const running = useRuntime((s) => s.panes[paneId]?.running);
  const git = useGit((s) => {
    const d = paneDir(paneId);
    return d ? s.info[d] : undefined;
  });
  const pr = usePrs((s) => {
    const d = paneDir(paneId);
    return d ? s.byDir[d] : undefined;
  });
  const title = useChatTitle(paneId);
  const custom = usePaneAgent(paneId);
  const account = pane?.account ?? agent?.account;
  const isClaude = !!agent || !!account;
  const v: Visual | undefined = agent ? visualOf(agent) : isClaude ? "starting" : undefined;
  const kind = pane?.browser ? "Browser" : pane?.editor ? (pane.editor.path.split("/").pop() ?? "Editor") : pane?.launcher ? "New tab" : custom ? custom.name : isClaude ? (account ?? "Claude") : (running?.split(/\s+/)[0] ?? "Terminal");
  const label = title ?? kind;
  const status = agent ? (agent.status === "working" && agent.tool ? agent.tool : stateLabel[visualOf(agent)]) : running && !isClaude ? "running" : "";
  // The project row already names its checkout's branch; say it here only when it differs.
  const branch = git && git.branch !== projectBranch ? git.branch : undefined;
  const sub = [snoozed && pane?.snoozedUntil ? `snoozed until ${clock(pane.snoozedUntil)}` : status, branch].filter(Boolean).join(" · ");
  const update = useLayout.getState().updatePane;

  return (
    <div className={`nav-thread${focused ? " focused" : ""}${pane?.settled || snoozed ? " settled" : ""}`}>
      <button
        className={`nav-pane${focused ? " focused" : ""}${v ? ` ${v}` : ""}`}
        onClick={() => showPane(paneId)}
        title={[label !== kind ? `${kind}: ${label}` : label, paneDir(paneId)].filter(Boolean).join("\n")}
        aria-current={focused ? "true" : undefined}
      >
        {v ? <StatusGlyph state={v} /> : <StatusGlyph state="shell" busy={!!running} />}
        <span className="nav-thread-text">
          <span className="nav-pane-label">{label}</span>
          {sub && <span className="nav-pane-sub">{sub}</span>}
        </span>
        {pane?.babysit && (
          <span className="nav-babysit" title={`Babysitting its PR: woken ${pane.babysitWakes ?? 0} times (turn it off in Details)`}>
            ◉
          </span>
        )}
        {pr && <PrBadge pr={pr} />}
        <span className="nav-pane-tab num" title={`Tab ${tab + 1}`}>
          {tab + 1}
        </span>
      </button>
      <span className="nav-thread-actions">
        {pane?.settled || snoozed ? (
          <button className="nav-act" title="Back to the active threads" onClick={() => update(paneId, { settled: false, snoozedUntil: undefined })}>
            Wake
          </button>
        ) : (
          <>
            <button className="nav-act" title="Snooze: out of the way for an hour, or until it needs you" onClick={() => update(paneId, { snoozedUntil: Date.now() + SNOOZE_MS })}>
              Snooze
            </button>
            <button className="nav-act" title="Settle: done for now, move it under Settled" onClick={() => update(paneId, { settled: true })}>
              Settle
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** Every open pane as a thread, grouped by repository (worktrees under their repo), most urgent project first. */
export function ProjectsSidebar() {
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const activeTabId = useLayout((s) => s.activeTabId);
  const sessions = useAgents((s) => s.sessions);
  const git = useGit((s) => s.info);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showSettled, setShowSettled] = useState<Record<string, boolean>>({});
  // Snoozes end on the clock, so re-check once a minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const snoozed = (id: string) => (panes[id]?.snoozedUntil ?? 0) > now && sessions[id]?.status !== "needs_input";
  const away = (id: string) => !!panes[id]?.settled || snoozed(id);

  const focusedId = tabs.find((t) => t.id === activeTabId)?.focusedPaneId;
  const projects: Project[] = [];
  const byRoot = new Map<string, Project>();
  tabs.forEach((tab, ti) => {
    for (const id of paneIds(tab.root)) {
      const dir = sessions[id]?.cwd ?? panes[id]?.cwd ?? "";
      const g = git[dir];
      const root = g?.repo ?? g?.root ?? dir;
      let p = byRoot.get(root);
      if (!p) {
        p = { root, name: basename(root) || "~", panes: [] };
        byRoot.set(root, p);
        projects.push(p);
      }
      if (g && g.root === g.repo) p.branch = g.branch;
      p.panes.push({ id, tab: ti });
    }
  });
  const rank = (id: string) => (sessions[id] ? urgency[visualOf(sessions[id])] : 5);
  const best = (p: Project) => Math.min(5, ...p.panes.filter(({ id }) => !away(id)).map(({ id }) => rank(id)));
  projects.sort((a, b) => best(a) - best(b));

  return (
    <div className="nav-tree" role="tree" aria-label="Threads">
      {projects.map((p) => {
        const isCollapsed = collapsed[p.root];
        const active = p.panes.filter(({ id }) => !away(id)).sort((a, b) => rank(a.id) - rank(b.id));
        const settled = p.panes.filter(({ id }) => away(id));
        const needs = active.filter(({ id }) => sessions[id]?.status === "needs_input").length;
        const row = ({ id, tab }: { id: string; tab: number }) => <PaneRow key={id} paneId={id} tab={tab} focused={id === focusedId} projectBranch={p.branch} snoozed={snoozed(id)} />;
        return (
          <div key={p.root} className="nav-project" role="treeitem" aria-expanded={!isCollapsed}>
            <button className="nav-project-head" title={p.root} onClick={() => setCollapsed({ ...collapsed, [p.root]: !isCollapsed })}>
              <span className={`chev${isCollapsed ? "" : " open"}`} aria-hidden>
                ›
              </span>
              <span className="nav-project-name">{p.name}</span>
              {p.branch && <span className="nav-project-branch mono">{p.branch}</span>}
              {needs > 0 && <span className="nav-needs num">{needs}</span>}
              <span className="nav-count num">{active.length}</span>
            </button>
            {!isCollapsed && (
              <div role="group">
                {active.map(row)}
                {settled.length > 0 && (
                  <>
                    <button className="nav-settled-head" onClick={() => setShowSettled({ ...showSettled, [p.root]: !showSettled[p.root] })}>
                      <span className={`chev${showSettled[p.root] ? " open" : ""}`} aria-hidden>
                        ›
                      </span>
                      {settled.some(({ id }) => snoozed(id)) ? "Settled and snoozed" : "Settled"} <span className="num">{settled.length}</span>
                    </button>
                    {showSettled[p.root] && settled.map(row)}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
