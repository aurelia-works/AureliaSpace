import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useChat } from "../lib/chat";
import { basename } from "../lib/format";
import { closePaneSafely } from "../lib/openFile";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout, type PaneMeta } from "../store/layout";
import { usePrs } from "../store/prs";
import { useRuntime } from "../store/runtime";
import { ipc, type PrInfo, type WorktreeEntry } from "../lib/ipc";
import { matchesFilter, prAttention, snoozeChoices } from "../lib/threads";
import { toast, useUi } from "../store/ui";
import { useRemote } from "../lib/remote";
import { usePaneAgent } from "./AgentChip";
import { stateLabel, visualOf, type Visual } from "./StatusGlyph";
import { FolderIcon, GearIcon, GlobeIcon, JellyIcon, LogIcon, PhoneIcon, PlusIcon, PrIcon, SearchIcon, TerminalIcon } from "./Icons";


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
export function useChatTitle(paneId: string) {
  return useChat((s) => {
    const first = s.byPane[paneId]?.transcript.items.find((i) => i.kind === "user");
    return first?.kind === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 80) : undefined;
  });
}

function PrBadge({ pr, attention, onOpen }: { pr: PrInfo; attention: string | null; onOpen: () => void }) {
  const tone = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.conflicts || pr.checks === "fail" || attention ? "bad" : pr.checks === "pass" ? "ok" : "";
  const what =
    pr.state !== "OPEN"
      ? pr.state.toLowerCase()
      : [pr.draft && "draft", pr.checks !== "none" && `checks ${pr.checks}`, pr.conflicts && "conflicts", pr.review && pr.review.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(", ");
  return (
    <span
      role="link"
      className={`prb num ${tone}${attention ? " attn" : ""}`}
      title={`PR #${pr.number}: ${pr.title}${what ? `\n${what}` : ""}${attention ? `\nNeeds you: ${attention}` : ""}\nClick to open on GitHub`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
        void ipc.openUrl(pr.url);
      }}
    >
      <PrIcon width={12} height={12} />#{pr.number}
    </span>
  );
}

