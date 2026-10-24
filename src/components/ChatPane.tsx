import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { answerApproval, branchChat, chatPicks, rewindChat, ensureChat, refreshContext, interruptChat, restartChat, sendChat, setChatMode, setChatOptions, useChat, type Approval } from "../lib/chat";
import type { ChatItem, Segment } from "../lib/chatModel";
import { fileStats, latestTodos, segments, toolSummary, turnEdits } from "../lib/chatModel";
import { isLocalUrl, openInBrowserPane } from "../lib/browser";
import { basename, formatCost, formatDuration, formatTokens } from "../lib/format";
import { appendText, drafts, registerComposer } from "../lib/chatComposer";
import { ipc, type ChatImage, type CliModel, type RuleFile, type RuleKind, type SlashCommand } from "../lib/ipc";
import { renderMarkdown } from "../lib/markdown";
import { openFile } from "../lib/openFile";
import { cyclePermissionMode, MODES, modeKey } from "../lib/permissionMode";
import { riskOf } from "../lib/risk";
import { CHAT_FIND } from "../lib/shortcuts";
import { focusedPaneId, useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { useConfig } from "../store/config";
import { AgentLogo } from "./AgentLogos";
import { ArrowUpIcon, AureliaMark, CheckIcon, ChevronIcon, FileIcon, GaugeIcon, PenIcon, PlusIcon, ShieldIcon, SparkIcon, StopIcon, TerminalIcon } from "./Icons";

const MAX_ROWS = 12;
/** Tool output shown when a call is opened; the rest stays in the transcript. */
const RESULT_MAX = 6000;

type Work = Extract<Segment, { kind: "work" }>;
type Tool = Extract<ChatItem, { kind: "tool" }>;

/**
 * A Claude Code conversation drawn natively (no terminal), in one centred column: your
 * messages as bubbles, Claude's work folded under "Worked for…" with its answer below,
 * the files a turn changed as a card, and a composer card with model and effort. State
 * lives in lib/chat.ts; the grouping in lib/chatModel.ts (segments).
 */
export function ChatPane({ paneId }: { paneId: string }) {
  const session = useChat((s) => s.byPane[paneId]);
  const cwd = useLayout((s) => s.panes[paneId]?.cwd);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const pane = useLayout.getState().panes[paneId];
    if (pane) ensureChat(pane);
  }, [paneId]);

  const items = session?.transcript.items ?? [];
  const segs = useMemo(() => segments(items), [items]);
  // A message you send brings the view back down to it.
  const sentCount = items.filter((i) => i.kind === "user").length;
  useLayoutEffect(() => {
    stick.current = true;
  }, [sentCount]);
  const toBottom = () => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  };
  // Scrolling the browser does by itself (scroll anchoring as messages get their real
  // height, a hidden tab) isn't the user leaving: only their wheel, keys or scrollbar drag is.
  const userScroll = useRef(false);
  const userTimer = useRef(0);
  const byUser = () => {
    userScroll.current = true;
    clearTimeout(userTimer.current);
    userTimer.current = window.setTimeout(() => (userScroll.current = false), 250);
  };
  // Follow new output while the user is at the bottom; leave them be when they scrolled up.
  useLayoutEffect(toBottom, [items, session?.approvals]);
  // Messages off screen get their real height late (content-visibility), so growth is followed too.
  useEffect(() => {
    const el = logRef.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const ro = new ResizeObserver(toBottom);
    ro.observe(col);
    // A chat restored in a hidden tab has no size until it's shown.
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const status = session?.status ?? "starting";
  const busy = status === "working" || status === "waiting";
  const last = segs.at(-1);
  // Working, but nothing has come back for the latest message yet.
  const waitingFirst = busy && last?.kind === "user";

  // Bumped by each ⌘F, so pressing it again refocuses the open bar; 0 is closed.
  const [finding, setFinding] = useState(0);
  useEffect(() => {
    const open = (e: Event) => (e as CustomEvent<string>).detail === paneId && setFinding((n) => n + 1);
    window.addEventListener(CHAT_FIND, open);
    return () => window.removeEventListener(CHAT_FIND, open);
  }, [paneId]);

  return (
    <div
      className="chat"
      tabIndex={-1}
      style={{ outline: "none" }}
      onKeyDown={(e) => {
        // Shift+Tab cycles the permission mode from anywhere in the pane that isn't a control (the composer has its own handler).
        if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest("button, input, textarea, select, a, [role=dialog]")) {
          e.preventDefault();
          void cyclePermissionMode(paneId);
        }
      }}
    >
      {finding > 0 && <FindBar logRef={logRef} items={items} focusKey={finding} onClose={() => setFinding(0)} />}
      <div
        className="chat-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true;
          else if (userScroll.current) stick.current = false;
        }}
        onWheel={byUser}
        onKeyDown={byUser}
        // Dragging the scrollbar: held until the button comes up.
        onPointerDown={() => (userScroll.current = true)}
        onPointerUp={byUser}
        onClick={(e) => openLink(e, paneId)}
      >
        <div className="chat-col">
          {items.length === 0 && (
            <div className="chat-empty">
              <AureliaMark width={34} height={34} />
              <p>{status === "starting" ? "Starting Claude…" : `What should Claude do in ${basename(cwd) || "this folder"}?`}</p>
            </div>
          )}
          {segs.map((seg) =>
            seg.kind === "user" ? (
              <UserMessage key={seg.item.id} item={seg.item} paneId={paneId} idle={status === "idle"} changedLater={changedFrom(segs, seg)} />
            ) : seg.kind === "notice" ? (
              <div key={seg.item.id} className={`chat-notice${seg.item.error ? " error" : ""}`}>
                {seg.item.text}
              </div>
            ) : (
              <WorkBlock key={seg.id} seg={seg} live={busy && seg === last && !seg.end} waiting={status === "waiting"} cwd={cwd} paneId={paneId} />
            ),
          )}
          {waitingFirst && <LiveStatus label="Thinking" since={last.item.at} />}
        </div>
      </div>
      <div className="chat-dock">
        <TodoPanel items={items} busy={busy} />
        {session?.approvals[0] &&
          (session.approvals[0].tool === "AskUserQuestion" ? (
            <QuestionBar key={session.approvals[0].id} paneId={paneId} approval={session.approvals[0]} />
          ) : (
            <ApprovalBar key={session.approvals[0].id} paneId={paneId} approval={session.approvals[0]} more={session.approvals.length - 1} cwd={cwd} />
          ))}
        {!!session?.queued.length && (
          <ol className="chat-queue" aria-label="Queued messages">
            {session.queued.map((q, i) => (
              <li key={q.uuid}>
                <span className="chat-queue-n num">{i === 0 ? "Next" : i + 1}</span>
                <span className="chat-queue-text" title={q.text}>
                  {q.text || (q.images && q.images.length > 1 ? `${q.images.length} images` : "Image")}
                </span>
              </li>
            ))}
          </ol>
        )}
        {status === "exited" ? (
          <div className="chat-stopped">
            <button type="button" className="primary" onClick={() => restartChat(paneId)}>
              Continue this chat
            </button>
            <button type="button" onClick={() => restartChat(paneId, true)}>
              New chat
            </button>
          </div>
        ) : (
          <ChatComposer paneId={paneId} busy={busy} />
        )}
      </div>
    </div>
  );
}

/**
 * ⌘F in a chat: matches in what's on screen (messages, answers, open tool calls), marked
 * with the CSS Highlight API so the conversation's DOM is never rewritten.
 */
