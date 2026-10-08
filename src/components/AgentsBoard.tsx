import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNow } from "../lib/cache";
import { basename, formatCost, formatTokens, shortenPath } from "../lib/format";
import { answerPermission, permissionOptions } from "../lib/permissions";
import { showPane } from "../lib/terminals";
import { useAgents, type AgentSession } from "../store/agents";
import { useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { useMetrics } from "../store/metrics";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { useUi } from "../store/ui";
import { CacheBadge } from "./CacheBadge";
import { AgentChip, usePaneAgent } from "./AgentChip";
import { ArrowIcon, BranchIcon, GridIcon, SparkIcon } from "./Icons";
import { paneTail } from "./paneTail";
import { MetricsLine, PermissionButtons, ReplyBox, since } from "./SessionExtras";
import { StatusGlyph, stateLabel, visualOf, type Visual } from "./StatusGlyph";

/** A card on the board: a Claude session, or any other live terminal (Codex, Gemini, a shell). */
type Item = { paneId: string; tab: number; session?: AgentSession };

const LANES: { id: string; states: (Visual | "other")[]; title: string; empty?: string }[] = [
  { id: "needs", states: ["needs_input"], title: "Needs you" },
  { id: "done", states: ["done"], title: "Finished, unseen" },
  { id: "working", states: ["working", "starting"], title: "Working" },
  { id: "idle", states: ["idle"], title: "Idle" },
  { id: "other", states: ["other"], title: "Other terminals" },
];

const REPLY_HINT: Partial<Record<Visual, string>> = {
  needs_input: "Answer Claude…",
  done: "Follow up…",
  working: "Steer: queued until this turn ends…",
  idle: "New prompt…",
};

function laneOf(it: Item): Visual | "other" {
  return it.session ? visualOf(it.session) : "other";
}

function Tail({ paneId }: { paneId: string }) {
  useNow(); // shared 1 s ticker: re-read the screen
  const lines = paneTail(paneId);
  if (!lines.length) return null;
  return (
    <pre className="card-tail" aria-label="Latest output">
      {lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </pre>
  );
}

function Card({ it, selected, onSelect, replyRef }: { it: Item; selected: boolean; onSelect(): void; replyRef?: React.Ref<HTMLInputElement> }) {
  const s = it.session;
  const pane = useLayout((st) => st.panes[it.paneId]);
  const rt = useRuntime((st) => st.panes[it.paneId]);
  const dir = s?.cwd ?? pane?.cwd;
  const git = useGit((g) => (dir ? g.info[dir] : undefined));
  const task = useTasks((t) => {
    const attached = tasksForPane(t.projects, it.paneId);
    return (attached.find((x) => x.status === "doing") ?? attached[0])?.title;
  });
  const now = useNow();
  const custom = usePaneAgent(it.paneId);
  const v = s ? visualOf(s) : undefined;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const title = basename(dir) || "~";
  const who = s ? (s.account ?? "claude") : (pane?.agent?.split(":")[0] ?? (rt?.running?.split(/\s+/)[0] || "shell"));
  const detail = s
    ? v === "needs_input"
      ? s.message || "Waiting for you"
      : v === "working"
        ? s.tool
          ? `Running ${s.tool}`
          : "Thinking…"
        : v === "done"
          ? "Finished. Your turn."
          : v === "starting"
            ? "Starting Claude…"
            : "Idle at the prompt"
    : rt?.running
      ? `▸ ${rt.running}`
      : rt?.lastExit
        ? `Last command exited ${rt.lastExit}`
        : "At the prompt";

  return (
    <article
      ref={ref}
      className={`card ${v ?? "other"}${selected ? " selected" : ""}`}
      data-pane={it.paneId}
      aria-selected={selected}
      onMouseDown={onSelect}
      onDoubleClick={() => showPane(it.paneId)}
    >
      <header className="card-head">
        {v ? <StatusGlyph state={v} /> : <StatusGlyph state="shell" busy={!!rt?.running} />}
        <span className="card-title" title={shortenPath(dir)}>
          {title}
        </span>
        {custom ? <AgentChip agent={custom} title={`${custom.name} · ${who}`} /> : <span className="account-chip">{who}</span>}
        <span className="card-meta num">
          <span title="Tab">T{it.tab + 1}</span>
          {s && <span title="Since the last status change">{since(now - s.updatedAt)}</span>}
        </span>
        <button className="card-open" onClick={() => showPane(it.paneId)} title="Open pane (↵)" aria-label={`Open ${title}`}>
          <ArrowIcon width={12} height={12} />
        </button>
      </header>
      {(git || task) && (
        <div className="card-context">
          {git && (
            <span className="git-chip">
              <BranchIcon width={10} height={10} />
              {git.branch}
              {git.worktree && <span className="wt">wt</span>}
            </span>
          )}
          {task && <span className="card-task">◆ {task}</span>}
        </div>
      )}
      <p className={`card-detail${v ? ` ${v}` : ""}`}>
        {v && <span className={`state-text ${v}`}>{stateLabel[v]}</span>}
        <span className="card-detail-text">{detail}</span>
      </p>
      <Tail paneId={it.paneId} />
      {v === "needs_input" && <PermissionButtons paneId={it.paneId} keys={selected} />}
      {selected && v && v !== "starting" && <ReplyBox paneId={it.paneId} placeholder={REPLY_HINT[v]} inputRef={selected ? replyRef : undefined} />}
      {s && (
        <footer className="card-foot">
          <MetricsLine paneId={it.paneId} />
          <CacheBadge session={s} />
        </footer>
      )}
    </article>
  );
}

/** Fleet-wide spend, the one number the lanes don't already show. */
function Spend({ items }: { items: Item[] }) {
  const metrics = useMetrics((m) => m.byPane);
  let cost = 0;
  let tokens = 0;
  items.forEach((it) => {
    const m = metrics[it.paneId];
    if (m) {
      cost += m.costUsd;
      tokens += m.totalTokens;
    }
  });
  if (tokens === 0) return null;
  return (
    <span className="board-sub num" title="All sessions, input + output incl. cache; cost estimated at API prices">
      · {formatTokens(tokens)} tok · {formatCost(cost)}
    </span>
  );
}

/**
 * Agents mode (⇧⌘1): every live pane as a card in urgency lanes, each with its latest
 * output and the actions that unblock it, so a whole fleet can be steered from here.
 */
export function AgentsBoard() {
  const sessions = useAgents((s) => s.sessions);
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const [sel, setSel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const items: Item[] = tabs.flatMap((t, tab) =>
    paneIds(t.root)
      .filter((id) => panes[id] && !panes[id].launcher && !panes[id].browser)
      .map((paneId) => ({ paneId, tab, session: sessions[paneId] })),
  );
  const lanes = LANES.map((l) => ({
    ...l,
    items: items.filter((it) => l.states.includes(laneOf(it))).sort((a, b) => (a.session?.updatedAt ?? 0) - (b.session?.updatedAt ?? 0)),
  })).filter((l) => l.items.length);
  const order = lanes.flatMap((l) => l.items.map((it) => it.paneId));
  const current = sel && order.includes(sel) ? sel : order[0];

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !current) return;
    const i = order.indexOf(current);
    const s = sessions[current];
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "ArrowDown" || key === "ArrowRight" || key === "j" || key === "l") setSel(order[Math.min(order.length - 1, i + 1)]);
    else if (key === "ArrowUp" || key === "ArrowLeft" || key === "k" || key === "h") setSel(order[Math.max(0, i - 1)]);
    else if (key === "Home") setSel(order[0]);
    else if (key === "End") setSel(order[order.length - 1]);
    else if (key === "Enter" || key === "o") showPane(current);
    else if (key === "r" && s && s.status !== "starting") replyRef.current?.focus();
    else if ((key === "y" || key === "a" || key === "n") && s?.status === "needs_input" && permissionOptions(current))
      answerPermission(current, key === "y" ? "allow" : key === "a" ? "always" : "deny");
    else return;
    e.preventDefault();
  };

  return (
    <div className="board" ref={rootRef} tabIndex={-1} onKeyDown={onKey} aria-label="Agents board">
      <header className="board-head">
        <div className="board-title">
          <h1>Fleet</h1>
          <span className="board-sub">
            {items.length} pane{items.length === 1 ? "" : "s"} across {tabs.length} tab{tabs.length === 1 ? "" : "s"}
          </span>
          <Spend items={items} />
        </div>
        <div className="board-actions">
          <button className="btn" onClick={() => useUi.getState().set({ gridOpen: true })} title="New grid tab (⌘G)">
            <GridIcon width={12} height={12} /> Grid
          </button>
          <button className="btn primary" onClick={() => useUi.getState().set({ accountPicker: { target: "tab" } })} title="Launch agents (⇧⌘E)">
            <SparkIcon width={12} height={12} /> Launch agents
          </button>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="board-empty">
          <SparkIcon width={28} height={28} />
          <h2>Nothing running yet</h2>
          <p>Launch Claude, Codex or Gemini panes and they appear here, sorted by who needs you.</p>
          <button className="btn primary" onClick={() => useUi.getState().set({ accountPicker: { target: "tab" } })}>
            Launch agents <kbd>⇧⌘E</kbd>
          </button>
        </div>
      ) : (
        <div className="board-scroll">
          {lanes.map((l) => (
            <section key={l.id} className={`lane ${l.id}`} aria-label={l.title}>
              <h2 className="lane-head">
                <span>{l.title}</span>
                <span className="lane-count num">{l.items.length}</span>
              </h2>
              <div className="lane-grid">
                {l.items.map((it) => (
                  <Card key={it.paneId} it={it} selected={it.paneId === current} onSelect={() => setSel(it.paneId)} replyRef={replyRef} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <footer className="board-keys" aria-hidden>
        <span><kbd>↑</kbd><kbd>↓</kbd> select</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>Y</kbd><kbd>A</kbd><kbd>N</kbd> answer</span>
        <span><kbd>R</kbd> reply</span>
      </footer>
    </div>
  );
}
