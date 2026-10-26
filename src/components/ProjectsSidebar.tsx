import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useChat } from "../lib/chat";
import { basename } from "../lib/format";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { usePrs } from "../store/prs";
import { useRuntime } from "../store/runtime";
import { ipc, type PrInfo, type WorktreeEntry } from "../lib/ipc";
import { matchesFilter, prAttention, snoozeChoices } from "../lib/threads";
import { toast } from "../store/ui";
import { usePaneAgent } from "./AgentChip";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

interface Project {
  root: string;
  name: string;
  branch?: string;
  panes: { id: string; tab: number }[];
}

const clock = (at: number) => {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
};

/** Closes every pane working inside `root`, then removes that worktree. Checks for uncommitted work first. */
export async function cleanUpWorktree(root: string) {
  const entry = (await ipc.listWorktrees(root).catch(() => [] as WorktreeEntry[])).find((w) => w.path === root);
  if (!entry) return toast("Only worktrees AureliaSpace made can be cleaned up.", true);
  if (entry.dirty) return toast(`${basename(root)} has uncommitted changes; left alone.`, true);
  const layout = useLayout.getState();
  for (const id of Object.keys(layout.panes)) {
    const d = paneDir(id);
    if (d && (d === root || d.startsWith(`${root}/`))) layout.closePane(id);
  }
  try {
    await ipc.removeWorktree(root);
    toast(`Removed worktree ${basename(root)}.`);
  } catch (e) {
    toast(String(e), true);
  }
}