/** "now", "12m", "3h", "2d": how long since the thread last did something. */
function ago(at: number | undefined, now: number) {
  if (!at) return "";
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function Lead({ v, pane, running }: { v: Visual | undefined; pane: PaneMeta | undefined; running: boolean }) {
  if (v === "needs_input") return <span className="dot-needs" aria-label="needs you" />;
  if (v) return <JellyIcon className={v === "working" || v === "starting" ? "working" : v === "done" ? "done" : "idle"} aria-label={stateLabel[v]} />;
  if (pane?.browser) return <GlobeIcon className="th-ico" />;
  return <TerminalIcon className={`th-ico${running ? " busy" : ""}`} />;
}

function PaneRow({ paneId, focused, snoozed, selected, now, onSelect }: { paneId: string; focused: boolean; snoozed: boolean; selected: boolean; now: number; onSelect: (e: MouseEvent) => boolean }) {
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
  const kind = pane?.browser ? "Browser" : pane?.editor ? (pane.editor.path.split("/").pop() ?? "Editor") : pane?.launcher ? "New thread" : custom ? custom.name : isClaude ? (account ?? "Claude") : (running?.split(/\s+/)[0] ?? "Terminal");
  const label = title ?? kind;
  const dir = paneDir(paneId);
  const repo = basename(git?.repo ?? dir) || "~";
  const attention = prAttention(pr, pane?.prSeenFeedback);
  const status = agent ? (agent.status === "working" && agent.tool ? agent.tool : stateLabel[visualOf(agent)]) : running && !isClaude ? "running" : "";
  const when = snoozed && pane?.snoozedUntil ? `until ${clock(pane.snoozedUntil)}` : v === "working" ? "now" : ago(agent?.updatedAt, now);
  const update = useLayout.getState().updatePane;
  const away = pane?.settled || snoozed;

  return (
    <div className={`nav-thread${focused ? " on" : ""}${away ? " away" : ""}${selected ? " selected" : ""}`}>
      <button
        className={`th-row${v ? ` ${v}` : ""}`}
        onClick={(e) => onSelect(e) || showPane(paneId)}
        title={[label !== kind ? `${kind}: ${label}` : label, status, dir, "⌘-click to select several"].filter(Boolean).join("\n")}
        aria-current={focused ? "true" : undefined}
        aria-selected={selected}
      >
        <span className="th-t">
          <Lead v={v} pane={pane} running={!!running} />
          <span className="th-title">{label}</span>
          {pane?.babysit && (
            <span className="th-babysit" title={`Babysitting its PR: woken ${pane.babysitWakes ?? 0} times (turn it off in Details)`}>
              ◉
            </span>
          )}
        </span>
        <span className="th-m">
          <span className="th-repo">{repo}</span>
          {git && (
            <>
              <i>·</i>
              <span className="th-br">{git.branch}</span>
            </>
          )}
          {pr && <PrBadge pr={pr} attention={attention} onOpen={() => update(paneId, { prSeenFeedback: pr.feedback })} />}
          {when && <time>{when}</time>}
        </span>
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
            <button className="nav-act" title="Close this thread for good (Settle only files it away)" onClick={() => closePaneSafely(paneId)}>
              Close
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

/** Shown while a phone is connected to the remote (Settings → Remote): it can read and reply to threads. */
function PhoneStatus() {
  const clients = useRemote((s) => s.clients);
  if (!clients) return null;
  const label = clients === 1 ? "Phone connected" : `${clients} phones connected`;
  return (
    <button className="side-remote" title={`${label}: it can read and reply to threads (Settings → Remote)`} onClick={() => useUi.getState().set({ settingsOpen: true, settingsSection: "remote" })}>
      <i />
      <PhoneIcon width={13} height={13} />
      {label}
    </button>
  );
}

type Group = { key: "needs" | "work" | "recent"; label: string; ids: string[] };

/** Every open pane as a thread, grouped by what it needs: you, time, or nothing. Snoozed and settled ones fold away below. */
export function ProjectsSidebar() {
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const activeTabId = useLayout((s) => s.activeTabId);
  const sessions = useAgents((s) => s.sessions);
  const git = useGit((s) => s.info);
  const prs = usePrs((s) => s.byDir);
  const chats = useChat((s) => s.byPane);
  const [away, setAway] = useState<"snoozed" | "settled" | null>(null);
  const [finding, setFinding] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState(false);
  const [removed, setRemoved] = useState(0);
  // Snoozes end and ages tick on the clock, so re-check once a minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const snoozed = (id: string) => (panes[id]?.snoozedUntil ?? 0) > now && sessions[id]?.status !== "needs_input";

  const focusedId = tabs.find((t) => t.id === activeTabId)?.focusedPaneId;
  const all = tabs.flatMap((t) => paneIds(t.root));
  const dirOf = (id: string) => sessions[id]?.cwd ?? panes[id]?.cwd ?? "";
  const repos = [...new Set(all.map((id) => git[dirOf(id)]?.repo).filter(Boolean) as string[])];
  const leftovers = useLeftovers(repos, panes, removed);
  const spare = Object.values(leftovers).flat();

  const shown = (id: string) => {
    if (!filter.trim()) return true;
    const first = chats[id]?.transcript.items.find((i) => i.kind === "user");
    const d = dirOf(id);
    const g = git[d];
    return matchesFilter(filter, [basename(g?.repo ?? d), first?.kind === "user" ? first.text : undefined, panes[id]?.account, d, g?.branch, prs[d] ? `#${prs[d]!.number} ${prs[d]!.title}` : undefined]);
  };
  const visible = all.filter(shown);
  const snoozedIds = visible.filter((id) => snoozed(id) && !panes[id]?.settled);
  const settledIds = visible.filter((id) => panes[id]?.settled);
  const active = visible.filter((id) => !snoozed(id) && !panes[id]?.settled);
  const st = (id: string) => (sessions[id] ? visualOf(sessions[id]) : undefined);
  const groups: Group[] = [
    { key: "needs", label: "Needs you", ids: active.filter((id) => st(id) === "needs_input") },
    { key: "work", label: "Working", ids: active.filter((id) => st(id) === "working" || st(id) === "starting" || (!sessions[id] && (panes[id]?.account || panes[id]?.mode === "chat"))) },
    { key: "recent", label: "Recent", ids: [] },
  ];
  const grouped = new Set(groups.flatMap((g) => g.ids));
  groups[2].ids = active.filter((id) => !grouped.has(id)).sort((a, b) => (sessions[b]?.updatedAt ?? 0) - (sessions[a]?.updatedAt ?? 0));

  const live = [...selected].filter((id) => panes[id]);
  const select = (id: string) => (e: MouseEvent) => {
    if (!e.metaKey && !e.shiftKey && live.length === 0) return false;
    const next = new Set(live);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    return true;
  };
  const bulk = (patch: Partial<PaneMeta>) => {
    for (const id of live) useLayout.getState().updatePane(id, patch);
    setSelected(new Set());
    setBulkMenu(false);
  };
  const bulkCleanUp = async () => {
    const roots = new Set(live.map((id) => git[dirOf(id)]).filter((g) => g?.worktree).map((g) => g!.root));
    setSelected(new Set());
    for (const r of roots) await cleanUpWorktree(r);
  };
  const row = (id: string) => <PaneRow key={id} paneId={id} focused={id === focusedId} snoozed={snoozed(id)} selected={live.includes(id)} now={now} onSelect={select(id)} />;
  const set = useUi.getState().set;

  return (
    <div className="side">
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
            {live.some((id) => git[dirOf(id)]?.worktree) && (
              <button className="nav-act" title="Close these threads and remove their worktrees (skips any with uncommitted changes)" onClick={() => void bulkCleanUp()}>
                Clean up
              </button>
            )}
            <button
              className="nav-act"
              title="Close these threads for good"
              onClick={() => {
                for (const id of live) closePaneSafely(id);
                setSelected(new Set());
              }}
            >
              Close
            </button>
            <button className="nav-act" title="Clear the selection" onClick={() => setSelected(new Set())}>
              ✕
            </button>
          </span>
          {bulkMenu && <SnoozeMenu onClose={() => setBulkMenu(false)} onPick={(until) => bulk({ snoozedUntil: until })} />}
        </div>
      ) : (
        <div className="side-top">
          <button className="newt" onClick={() => useLayout.getState().newTab({ launcher: true })}>
            <PlusIcon />
            New thread
            <kbd>⌘N</kbd>
          </button>
          <button
            className={`find${finding ? " on" : ""}`}
            aria-label="Filter threads"
            title="Filter threads"
            aria-pressed={finding}
            onClick={() => {
              setFinding(!finding);
              setFilter("");
            }}
          >
            <SearchIcon />
          </button>
        </div>
      )}
      {finding && (
        <input
          className="nav-filter"
          type="search"
          autoFocus
          placeholder="Filter by title, repo, branch or PR"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFilter("");
              setFinding(false);
            }
          }}
          aria-label="Filter threads"
        />
      )}
      <div className="side-list" role="tree" aria-label="Threads">
        {groups.map(
          (g) =>
            g.ids.length > 0 && (
              <section key={g.key} className={`grp ${g.key}`}>
                <h3>
                  {g.label}
                  <span className="n num">{g.ids.length}</span>
                </h3>
                {g.ids.map(row)}
              </section>
            ),
        )}
        {(away === "snoozed" || filter.trim()) && snoozedIds.length > 0 && (
          <section className="grp">
            <h3>
              Snoozed<span className="n num">{snoozedIds.length}</span>
            </h3>
            {snoozedIds.map(row)}
          </section>
        )}
        {(away === "settled" || filter.trim()) && settledIds.length > 0 && (
          <section className="grp">
            <h3>
              Settled<span className="n num">{settledIds.length}</span>
            </h3>
            {settledIds.map(row)}
          </section>
        )}
        {visible.length === 0 && <p className="side-empty">{filter.trim() ? "No thread matches." : "No threads yet. Start one with ⌘N."}</p>}
      </div>
      <div className="side-foot">
        <button className={`bk${away === "snoozed" ? " on" : ""}`} onClick={() => setAway(away === "snoozed" ? null : "snoozed")} aria-pressed={away === "snoozed"}>
          Snoozed<span className="num">{snoozedIds.length}</span>
        </button>
        <button className={`bk${away === "settled" ? " on" : ""}`} onClick={() => setAway(away === "settled" ? null : "settled")} aria-pressed={away === "settled"}>
          Settled<span className="num">{settledIds.length}</span>
        </button>
        {spare.length > 0 && (
          <div className="bk leftover" title={spare.map((w) => `${w.branch}${w.dirty ? " (uncommitted changes)" : ""}`).join("\n")}>
            {spare.length} unused {spare.length === 1 ? "worktree" : "worktrees"}
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
        <div className="foot">
          <button className="ib" aria-label="Settings" title="Settings (⌘,)" onClick={() => set({ settingsOpen: true })}>
            <GearIcon />
          </button>
          <button className="ib" aria-label="Command palette" title="Go to a thread or action (⌘P)" onClick={() => set({ paletteOpen: true })}>
            <span className="kbd">⌘P</span>
          </button>
          <button className="ib" aria-label="Project files" title="Files, search and problems (⇧⌘F)" onClick={() => set({ nav: "files" })}>
            <FolderIcon />
          </button>
          <button className="ib" aria-label="Conversation log" title="The focused thread's conversation as a log (⌥⌘T)" onClick={() => set({ nav: "thread" })}>
            <LogIcon />
          </button>
          <PhoneStatus />
        </div>
      </div>
    </div>
  );
}