function FindBar({ logRef, items, focusKey, onClose }: { logRef: React.RefObject<HTMLDivElement | null>; items: ChatItem[]; focusKey: number; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [ranges, setRanges] = useState<Range[]>([]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);
  // Searched again as the conversation grows.
  useEffect(() => {
    const root = logRef.current;
    const q = query.toLowerCase();
    if (!root || !q) return setRanges([]);
    const found: Range[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n && found.length < 1000; n = walk.nextNode()) {
      const text = n.nodeValue?.toLowerCase() ?? "";
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        found.push(r);
      }
    }
    setRanges(found);
  }, [query, items, logRef]);
  useEffect(() => setAt(0), [query]);

  const current = ranges.length ? Math.min(at, ranges.length - 1) : -1;
  useEffect(() => {
    const hl = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null;
    if (!hl) return;
    hl.set("chat-find", new Highlight(...ranges.filter((_, i) => i !== current)));
    if (current >= 0) hl.set("chat-find-current", new Highlight(ranges[current]));
    else hl.delete("chat-find-current");
    const log = logRef.current;
    if (log && current >= 0) {
      const box = ranges[current].getBoundingClientRect();
      const view = log.getBoundingClientRect();
      if (box.top < view.top + 40 || box.bottom > view.bottom - 40) log.scrollTop += box.top - view.top - view.height / 3;
    }
  }, [ranges, current, logRef]);
  useEffect(
    () => () => {
      CSS.highlights?.delete("chat-find");
      CSS.highlights?.delete("chat-find-current");
    },
    [],
  );

  const step = (d: number) => ranges.length && setAt((current + d + ranges.length) % ranges.length);
  return (
    <div className="chat-find" role="search">
      <input
        ref={input}
        value={query}
        placeholder="Find in chat"
        aria-label="Find in chat"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="chat-find-count num">{query ? (ranges.length ? `${current + 1} of ${ranges.length}` : "No matches") : ""}</span>
      <button type="button" onClick={() => step(-1)} disabled={!ranges.length} title="Previous (Shift+Enter)" aria-label="Previous match">
        <ChevronIcon className="chat-find-up" />
      </button>
      <button type="button" onClick={() => step(1)} disabled={!ranges.length} title="Next (Enter)" aria-label="Next match">
        <ChevronIcon className="chat-find-down" />
      </button>
      <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close find">
        ×
      </button>
    </div>
  );
}

/**
 * Claude's todo list (its latest TodoWrite), pinned above the composer while there's
 * something left to do. Folds to one line.
 */
function TodoPanel({ items, busy }: { items: ChatItem[]; busy: boolean }) {
  const todos = useMemo(() => latestTodos(items), [items]);
  const [open, setOpen] = useState(true);
  if (!todos?.length) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  if (done === todos.length && !busy) return null;
  const now = todos.find((t) => t.status === "in_progress");
  return (
    <div className="chat-todos">
      <button type="button" className={`chat-todos-head${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronIcon className="chat-chev" />
        <span>Plan</span>
        <span className="chat-todos-count num">
          {done} of {todos.length} done
        </span>
        {!open && now && <span className="chat-todos-now">{now.activeForm ?? now.content}</span>}
      </button>
      {open && (
        <ol className="chat-todos-list">
          {todos.map((t, i) => (
            <li key={i} className={t.status}>
              <span className="chat-todo-box" aria-hidden>
                {t.status === "completed" && <CheckIcon />}
              </span>
              <span>{t.status === "in_progress" ? (t.activeForm ?? t.content) : t.content}</span>
              <span className="sr-only">{t.status === "completed" ? " (done)" : t.status === "in_progress" ? " (in progress)" : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Whether any turn from this message on changed files (so editing it offers to undo them). */
function changedFrom(segs: Segment[], from: Segment): boolean {
  const i = segs.indexOf(from);
  return segs.slice(i).some((s) => s.kind === "work" && Object.keys(fileStats(s.activity)).length > 0);
}

/**
 * One of your messages. Hover offers Edit and Retry: the chat continues from a copy of the
 * conversation cut just before it (lib/chat.ts branchChat), optionally undoing file changes.
 */
function UserMessage({ item, paneId, idle, changedLater }: { item: Extract<ChatItem, { kind: "user" }>; paneId: string; idle: boolean; changedLater: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [undoFiles, setUndoFiles] = useState(true);
  const canBranch = idle && !!item.uuid && !!item.text;
  const go = (text: string) => {
    if (!item.uuid || !text.trim()) return;
    setEditing(false);
    void branchChat(paneId, item.uuid, text.trim(), changedLater && undoFiles);
  };
  if (editing)
    return (
      <div className="chat-user editing">
        <textarea
          autoFocus
          value={draft}
          rows={Math.min(10, draft.split("\n").length + 1)}
          aria-label="Edit message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              go(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
        <div className="chat-user-edit-bar">
          {changedLater && (
            <label>
              <input type="checkbox" checked={undoFiles} onChange={(e) => setUndoFiles(e.target.checked)} />
              Undo file changes from here
            </label>
          )}
          <span className="chat-card-gap" />
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!draft.trim()} onClick={() => go(draft)}>
            Send
          </button>
        </div>
      </div>
    );
  return (
    <div className="chat-user-wrap">
      <div className="chat-user">
        {item.images && (
          <div className="chat-user-images">
            {item.images.map((src, i) => (
              <img key={i} src={src} alt={`Attached image ${i + 1}`} />
            ))}
          </div>
        )}
        {item.text}
      </div>
      {canBranch && (
        <div className="chat-user-tools">
          <button
            type="button"
            title="Edit this message and continue from here; later messages are left out"
            onClick={() => {
              setDraft(item.text);
              setUndoFiles(true);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button type="button" title={changedLater ? "Ask again from here, undoing file changes since" : "Ask again from here"} onClick={() => go(item.text)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/** Links in replies: web pages in the browser, everything else (file paths) in the editor. */
/** Copies text and flashes "Copied" on the button that asked. */
function copyText(btn: HTMLElement, text: string) {
  void navigator.clipboard.writeText(text).then(() => {
    const was = btn.textContent;
    btn.textContent = "Copied";
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = was;
      btn.classList.remove("done");
    }, 1200);
  });
}

function openLink(e: React.MouseEvent, paneId: string) {
  const copy = (e.target as HTMLElement).closest<HTMLElement>(".chat-copy");
  if (copy) {
    const code = copy.closest(".chat-code")?.querySelector("code")?.textContent;
    if (code != null) copyText(copy, code);
    return;
  }
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (/^https?:\/\//.test(href)) {
    if (isLocalUrl(href) && !e.altKey) openInBrowserPane(paneId, href);
    else ipc.openUrl(href).catch(() => {});
  } else if (href && !/^[a-z]+:/i.test(href)) {
    openFile(href, undefined, undefined, { fromPane: paneId });
  }
}

/** "8s", "2m 10s": whole seconds, as a person would say it. */
function took(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : formatDuration(s * 1000);
}

/** Seconds since `since`, ticking while mounted. */
function useElapsed(since?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return since ? Math.max(0, now - since) : undefined;
}

function LiveStatus({ label, since }: { label: string; since?: number }) {
  const ms = useElapsed(since);
  return (
    <div className="chat-live" role="status">
      <span className="chat-live-text">{label}</span>
      {ms !== undefined && ms >= 1000 && <span className="num"> · {took(ms)}</span>}
    </div>
  );
}

/** What Claude is doing right now, from the newest thing in the turn. */
function liveLabel(seg: Work, waiting: boolean): string {
  if (waiting) return "Waiting for you";
  const latest = seg.answer.at(-1) ?? seg.activity.at(-1);
  if (!latest) return "Thinking";
  if (latest.kind === "tool" && latest.result === undefined) {
    // An agent at work: say what it's doing now.
    const now = latest.sub?.at(-1);
    if (now) return `Agent: ${TOOL_VERB[now.name] ?? `using ${now.name}`}`;
    return `${TOOL_VERB[latest.name] ?? `Using ${latest.name}`}`;
  }
  if (latest.kind === "text" && !latest.done) return "Writing";
  if (latest.kind === "thinking" && !latest.done) return "Thinking";
  return "Working";
}

const TOOL_VERB: Record<string, string> = {
  Bash: "Running a command",
  Edit: "Editing",
  MultiEdit: "Editing",
  Write: "Writing a file",
  NotebookEdit: "Editing a notebook",
  Read: "Reading",
  Grep: "Searching",
  Glob: "Finding files",
  WebFetch: "Reading the web",
  WebSearch: "Searching the web",
  Task: "Running an agent",
  Agent: "Running an agent",
};

/** Kinds of work a run of tool calls did, for its one-line summary. */
const TOOL_KIND: Record<string, string> = {
  Bash: "Commands",
  Edit: "Edits",
  MultiEdit: "Edits",
  Write: "Edits",
  NotebookEdit: "Edits",
  Read: "Reads",
  Grep: "Searches",
  Glob: "Searches",
  WebFetch: "Web",
  WebSearch: "Web",
  Task: "Agents",
  Agent: "Agents",
  TodoWrite: "Plan",
};

/**
 * Claude's work for one message. While it runs: what it's doing, its tool calls grouped
 * and folded, and the answer as it streams. Once done the work folds under one line.
 */
const WorkBlock = memo(function WorkBlock({ seg, live, waiting, cwd, paneId }: { seg: Work; live: boolean; waiting: boolean; cwd?: string; paneId: string }) {
  const [open, setOpen] = useState(false);
  const ms = seg.end?.ms ?? (seg.startAt && seg.lastAt && seg.lastAt > seg.startAt ? seg.lastAt - seg.startAt : undefined);
  const steps = seg.activity.filter((i) => i.kind === "tool").length;
  const stats = useMemo(() => fileStats(seg.activity), [seg.activity]);
  const files = live ? [] : Object.keys(stats);
  return (
    <section className="chat-work">
      {live ? (
        <LiveStatus label={liveLabel(seg, waiting)} since={seg.startAt} />
      ) : (
        seg.activity.length > 0 && (
          <button type="button" className={`chat-worked${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {ms ? `Worked for ${took(ms)}` : steps ? `Worked through ${steps} ${steps === 1 ? "step" : "steps"}` : "Thought it over"}
            <ChevronIcon className="chat-chev" />
          </button>
        )
      )}
      {(live || open) && seg.activity.length > 0 && <Activity items={seg.activity} cwd={cwd} />}
      {seg.answer.map((a) => (
        <Markdown key={a.id} text={a.text} streaming={!a.done} />
      ))}
      {!live && seg.answer.length > 0 && (
        <div className="chat-answer-tools">
          <button type="button" className="chat-answer-copy" title="Copy this answer as Markdown" onClick={(e) => copyText(e.currentTarget, seg.answer.map((a) => a.text).join("\n\n"))}>
            Copy
          </button>
        </div>
      )}
      {seg.end?.outcome === "interrupted" && <div className="chat-outcome">Stopped</div>}
      {seg.end?.outcome === "failed" && <div className="chat-outcome error">{seg.end.error || "Failed"}</div>}
      {files.length > 0 && <FilesCard files={files} stats={stats} cwd={cwd} paneId={paneId} usage={seg.end?.usage} activity={seg.activity} from={seg.from} />}
    </section>
  );
});