/** The snooze choices, plus a custom date and time. */
function SnoozeMenu({ onPick, onClose }: { onPick: (until: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    const away = (e: globalThis.MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="snooze-menu" role="menu" onClick={(e) => e.stopPropagation()}>
      {snoozeChoices(new Date()).map((c) => (
        <button key={c.label} role="menuitem" onClick={() => onPick(c.until)}>
          <span>{c.label}</span>
          <span className="snooze-when">{clock(c.until)}</span>
        </button>
      ))}
      <form
        className="snooze-custom"
        onSubmit={(e) => {
          e.preventDefault();
          const t = new Date(custom).getTime();
          if (t > Date.now()) onPick(t);
        }}
      >
        <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Snooze until" />
        <button type="submit" disabled={!custom}>
          Set
        </button>
      </form>
      <p className="snooze-note">It comes back early if it needs you.</p>
    </div>
  );
}

/** A chat's first message, as the thread's name. */
function useChatTitle(paneId: string) {
  return useChat((s) => {
    const first = s.byPane[paneId]?.transcript.items.find((i) => i.kind === "user");
    return first?.kind === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 80) : undefined;
  });
}

function PrBadge({ pr, attention, onOpen }: { pr: PrInfo; attention: string | null; onOpen: () => void }) {
  const tone = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.conflicts ? "fail" : pr.checks;
  const what =
    pr.state !== "OPEN"
      ? pr.state.toLowerCase()
      : [pr.draft && "draft", pr.checks !== "none" && `checks ${pr.checks}`, pr.conflicts && "conflicts", pr.review && pr.review.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(", ");
  return (
    <span
      role="link"
      className={`nav-pr num ${tone}${attention ? " attn" : ""}`}
      title={`PR #${pr.number}: ${pr.title}${what ? `\n${what}` : ""}${attention ? `\nNeeds you: ${attention}` : ""}\nClick to open on GitHub`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
        void ipc.openUrl(pr.url);
      }}
    >
      #{pr.number}
    </span>
  );
}

function PaneRow({ paneId, focused, projectBranch, snoozed, selected, onSelect }: { paneId: string; focused: boolean; projectBranch?: string; snoozed: boolean; selected: boolean; onSelect: (e: MouseEvent) => boolean }) {
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
  const [menu, setMenu] = useState(false);
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
  const attention = prAttention(pr, pane?.prSeenFeedback);
  const sub = [snoozed && pane?.snoozedUntil ? `snoozed until ${clock(pane.snoozedUntil)}` : status, branch].filter(Boolean).join(" · ");
  const update = useLayout.getState().updatePane;
  const away = pane?.settled || snoozed;

  return (
    <div className={`nav-thread${focused ? " focused" : ""}${away ? " settled" : ""}${selected ? " selected" : ""}`}>
      <button
        className={`nav-pane${focused ? " focused" : ""}${v ? ` ${v}` : ""}`}
        onClick={(e) => onSelect(e) || showPane(paneId)}
        title={[label !== kind ? `${kind}: ${label}` : label, paneDir(paneId), "⌘-click to select several"].filter(Boolean).join("\n")}
        aria-current={focused ? "true" : undefined}
        aria-selected={selected}
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
        {pr && <PrBadge pr={pr} attention={attention} onOpen={() => update(paneId, { prSeenFeedback: pr.feedback })} />}
      </button>
      <span className={`nav-thread-actions${menu ? " open" : ""}`}>
        {away ? (
          <>
            {git?.worktree && (
              <button className="nav-act" title="Close this thread and remove its worktree (only when it has no uncommitted changes)" onClick={() => void cleanUpWorktree(git.root)}>
                Clean up
              </button>
            )}
            <button className="nav-act" title="Back to the active threads" onClick={() => update(paneId, { settled: false, snoozedUntil: undefined })}>
              Wake
            </button>
          </>
        ) : (
          <>
            <button className="nav-act" title="Snooze: out of the way until a time you pick, or until it needs you" onClick={() => setMenu(!menu)}>
              Snooze
            </button>
            <button className="nav-act" title="Settle: done for now, move it under Settled" onClick={() => update(paneId, { settled: true })}>
              Settle
            </button>
          </>
        )}
        {menu && (
          <SnoozeMenu
            onClose={() => setMenu(false)}
            onPick={(until) => {
              update(paneId, { snoozedUntil: until });
              setMenu(false);
            }}
          />
        )}
      </span>
    </div>
  );
}

/** Worktrees AureliaSpace made for this repo that no open pane uses any more. */
function useLeftovers(roots: string[], panes: unknown, version: number) {
  const [byRoot, setByRoot] = useState<Record<string, WorktreeEntry[]>>({});
  const key = roots.join("\n");
  useEffect(() => {
    let live = true;
    void Promise.all(roots.map((r) => ipc.listWorktrees(r).catch(() => [] as WorktreeEntry[]))).then((lists) => {
      if (!live) return;
      const used = Object.keys(useLayout.getState().panes).map(paneDir).filter(Boolean) as string[];
      const free = (w: WorktreeEntry) => !used.some((d) => d === w.path || d.startsWith(`${w.path}/`));
      setByRoot(Object.fromEntries(roots.map((r, i) => [r, (lists[i] ?? []).filter(free)])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, panes, version]);
  return byRoot;
}

/** Every open pane as a thread, grouped by repository (worktrees under their repo), most urgent project first. */
export function ProjectsSidebar() {
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const activeTabId = useLayout((s) => s.activeTabId);
  const sessions = useAgents((s) => s.sessions);
  const git = useGit((s) => s.info);
  const prs = usePrs((s) => s.byDir);
  const titles = useChat((s) => s.byPane);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showSettled, setShowSettled] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState(false);
  const [removed, setRemoved] = useState(0);
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
  const leftovers = useLeftovers(
    projects.filter((p) => git[p.root] || Object.values(git).some((g) => g?.repo === p.root)).map((p) => p.root),
    panes,
    removed,
  );
  const rank = (id: string) => (sessions[id] ? urgency[visualOf(sessions[id])] : 5);
  const best = (p: Project) => Math.min(5, ...p.panes.filter(({ id }) => !away(id)).map(({ id }) => rank(id)));
  projects.sort((a, b) => best(a) - best(b));

  const shown = (p: Project, id: string) => {
    if (!filter.trim()) return true;
    const first = titles[id]?.transcript.items.find((i) => i.kind === "user");
    const d = paneDir(id);
    return matchesFilter(filter, [p.name, first?.kind === "user" ? first.text : undefined, panes[id]?.account, d, d ? git[d]?.branch : undefined, d && prs[d] ? `#${prs[d]!.number} ${prs[d]!.title}` : undefined]);
  };
  const live = [...selected].filter((id) => panes[id]);
  const select = (id: string) => (e: MouseEvent) => {
    if (!e.metaKey && !e.shiftKey && live.length === 0) return false;
    const next = new Set(live);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    return true;
  };
  const bulk = (patch: Parameters<ReturnType<typeof useLayout.getState>["updatePane"]>[1]) => {
    for (const id of live) useLayout.getState().updatePane(id, patch);
    setSelected(new Set());
    setBulkMenu(false);
  };
  const bulkCleanUp = async () => {
    const roots = new Set(live.map((id) => paneDir(id)).map((d) => (d ? git[d] : undefined)).filter((g) => g?.worktree).map((g) => g!.root));
    setSelected(new Set());
    for (const r of roots) await cleanUpWorktree(r);
  };

  return (
    <div className="nav-tree" role="tree" aria-label="Threads">
      {live.length > 0 ? (
        <div className="nav-bulk" role="toolbar" aria-label="Selected threads">
          <span className="nav-bulk-count num">{live.length} selected</span>
          <span className="nav-bulk-acts">
            <button className="nav-act" onClick={() => setBulkMenu(!bulkMenu)}>
              Snooze
            </button>
            <button className="nav-act" onClick={() => bulk({ settled: true })}>
              Settle
            </button>
            <button className="nav-act" onClick={() => bulk({ settled: false, snoozedUntil: undefined })}>
              Wake
            </button>
            {live.some((id) => {
              const d = paneDir(id);
              return d && git[d]?.worktree;
            }) && (
              <button className="nav-act" title="Close these threads and remove their worktrees (skips any with uncommitted changes)" onClick={() => void bulkCleanUp()}>
                Clean up
              </button>
            )}
            <button className="nav-act" title="Clear the selection (Esc)" onClick={() => setSelected(new Set())}>
              ✕
            </button>
          </span>
          {bulkMenu && <SnoozeMenu onClose={() => setBulkMenu(false)} onPick={(until) => bulk({ snoozedUntil: until })} />}
        </div>
      ) : (
        <input
          className="nav-filter"
          type="search"
          placeholder="Filter threads"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          aria-label="Filter threads"
        />
      )}
      {projects.map((p) => {
        const isCollapsed = collapsed[p.root] && !filter.trim();
        const visible = p.panes.filter(({ id }) => shown(p, id));
        if (filter.trim() && visible.length === 0) return null;
        const active = visible.filter(({ id }) => !away(id)).sort((a, b) => rank(a.id) - rank(b.id));
        const settled = visible.filter(({ id }) => away(id));
        const needs = active.filter(({ id }) => sessions[id]?.status === "needs_input").length;
        const spare = leftovers[p.root] ?? [];
        const row = ({ id }: { id: string; tab: number }) => (
          <PaneRow key={id} paneId={id} focused={id === focusedId} projectBranch={p.branch} snoozed={snoozed(id)} selected={live.includes(id)} onSelect={select(id)} />
        );
        return (
          <div key={p.root} className="nav-project" role="treeitem" aria-expanded={!isCollapsed}>
            <button className="nav-project-head" title={p.root} onClick={() => setCollapsed({ ...collapsed, [p.root]: !collapsed[p.root] })}>
              <span className={`chev${isCollapsed ? "" : " open"}`} aria-hidden>
                ›
              </span>
              <span className="nav-project-name">{p.name}</span>
              {p.branch && <span className="nav-project-branch mono">{p.branch}</span>}
              {needs > 0 && <span className="nav-needs num">{needs}</span>}
            </button>
            {!isCollapsed && (
              <div role="group">
                {active.map(row)}
                {settled.length > 0 && (
                  <>
                    <button className="nav-settled-head" onClick={() => setShowSettled({ ...showSettled, [p.root]: !showSettled[p.root] })}>
                      <span className={`chev${showSettled[p.root] || filter.trim() ? " open" : ""}`} aria-hidden>
                        ›
                      </span>
                      {settled.some(({ id }) => snoozed(id)) ? "Settled and snoozed" : "Settled"} <span className="num">{settled.length}</span>
                    </button>
                    {(showSettled[p.root] || !!filter.trim()) && settled.map(row)}
                  </>
                )}
                {spare.length > 0 && !filter.trim() && (
                  <div className="nav-leftover" title={spare.map((w) => `${w.branch}${w.dirty ? " (uncommitted changes)" : ""}`).join("\n")}>
                    <span>
                      {spare.length} unused {spare.length === 1 ? "worktree" : "worktrees"}
                    </span>
                    <button
                      className="nav-act"
                      title="Remove the ones without uncommitted changes"
                      onClick={async () => {
                        const clean = spare.filter((w) => !w.dirty);
                        for (const w of clean) await ipc.removeWorktree(w.path).catch((e) => toast(String(e), true));
                        const kept = spare.length - clean.length;
                        toast(`Removed ${clean.length} ${clean.length === 1 ? "worktree" : "worktrees"}${kept ? `; kept ${kept} with uncommitted changes` : ""}.`);
                        setRemoved(removed + 1);
                      }}
                    >
                      Clean up
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