/** A turn's activity in order: tool calls run together into one folded line, notes between them dimmed. */
function Activity({ items, cwd }: { items: ChatItem[]; cwd?: string }) {
  const groups: (ChatItem | Tool[])[] = [];
  for (const i of items) {
    const prev = groups.at(-1);
    if (i.kind === "tool" && Array.isArray(prev)) prev.push(i);
    else groups.push(i.kind === "tool" ? [i] : i);
  }
  return (
    <div className="chat-activity">
      {groups.map((g) =>
        Array.isArray(g) ? (
          <ToolGroup key={g[0].id} tools={g} cwd={cwd} />
        ) : g.kind === "text" ? (
          <div key={g.id} className="chat-aside">
            <Markdown text={g.text} streaming={!g.done} />
          </div>
        ) : g.kind === "thinking" && g.text.trim() ? (
          <details key={g.id} className="chat-thinking">
            <summary>Thought</summary>
            <div className="chat-thinking-text">{g.text}</div>
          </details>
        ) : null,
      )}
    </div>
  );
}

function ToolGroup({ tools, cwd }: { tools: Tool[]; cwd?: string }) {
  const [open, setOpen] = useState(false);
  const running = tools.find((t) => t.result === undefined);
  const failed = tools.filter((t) => t.isError).length;
  const kinds = [...new Set(tools.map((t) => TOOL_KIND[t.name] ?? t.name))].join(", ");
  const one = tools.length === 1 ? tools[0] : running;
  return (
    <div className={`chat-tools${running ? " running" : ""}`}>
      <button type="button" className={`chat-tools-line${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <TerminalIcon className="chat-tools-glyph" />
        {one ? (
          <>
            <span className="chat-tools-name">{one.name}</span>
            <span className="chat-tools-sum">{toolSummary(one.name, one.input, cwd)}</span>
            {tools.length > 1 && <span className="chat-tools-kinds num">· {tools.length} tools</span>}
          </>
        ) : (
          <>
            <span className="chat-tools-name num">{tools.length} tools</span>
            <span className="chat-tools-kinds">· {kinds}</span>
          </>
        )}
        {failed > 0 && <span className="chat-tools-failed num">{failed} failed</span>}
        <ChevronIcon className="chat-chev" />
      </button>
      {open && (
        <div className="chat-tools-list">
          {tools.map((t) => (
            <ToolLine key={t.id} item={t} cwd={cwd} />
          ))}
        </div>
      )}
    </div>
  );
}

function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`chat-md${streaming ? " streaming" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function ToolLine({ item, cwd }: { item: Tool; cwd?: string }) {
  const [open, setOpen] = useState(false);
  const running = item.result === undefined;
  const summary = toolSummary(item.name, item.input, cwd);
  const state = running ? "running" : item.isError ? "error" : "ok";
  return (
    <div className={`chat-tool ${state}`}>
      <button type="button" className="chat-tool-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chat-tool-mark" aria-hidden />
        <span className="chat-tool-name">{item.name}</span>
        <span className="chat-tool-sum">{summary}</span>
        {item.steps > 0 && <span className="chat-tool-steps num">{item.steps} steps</span>}
      </button>
      {running && item.sub?.length ? (
        <div className="chat-tool-now" title="What the agent is doing now">
          {item.sub.at(-1)!.name} {toolSummary(item.sub.at(-1)!.name, item.sub.at(-1)!.input, cwd)}
        </div>
      ) : null}
      {open && (
        <div className="chat-tool-body">
          {item.sub && item.sub.length > 0 && (
            <ol className="chat-tool-sub" aria-label="The agent's steps">
              {item.sub.map((c, i) => (
                <li key={i}>
                  <span className="chat-tool-name">{c.name}</span> {toolSummary(c.name, c.input, cwd)}
                </li>
              ))}
            </ol>
          )}
          <pre className="chat-tool-input">{inputText(item.name, item.input, item.partial)}</pre>
          {item.result !== undefined && (
            <pre className={`chat-tool-result${item.isError ? " error" : ""}`}>
              {item.result.length > RESULT_MAX ? `${item.result.slice(0, RESULT_MAX)}\n… ${item.result.length - RESULT_MAX} more characters` : item.result || "(no output)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function inputText(name: string, input: Record<string, unknown>, partial: string) {
  if (!Object.keys(input).length) return partial;
  if (name === "Bash" && typeof input.command === "string") return input.command;
  return JSON.stringify(input, null, 2);
}

/** The files a turn changed, lines added and removed per file (from Claude's edits), and the way into the diff. */
function FilesCard({
  files,
  stats,
  cwd,
  paneId,
  usage,
  activity,
  from,
}: {
  files: string[];
  stats: Record<string, { added: number; removed: number }>;
  cwd?: string;
  paneId: string;
  usage?: Extract<ChatItem, { kind: "turn" }>["usage"];
  activity: ChatItem[];
  /** The message this turn answers; Undo goes back to just before it. */
  from?: string;
}) {
  const [open, setOpen] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [undo, setUndo] = useState<{ step: "checking" | "working" } | { step: "confirm"; files: number } | { step: "error"; error: string } | null>(null);
  const status = useChat((s) => s.byPane[paneId]?.status);
  const idle = status === "idle";
  const startUndo = () => {
    if (!from) return;
    setUndo({ step: "checking" });
    rewindChat(paneId, from, true).then(
      (r) => setUndo({ step: "confirm", files: r.filesChanged?.length ?? files.length }),
      (e) => setUndo({ step: "error", error: String(e) }),
    );
  };
  const confirmUndo = () => {
    if (!from) return;
    setUndo({ step: "working" });
    rewindChat(paneId, from, false).then(
      () => setUndo(null),
      (e) => setUndo({ step: "error", error: String(e) }),
    );
  };
  const added = files.reduce((n, f) => n + (stats[f]?.added ?? 0), 0);
  const removed = files.reduce((n, f) => n + (stats[f]?.removed ?? 0), 0);
  const root = cwd?.replace(/\/+$/, "");
  const rel = (f: string) => (root && f.startsWith(`${root}/`) ? f.slice(root.length + 1) : f);
  const title = usage
    ? `This turn: ${formatTokens(usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens)} in · ${formatTokens(usage.outputTokens)} out · ${formatCost(usage.costUsd)}`
    : undefined;
  return (
    <div className="chat-files" title={title}>
      <div className="chat-files-head">
        <button type="button" className={`chat-files-toggle${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronIcon className="chat-chev" />
          <span>{files.length === 1 ? "1 changed file" : `${files.length} changed files`}</span>
          <Delta added={added} removed={removed} />
        </button>
        <button type="button" className="chat-files-diff" onClick={() => setReviewing(true)}>
          Review
        </button>
        {from && (
          <button
            type="button"
            className="chat-files-diff"
            disabled={!idle || (undo !== null && undo.step !== "error")}
            title={idle ? "Put these files back as they were before this message" : "Undo works once Claude has finished"}
            onClick={startUndo}
          >
            {undo?.step === "checking" ? "Checking…" : "Undo"}
          </button>
        )}
      </div>
      {undo?.step === "confirm" || undo?.step === "working" ? (
        <div className="chat-files-undo">
          <span>
            Put back {undo.step === "confirm" ? (undo.files === 1 ? "1 file" : `${undo.files} files`) : "the files"} as they were before this message? Changes from later messages are undone too. The conversation stays.
          </span>
          <button type="button" className="danger" disabled={undo.step === "working"} onClick={confirmUndo}>
            Undo changes
          </button>
          <button type="button" disabled={undo.step === "working"} onClick={() => setUndo(null)}>
            Cancel
          </button>
        </div>
      ) : (
        undo?.step === "error" && (
          <div className="chat-files-undo error">
            <span>Couldn't undo: {undo.error}</span>
            <button type="button" onClick={() => setUndo(null)}>
              OK
            </button>
          </div>
        )
      )}
      {reviewing && <TurnReview activity={activity} rel={rel} paneId={paneId} onClose={() => setReviewing(false)} />}
      {open && (
        <ul className="chat-files-list">
          {files.map((f) => {
            const r = rel(f);
            const cut = r.lastIndexOf("/");
            return (
              <li key={f}>
                <button type="button" onClick={() => openFile(f, undefined, undefined, { fromPane: paneId })} title={f}>
                  <FileIcon className="chat-files-icon" />
                  <span className="chat-files-path">
                    {cut > 0 && <span className="chat-files-dir">{r.slice(0, cut + 1)}</span>}
                    {r.slice(cut + 1)}
                  </span>
                </button>
                <Delta added={stats[f]?.added ?? 0} removed={stats[f]?.removed ?? 0} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** What one turn changed, file by file, from Claude's own edits; the whole project's diff is a click away. */
function TurnReview({ activity, rel, paneId, onClose }: { activity: ChatItem[]; rel: (f: string) => string; paneId: string; onClose: () => void }) {
  const edits = useMemo(() => Object.entries(turnEdits(activity)), [activity]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal chat-review" role="dialog" aria-label="Changes in this turn" tabIndex={-1} ref={(el) => el?.focus()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-head">
          <h2>Changes in this turn</h2>
        </div>
        <div className="chat-review-body">
          {edits.map(([file, hunks]) => (
            <section key={file}>
              <h3>
                <button type="button" onClick={() => openFile(file, undefined, undefined, { fromPane: paneId })} title={`Open ${file}`}>
                  {rel(file)}
                </button>
              </h3>
              {hunks.length === 0 && <p className="chat-review-none">Changed by a tool that doesn't show its edit.</p>}
              {hunks.map((h, i) => (
                <pre key={i} className="chat-review-hunk">
                  {h.removed.map((l, j) => (
                    <div key={`-${j}`} className="del">
                      {l || " "}
                    </div>
                  ))}
                  {h.added.map((l, j) => (
                    <div key={`+${j}`} className="add">
                      {l || " "}
                    </div>
                  ))}
                </pre>
              ))}
            </section>
          ))}
        </div>
        <div className="modal-foot">
          <span className="msg">From Claude's edits in this turn. Shell commands' changes aren't listed.</span>
          <button
            type="button"
            onClick={() => {
              onClose();
              useLayout.getState().focusPane(paneId);
              useUi.getState().set({ reviewOpen: true });
            }}
          >
            Whole project diff
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Delta({ added, removed }: { added: number; removed: number }) {
  if (!added && !removed) return null;
  return (
    <span className="chat-delta num">
      {added > 0 && <span className="add">+{added}</span>}
      {removed > 0 && <span className="del">−{removed}</span>}
    </span>
  );
}

function ApprovalBar({ paneId, approval, more, cwd }: { paneId: string; approval: Approval; more: number; cwd?: string }) {
  const risk = riskOf(approval.tool, approval.input as never, cwd);
  const summary = toolSummary(approval.tool, approval.input, cwd);
  const plan = approval.tool === "ExitPlanMode" && typeof approval.input.plan === "string" ? approval.input.plan : null;
  if (plan) {
    return (
      <div className="chat-approval" role="alertdialog" aria-label="Claude's plan">
        <div className="chat-approval-what">
          <span className="chat-approval-tool">Plan</span>
          <span className="chat-approval-why">Claude wants to start on this</span>
        </div>
        <div className="chat-approval-plan">
          <Markdown text={plan} streaming={false} />
        </div>
        <div className="chat-approval-actions">
          <button
            type="button"
            className="primary"
            onClick={() => answerApproval(paneId, approval.id, true, false, undefined, { permissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] })}
            title="Start, and accept file edits without asking (commands still ask)"
            autoFocus
          >
            Start, accept edits
          </button>
          <button type="button" onClick={() => answerApproval(paneId, approval.id, true)} title="Start, and ask before each edit">
            Start, ask first
          </button>
          <DenyWithReason paneId={paneId} id={approval.id} label="Keep planning" placeholder="What should change in the plan?" />
        </div>
      </div>
    );
  }
  return (
    <div className="chat-approval" role="alertdialog" aria-label={`Claude wants to use ${approval.tool}`}>
      <div className="chat-approval-what">
        <span className="chat-approval-tool">{approval.tool}</span>
        <code className="chat-approval-sum" title={summary}>
          {summary || approval.description}
        </code>
        {risk && (
          <span className={`risk-tag ${risk.level}`} title={risk.why}>
            {risk.level}
          </span>
        )}
        {more > 0 && <span className="chat-approval-more num">+{more}</span>}
      </div>
      {approval.description && summary && !approval.description.endsWith(summary) && <div className="chat-approval-why">{approval.description}</div>}
      <div className="chat-approval-actions">
        <button type="button" className="primary" onClick={() => answerApproval(paneId, approval.id, true)} autoFocus>
          Allow
        </button>
        <button type="button" onClick={() => answerApproval(paneId, approval.id, true, true)} title="Allow, and don't ask again for this kind of call">
          Always
        </button>
        <DenyWithReason paneId={paneId} id={approval.id} label="Deny" placeholder="Or tell Claude what to do instead" />
      </div>
    </div>
  );
}

/** Deny, with an optional note for Claude: typed and Enter, or typed and the button. Like the CLI's "No, and tell Claude what to do differently". */
function DenyWithReason({ paneId, id, label, placeholder }: { paneId: string; id: string; label: string; placeholder: string }) {
  const [why, setWhy] = useState("");
  const deny = () => answerApproval(paneId, id, false, false, undefined, { message: why.trim() || undefined });
  return (
    <>
      <button type="button" onClick={deny}>
        {label}
      </button>
      <input
        className="chat-approval-reason"
        placeholder={placeholder}
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && why.trim()) {
            e.preventDefault();
            deny();
          }
        }}
      />
    </>
  );
}

/**
 * AskUserQuestion: Claude's questions with their options as buttons, answered in one go.
 * The answers go back as the tool's input (`answers`: question → label, several joined by ", ").
 */
function QuestionBar({ paneId, approval }: { paneId: string; approval: Approval }) {
  const questions = (Array.isArray(approval.input.questions) ? approval.input.questions : []) as {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options?: { label: string; description?: string }[];
  }[];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const answerOf = (q: string) => [...(picked[q] ?? []), ...(other[q]?.trim() ? [other[q].trim()] : [])].join(", ");
  const ready = questions.every((q) => answerOf(q.question));
  const submit = () => {
    const answers = Object.fromEntries(questions.map((q) => [q.question, answerOf(q.question)]));
    answerApproval(paneId, approval.id, true, false, { ...approval.input, answers });
  };
  const toggle = (q: string, label: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[q] ?? [];
      return { ...p, [q]: multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
    });

  return (
    <div className="chat-approval chat-questions" role="dialog" aria-label="Claude has a question">
      {questions.map((q) => (
        <div key={q.question} className="chat-question">
          <div className="chat-question-text">
            {q.question}
            {q.multiSelect && <span className="chat-approval-more"> · pick any</span>}
          </div>
          <div className="chat-question-opts">
            {(q.options ?? []).map((o) => (
              <button
                key={o.label}
                type="button"
                className={(picked[q.question] ?? []).includes(o.label) ? "on" : ""}
                aria-pressed={(picked[q.question] ?? []).includes(o.label)}
                title={o.description}
                onClick={() => {
                  toggle(q.question, o.label, !!q.multiSelect);
                  if (!q.multiSelect) setOther((x) => ({ ...x, [q.question]: "" }));
                }}
              >
                {o.label}
              </button>
            ))}
            <input
              placeholder="Other…"
              value={other[q.question] ?? ""}
              onChange={(e) => {
                setOther((x) => ({ ...x, [q.question]: e.target.value }));
                if (!q.multiSelect) setPicked((p) => ({ ...p, [q.question]: [] }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) submit();
              }}
            />
          </div>
        </div>
      ))}
      <div className="chat-approval-actions">
        <button type="button" className="primary" disabled={!ready} onClick={submit}>
          Answer
        </button>
        <button type="button" onClick={() => answerApproval(paneId, approval.id, false)} title="Don't answer; Claude carries on without it">
          Skip
        </button>
      </div>
    </div>
  );
}

const CLAUDE = <AgentLogo logo="claude" size={14} />;

const MODELS: Option[] = [
  { value: "auto", label: "Auto", desc: "Picks Haiku, Sonnet or Opus for the task", icon: <SparkIcon className="chat-auto-icon" /> },
  { value: "default", label: "Default", desc: "What your Claude Code settings pick", icon: CLAUDE },
  { value: "opus", label: "Opus", desc: "Most capable, for hard problems", icon: CLAUDE },
  { value: "sonnet", label: "Sonnet", desc: "Fast and capable, for most work", icon: CLAUDE },
  { value: "haiku", label: "Haiku", desc: "Fastest, for quick jobs", icon: CLAUDE },
];

const EFFORTS: Option[] = [
  { value: "auto", label: "Auto", desc: "Picks the effort for each message", icon: <SparkIcon className="chat-auto-icon" /> },
  { value: "default", label: "Default", desc: "What your Claude Code settings pick", icon: <GaugeIcon level={0} /> },
  { value: "low", label: "Low", desc: "Quick answers, little thinking", icon: <GaugeIcon level={1} /> },
  { value: "medium", label: "Medium", desc: "Some thinking", icon: <GaugeIcon level={2} /> },
  { value: "high", label: "High", desc: "Thinks things through", icon: <GaugeIcon level={3} /> },
  { value: "xhigh", label: "Extra high", desc: "Thinks hard, takes longer", icon: <GaugeIcon level={4} /> },
  { value: "max", label: "Max", desc: "Everything it has", icon: <GaugeIcon level={5} /> },
];

/** Claude Code's permission modes, in its Shift+Tab order; Bypass last and marked. */
const PERMISSIONS: Option[] = (["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const).map((k) => ({
  value: k,
  label: MODES[k].label,
  desc: MODES[k].what,
  tone: MODES[k].tone,
  icon: <ShieldIcon className={`chat-mode-icon ${MODES[k].tone ?? ""}`} />,
}));

/** "claude-opus-5-5" → "Opus 5.5". */
/** The CLI's own model list (so new models show up by themselves), after Auto; MODELS until it answers. */
function modelOptions(models?: CliModel[]): Option[] {
  if (!models?.length) return MODELS;
  return [
    MODELS[0],
    ...models.map((m) => ({
      value: m.value,
      label: m.value === "default" ? "Default" : m.displayName,
      desc: m.description ?? "",
      icon: CLAUDE,
    })),
  ];
}

const STYLE_DESC: Record<string, string> = {
  default: "Claude Code's usual answers",
  Concise: "Short answers, fewer tokens",
  Explanatory: "Explains its choices as it works",
  Learning: "Leaves small parts for you to write",
};

function styleOptions(styles: string[]): Option[] {
  return styles.map((st) => ({ value: st, label: st === "default" ? "Default" : st, desc: STYLE_DESC[st] ?? "Output style" }));
}

function modelName(id?: string): string | undefined {
  const m = id?.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:\b|$)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : undefined;
}

const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function ChatComposer({ paneId, busy }: { paneId: string; busy: boolean }) {
  const [text, setText] = useState(() => drafts.get(paneId)?.text ?? "");
  const [images, setImages] = useState<ChatImage[]>(() => drafts.get(paneId)?.images ?? []);
  useEffect(() => {
    if (text || images.length) drafts.set(paneId, { text, images });
    else drafts.delete(paneId);
  }, [paneId, text, images]);
  // ↑ in an empty composer (or on its first line) walks back through what you sent, like a shell.
  const items = useChat((s) => s.byPane[paneId]?.transcript.items);
  const sent = useMemo(() => (items ?? []).flatMap((i) => (i.kind === "user" && i.text ? [i.text] : [])), [items]);
  const [hist, setHist] = useState<{ at: number; draft: string } | null>(null);
  const recall = (dir: -1 | 1) => {
    const at = (hist?.at ?? sent.length) + dir;
    if (at < 0 || (dir < 0 && !sent.length)) return false;
    if (at >= sent.length) {
      if (!hist) return false;
      setText(hist.draft);
      setHist(null);
    } else {
      setText(sent[at]);
      setHist({ at, draft: hist?.draft ?? text });
    }
    return true;
  };
  const [rulesOpen, setRulesOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const addImages = (files: File[]) => {
    for (const f of files.filter((f) => f.type.startsWith("image/")))
      void readImage(f).then(
        (img) => setImages((cur) => (cur.length < MAX_IMAGES ? [...cur, img] : cur)),
        () => {},
      );
  };
  const ref = useRef<HTMLTextAreaElement>(null);
  const pane = useLayout((s) => s.panes[paneId]);
  useConfig((s) => s.config?.effort); // re-render when the auto defaults change
  const { model, effort } = chatPicks(pane);
  const running = useChat((s) => s.byPane[paneId]?.model);
  const mode = modeKey(useChat((s) => s.byPane[paneId]?.mode));
  const auto = useChat((s) => s.byPane[paneId]?.auto);
  const commands = useChat((s) => s.byPane[paneId]?.commands);
  const cliModels = useChat((s) => s.byPane[paneId]?.models);
  const models = useMemo(() => modelOptions(cliModels), [cliModels]);
  const styles = useChat((s) => s.byPane[paneId]?.styles);
  const startStyle = useChat((s) => s.byPane[paneId]?.style);
  const style = pane?.chatStyle ?? startStyle ?? "default";
  const [slashSel, setSlashSel] = useState(0);
  const [slashOff, setSlashOff] = useState<string | null>(null);
  // The / menu: open while the first word is a command being typed.
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  const slash = useMemo(() => (slashQuery === undefined || slashOff === text ? [] : matchCommands(commands ?? [], slashQuery)), [commands, slashQuery, slashOff, text]);
  useEffect(() => setSlashSel(0), [slashQuery]);
  // The @ menu: a file path being typed at the caret.
  const [caret, setCaret] = useState(0);
  const atQuery = slashQuery === undefined ? /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1] : undefined;
  const files = useProjectFiles(atQuery !== undefined ? pane?.cwd : undefined);
  const mentions = useMemo(() => (atQuery === undefined || slashOff === text ? [] : matchFiles(files, atQuery)), [files, atQuery, slashOff, text]);
  useEffect(() => setSlashSel(0), [atQuery]);
  const menuLen = slash.length || mentions.length;
  const mention = (path: string) => {
    const start = caret - (atQuery?.length ?? 0) - 1;
    const insert = `@${/\s/.test(path) ? `"${path}"` : path} `;
    const next = text.slice(0, start) + insert + text.slice(caret);
    setText(next);
    const at = start + insert.length;
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(at, at);
      setCaret(at);
    });
    ref.current?.focus();
  };
  const pick = (c: SlashCommand, run: boolean) => {
    if (run && !c.argumentHint) {
      setText("");
      sendChat(paneId, `/${c.name}`);
    } else setText(`/${c.name} `);
    ref.current?.focus();
  };

  // Dictation, dropped files, the files panel and review comments type in here (lib/chatComposer.ts).
  useEffect(
    () =>
      registerComposer(paneId, {
        insert: (t) => setText((cur) => appendText(cur, t)),
        focus: () => ref.current?.focus(),
      }),
    [paneId],
  );

  // Only the focused pane takes the keyboard (a restored layout may hold several chats).
  useEffect(() => {
    if (focusedPaneId() === paneId) ref.current?.focus();
  }, [paneId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 8)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t && !images.length) return;
    setText("");
    setImages([]);
    setHist(null);
    sendChat(paneId, t, images);
  };
  const empty = !text.trim() && !images.length;

  // The model the CLI runs, once it runs the picked family; the pick until then.
  const runningName = modelName(running);
  const familyRuns = (fam: string) => runningName?.toLowerCase().startsWith(fam);
  const modelLabel =
    model === "auto"
      ? `Auto${runningName ? ` · ${runningName}` : ""}`
      : model === "default"
        ? (runningName ?? "Default")
        : familyRuns(model)
          ? runningName!
          : (models.find((m) => m.value === model)?.label ?? model);
  const effortLabel =
    effort === "auto" ? `Auto${auto?.effort?.pick ? ` · ${cap(auto.effort.pick)}` : ""}` : effort === "default" ? "Effort" : (EFFORTS.find((e) => e.value === effort)?.label ?? effort);
  const level = EFFORTS.findIndex((e) => e.value === (effort === "auto" ? auto?.effort?.pick : effort)) - 1;
  const m = MODES[mode] ?? MODES.default;

  return (
    <div className="chat-compose">
      {rulesOpen && <RulesDialog cwd={pane?.cwd ?? "~"} account={pane?.account ?? null} onClose={() => setRulesOpen(false)} />}
      {mentions.length > 0 && <FileMenu items={mentions} sel={Math.min(slashSel, mentions.length - 1)} onHover={setSlashSel} onPick={mention} />}
      {slash.length > 0 && <SlashMenu items={slash} sel={Math.min(slashSel, slash.length - 1)} onHover={setSlashSel} onPick={(c) => pick(c, true)} />}
      <div
        className="chat-card"
        data-mode={mode}
        onKeyDown={(e) => {
          if (menuLen && e.target === ref.current && ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"].includes(e.key) && !e.shiftKey) {
            e.preventDefault();
            if (e.key === "ArrowDown") setSlashSel((i) => (i + 1) % menuLen);
            else if (e.key === "ArrowUp") setSlashSel((i) => (i + menuLen - 1) % menuLen);
            else if (e.key === "Escape") setSlashOff(text);
            else if (slash.length) pick(slash[Math.min(slashSel, slash.length - 1)], e.key === "Enter");
            else mention(mentions[Math.min(slashSel, mentions.length - 1)]);
          } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.metaKey && e.target === ref.current) {
            const el = ref.current!;
            const edge = e.key === "ArrowUp" ? !el.value.slice(0, el.selectionStart).includes("\n") : !el.value.slice(el.selectionEnd).includes("\n");
            if ((edge && (hist || !text)) && recall(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
          } else if (e.key === "." && e.metaKey && busy) {
            e.preventDefault();
            interruptChat(paneId);
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.target === ref.current) {
            e.preventDefault();
            send();
          } else if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.target === ref.current) {
            // Claude Code's own mode cycle.
            e.preventDefault();
            void cyclePermissionMode(paneId);
          } else if (e.key === "Escape" && busy && e.target === ref.current) {
            e.preventDefault();
            interruptChat(paneId);
          }
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            ref.current?.focus();
          }
        }}
      >
        {images.length > 0 && (
          <div className="chat-attach">
            {images.map((img, i) => (
              <span key={i} className="chat-thumb">
                <img src={`data:${img.mediaType};base64,${img.data}`} alt={`Pasted image ${i + 1}`} />
                <button type="button" aria-label="Remove image" title="Remove" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={2}
          value={text}
          data-chat-input={paneId}
          placeholder={busy ? "Claude is working. A message now goes after this turn" : "Describe a task, or / for commands"}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setHist(null);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (!files.length) return;
            e.preventDefault();
            addImages(files);
          }}
          spellCheck={false}
        />
        <div className="chat-card-bar">
          <button type="button" className="chat-pick chat-plus" title="Add images (or paste them, or drop files here)" aria-label="Add images" onClick={() => fileInput.current?.click()}>
            <PlusIcon />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addImages([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Picker
            label={m.label}
            title={`Permission mode: ${m.what} (Shift+Tab)`}
            value={mode}
            options={PERMISSIONS}
            onPick={(v) => void setChatMode(paneId, v)}
            icon={<ShieldIcon className={`chat-mode-icon ${m.tone ?? ""}`} />}
            tone={m.tone}
            more={{ label: "Saved rules…", onClick: () => setRulesOpen(true) }}
          />
          <Picker
            label={modelLabel}
            title={model === "auto" && auto?.model ? `Auto picked ${auto.model.pick}: ${auto.model.why}` : "Model for the next message"}
            value={model}
            options={models}
            onPick={(v) => setChatOptions(paneId, { model: v })}
            icon={model === "auto" ? <SparkIcon className="chat-auto-icon" /> : CLAUDE}
          />
          <Picker
            label={effortLabel}
            title={effort === "auto" && auto?.effort ? `Auto effort: ${auto.effort.why}` : "Effort for the next message: how hard Claude thinks"}
            value={effort}
            options={EFFORTS}
            onPick={(v) => setChatOptions(paneId, { effort: v })}
            icon={<GaugeIcon level={Math.max(0, level)} />}
          />
          {styles && styles.length > 1 && (
            <Picker
              label={style === "default" ? "" : style}
              title="Output style: how Claude writes its answers"
              value={style}
              options={styleOptions(styles)}
              onPick={(v) => setChatOptions(paneId, { style: v })}
              icon={<PenIcon />}
            />
          )}
          <span className="chat-card-gap" />
          <ContextRing paneId={paneId} />
          {busy && empty ? (
            <button type="button" className="chat-send stop" onClick={() => interruptChat(paneId)} title="Stop this turn (Esc or ⌘.)" aria-label="Stop">
              <StopIcon />
            </button>
          ) : (
            <button type="button" className="chat-send" onClick={send} disabled={empty} title={busy ? "Queue for after this turn (Enter)" : "Send (Enter)"} aria-label="Send">
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const SCOPES: Record<RuleFile["scope"], { title: string; desc: string }> = {
  local: { title: "This project, just you", desc: "What Always saved" },
  project: { title: "This project, shared", desc: "Checked in with the repo" },
  user: { title: "Every project", desc: "This account's settings" },
};
const KIND_LABEL: Record<RuleKind, string> = { allow: "Allow", ask: "Ask", deny: "Deny" };

/**
 * The permission rules Claude Code follows in this chat, like its /permissions: what Always
 * saved, the project's shared rules, the account's own. Removing one takes effect right away.
 */
function RulesDialog({ cwd, account, onClose }: { cwd: string; account: string | null; onClose: () => void }) {
  const [files, setFiles] = useState<RuleFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    ipc.permissionRules(cwd, account).then(
      (f) => setFiles(f),
      (e) => setError(String(e)),
    );
  useEffect(() => void load(), [cwd, account]);
  const remove = (f: RuleFile, kind: RuleKind, rule: string) =>
    ipc.removePermissionRule(cwd, account, f.path, kind, rule).then(load, (e) => setError(String(e)));
  const total = files?.reduce((n, f) => n + f.allow.length + f.ask.length + f.deny.length, 0) ?? 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal chat-rules" role="dialog" aria-label="Saved rules" tabIndex={-1} ref={(el) => el?.focus()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-head">
          <h2>Saved rules</h2>
          <span className="chat-rules-cwd" title={cwd}>
            {basename(cwd) || cwd}
          </span>
        </div>
        <div className="chat-rules-body">
          {error && <p className="chat-rules-error">{error}</p>}
          {files && total === 0 && <p className="chat-rules-empty">No saved rules yet. Choosing Always on a request saves one here.</p>}
          {files
            ?.filter((f) => f.allow.length + f.ask.length + f.deny.length > 0)
            .map((f) => (
              <section key={f.path}>
                <h3>
                  {SCOPES[f.scope].title}
                  <span title={f.path}>{SCOPES[f.scope].desc}</span>
                </h3>
                <ul>
                  {(["deny", "ask", "allow"] as const).flatMap((kind) =>
                    f[kind].map((rule) => (
                      <li key={`${kind}:${rule}`}>
                        <span className={`chat-rule-kind ${kind}`}>{KIND_LABEL[kind]}</span>
                        <code>{rule}</code>
                        <button type="button" onClick={() => void remove(f, kind, rule)} title="Remove this rule" aria-label={`Remove ${rule}`}>
                          Remove
                        </button>
                      </li>
                    )),
                  )}
                </ul>
              </section>
            ))}
        </div>
        <div className="modal-foot">
          <span className="msg">Claude Code picks up changes right away.</span>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_IMAGES = 10;
/** Claude's limit is 5 MB per image (base64); bigger ones are scaled down to fit. */
const IMAGE_MAX_BYTES = 3_500_000;
const IMAGE_MAX_SIDE = 2000;

async function readImage(file: File): Promise<ChatImage> {
  const supported = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
  if (supported && file.size <= IMAGE_MAX_BYTES) return { mediaType: file.type, data: await base64(file) };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("encode"))), "image/jpeg", 0.85));
  return { mediaType: "image/jpeg", data: await base64(blob) };
}

function base64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

/** A project's file list for the @ menu, fetched when first needed and kept for a minute. */
const fileCache = new Map<string, { at: number; files: Promise<string[]> }>();
function useProjectFiles(cwd: string | undefined): string[] {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!cwd) return;
    let hit = fileCache.get(cwd);
    if (!hit || Date.now() - hit.at > 60_000) {
      hit = { at: Date.now(), files: ipc.projectFiles(cwd).catch(() => []) };
      fileCache.set(cwd, hit);
    }
    let live = true;
    void hit.files.then((f) => live && setFiles(f));
    return () => {
      live = false;
    };
  }, [cwd]);
  return files;
}

/** Best first: file name starts with the query, then the name contains it, then the path, then its letters in order. */
function matchFiles(all: string[], q: string): string[] {
  const query = q.toLowerCase();
  if (!query) return all.slice(0, 40);
  const scored: [number, string][] = [];
  for (const f of all) {
    const path = f.toLowerCase();
    const name = path.slice(path.lastIndexOf("/") + 1);
    let score = name.startsWith(query) ? 0 : name.includes(query) ? 1 : path.includes(query) ? 2 : -1;
    if (score < 0) {
      let i = 0;
      for (const ch of path) if (ch === query[i]) i++;
      if (i < query.length) continue;
      score = 3;
    }
    scored.push([score * 1000 + path.length, f]);
  }
  return scored
    .sort((a, b) => a[0] - b[0])
    .slice(0, 40)
    .map(([, f]) => f);
}

function FileMenu({ items, sel, onHover, onPick }: { items: string[]; sel: number; onHover: (i: number) => void; onPick: (path: string) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return (
    <div className="chat-slash" role="listbox" aria-label="Files" ref={list}>
      {items.map((f, i) => {
        const cut = f.lastIndexOf("/");
        return (
          <button
            key={f}
            type="button"
            role="option"
            data-i={i}
            aria-selected={i === sel}
            className={i === sel ? "on" : ""}
            onMouseMove={() => i !== sel && onHover(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(f)}
          >
            <span className="chat-slash-name">{f.slice(cut + 1)}</span>
            <span className="chat-slash-desc">{cut > 0 ? f.slice(0, cut) : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Commands whose name starts with the query first, then ones that contain it. */
function matchCommands(all: SlashCommand[], q: string): SlashCommand[] {
  const query = q.toLowerCase();
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(query));
  const contains = query ? all.filter((c) => !c.name.toLowerCase().startsWith(query) && c.name.toLowerCase().includes(query)) : [];
  return [...starts, ...contains].slice(0, 60);
}

/** The / menu above the composer: Claude Code's commands and skills, ↑↓ to move, Enter runs, Tab fills in. */
function SlashMenu({ items, sel, onHover, onPick }: { items: SlashCommand[]; sel: number; onHover: (i: number) => void; onPick: (c: SlashCommand) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return (
    <div className="chat-slash" role="listbox" aria-label="Slash commands" ref={list}>
      {items.map((c, i) => (
        <button
          key={c.name}
          type="button"
          role="option"
          data-i={i}
          aria-selected={i === sel}
          className={i === sel ? "on" : ""}
          onMouseMove={() => i !== sel && onHover(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        >
          <span className="chat-slash-name">
            /{c.name}
            {c.argumentHint && <span className="chat-slash-arg"> {c.argumentHint}</span>}
          </span>
          <span className="chat-slash-desc">{c.description}</span>
        </button>
      ))}
    </div>
  );
}

interface Option {
  value: string;
  label: string;
  desc: string;
  icon?: React.ReactNode;
  tone?: "warn" | "danger";
}

/** A small menu above its button: one pick from a list, arrow keys to move, Esc to close. */
function Picker({
  label,
  title,
  value,
  options,
  onPick,
  icon,
  tone,
  more,
}: {
  label: string;
  title: string;
  value: string;
  options: Option[];
  onPick: (value: string) => void;
  icon: React.ReactNode;
  tone?: "warn" | "danger";
  /** A last row that opens something else, e.g. the saved rules. */
  more?: { label: string; onClick: () => void };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("mousedown", off);
    return () => removeEventListener("mousedown", off);
  }, [open]);
  const close = () => {
    setOpen(false);
    ref.current?.querySelector<HTMLButtonElement>(".chat-pick-btn")?.focus();
  };
  return (
    <div className="chat-pick" ref={ref}>
      <button
        type="button"
        className={`chat-pick-btn${open ? " on" : ""}${tone ? ` ${tone}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {label && <span>{label}</span>}
        <ChevronIcon className="chat-chev down" />
      </button>
      {open && (
        <div
          className="chat-pick-menu"
          role="listbox"
          aria-label={title}
          onKeyDown={(e) => {
            const opts = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option], .chat-pick-more")];
            const at = opts.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              opts[(at + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length]?.focus();
            }
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              className={o.tone}
              aria-selected={o.value === value}
              autoFocus={o.value === value}
              onClick={() => {
                onPick(o.value);
                close();
              }}
            >
              <span className="chat-pick-icon">{o.icon}</span>
              <span className="chat-pick-name">{o.label}</span>
              <span className="chat-pick-desc">{o.desc}</span>
              {o.value === value && <CheckIcon className="chat-pick-check" />}
            </button>
          ))}
          {more && (
            <button
              type="button"
              className="chat-pick-more"
              onClick={() => {
                setOpen(false);
                more.onClick();
              }}
            >
              {more.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Colours for Claude Code's context categories (by id); anything new gets the next spare one. */
const CTX_COLORS: Record<string, string> = {
  system_prompt: "#8d90a0",
  system_tools: "#6f86b8",
  mcp_tools: "#62c6de",
  custom_agents: "#b48ead",
  memory_files: "#79d29a",
  skills: "#f2b544",
  messages: "#d97757",
};
const CTX_SPARE = ["#e58fb4", "#9ccf6a", "#c9a46b", "#7fb7d9"];

/**
 * How full the context is, as a ring by the send button. Click it for what fills it, the
 * way Claude Code's `/context` counts: system prompt, tools, MCP, memory, skills, messages.
 */
function ContextRing({ paneId }: { paneId: string }) {
  const s = useChat((st) => st.byPane[paneId]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void refreshContext(paneId);
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", off);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", off);
      removeEventListener("keydown", esc);
    };
  }, [open, paneId]);

  const ctx = s?.context;
  const used = ctx?.totalTokens ?? s?.last?.contextTokens ?? 0;
  const size = ctx?.maxTokens ?? s?.last?.contextWindow ?? 0;
  const pct = used && size ? Math.min(100, Math.round((used / size) * 100)) : 0;
  const r = 7;
  const c = 2 * Math.PI * r;
  const label = size ? `Context: ${formatTokens(used)} of ${formatTokens(size)} (${pct}%)` : "Context";

  let spare = 0;
  const rows = (ctx?.categories ?? []).map((cat) => ({
    ...cat,
    color: cat.kind === "free" || cat.kind === "buffer" || cat.isDeferred ? undefined : (CTX_COLORS[cat.id ?? ""] ?? CTX_SPARE[spare++ % CTX_SPARE.length]),
  }));
  const share = (n: number) => (size ? (n / size) * 100 : 0);

  return (
    <div className="chat-ctx" ref={ref}>
      <button type="button" className={`chat-ctx-ring num${pct >= 80 ? " high" : ""}${open ? " on" : ""}`} title={`${label}. Click for what fills it`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r={r} className="track" />
          <circle cx="9" cy="9" r={r} className="fill" strokeDasharray={`${(pct / 100) * c} ${c}`} />
        </svg>
        {size ? `${pct}%` : null}
      </button>
      {open && (
        <div className="chat-ctx-menu" role="dialog" aria-label="Context window">
          <div className="chat-ctx-head">
            <span>Context window</span>
            <span className="num">{size ? `${formatTokens(used)} of ${formatTokens(size)} · ${pct}%` : "…"}</span>
          </div>
          {ctx ? (
            <>
              <div className="chat-ctx-bar" aria-hidden>
                {rows
                  .filter((r) => r.color)
                  .map((r) => (
                    <span key={r.name} style={{ width: `${share(r.tokens)}%`, background: r.color }} />
                  ))}
                {rows
                  .filter((r) => r.kind === "buffer")
                  .map((r) => (
                    <span key={r.name} className="buffer" style={{ width: `${share(r.tokens)}%`, marginLeft: "auto" }} />
                  ))}
              </div>
              <ul className="chat-ctx-list">
                {rows.map((r) => (
                  <li key={r.name} className={r.color ? "" : "faint"}>
                    <span className={`chat-ctx-dot ${r.kind ?? ""}`} style={r.color ? { background: r.color } : undefined} />
                    <span className="chat-ctx-name">
                      {r.name}
                      {r.isDeferred && <span className="chat-ctx-note"> · loaded when used</span>}
                    </span>
                    <span className="chat-ctx-tokens num">{formatTokens(r.tokens)}</span>
                    <span className="chat-ctx-pct num">{share(r.tokens) >= 0.1 ? `${share(r.tokens).toFixed(1)}%` : "<0.1%"}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="chat-ctx-foot">Asking Claude Code…</div>
          )}
        </div>
      )}
    </div>
  );
}
