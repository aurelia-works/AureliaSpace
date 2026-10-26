import { accountForFolder } from "../lib/handoff";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { basename, expandPath, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { launchTeam, prepareCustomAgent, variantOf } from "../lib/agents";
import { queueFirstMessage } from "../lib/chat";
import { shellQuote, startDir } from "../lib/launch";
import { prAttention } from "../lib/threads";
import { queueInit, showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { usePrs } from "../store/prs";
import { useConfig } from "../store/config";
import { useCustomAgents, type CustomAgent } from "../store/customAgents";
import { useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { useUi } from "../store/ui";
import { AgentAvatar } from "./AgentChip";
import { AgentLogo } from "./AgentLogos";
import { ArrowIcon, ArrowUpIcon, ChevronDownIcon, CloseIcon, FolderIcon, PrIcon, SparkIcon, TerminalIcon } from "./Icons";
import { useChatTitle } from "./ProjectsSidebar";
import { repoBadge } from "./ThreadHeader";

/** Which optional CLIs are installed; resolved once per session. */
let toolsCache: Promise<Record<string, boolean>> | undefined;
function detectTools() {
  toolsCache ??= Promise.all(
    ["codex", "gemini"].map((cmd) => invoke<boolean>("which", { cmd }).catch(() => false).then((ok) => [cmd, ok] as const)),
  ).then(Object.fromEntries);
  return toolsCache;
}

interface Choice {
  key: string;
  label: string;
  hint: string;
  /** AgentLogo key; "terminal" and "more" use built-in icons, "agent" the saved agent's avatar. */
  logo: string;
  agent?: CustomAgent;
  /** `alt` (⌥) opens the other kind: a terminal when Claude opens as chat, a chat when it doesn't. */
  run(alt?: boolean): void;
}

/** Shown in a new empty tab: pick what to run here. The PTY is only created after a choice. */
export function StartScreen({ paneId }: { paneId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cwd = useLayout((s) => s.panes[paneId]?.cwd);
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const recents = useRecents((s) => s.folders);
  const customAgents = useCustomAgents((s) => s.agents);
  const teams = useCustomAgents((s) => s.teams);
  const workspace = useConfig((s) => s.config?.defaultWorkspace);
  const [tools, setTools] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [picked, setAccount] = useState<string>();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const worktree = useUi((s) => s.useWorktree);

  useEffect(() => {
    let alive = true;
    detectTools().then((t) => alive && setTools(t));
    promptRef.current?.focus();
    return () => {
      alive = false;
    };
  }, []);

  const folder = cwd || workspace || "~";
  const preferred = accountForFolder(cwd || workspace);
  const account = picked ?? preferred ?? accounts[0]?.name;
  const git = useGit((s) => s.info[expandPath(folder)] ?? s.info[folder]);
  const { updatePane } = useLayout.getState();
  const asChat = useUi((s) => s.claudeAsChat);
  const openClaude = (account: string | undefined, alt?: boolean) =>
    updatePane(paneId, { account, launcher: undefined, ...(asChat !== !!alt && { mode: "chat" as const }) });
  const start = (patch: { account?: string }, command?: string) => {
    if (command) queueInit(paneId, command);
    updatePane(paneId, { ...patch, launcher: undefined });
  };

  const startCustom = async (agent: CustomAgent) => {
    const plan = await prepareCustomAgent(agent, cwd || workspace);
    if (!plan) return;
    if (plan.command) queueInit(paneId, plan.command);
    updatePane(paneId, { ...plan.opts, launcher: undefined });
  };

  const choices: Choice[] = [
    // Saved agents first: they're the ones you set up on purpose.
    ...customAgents.map((a) => ({
      key: `agent-${a.id}`,
      label: a.name,
      hint: variantOf(a)?.label ?? "missing CLI",
      logo: "agent",
      agent: a,
      run: () => void startCustom(a),
    })),
    ...teams.map((t) => ({
      key: `team-${t.id}`,
      label: t.name,
      hint: `team · ${t.agentIds.length} panes in a new tab`,
      logo: "more",
      run: () => void launchTeam(t),
    })),
    // The folder's preferred account (workspace override, else the default) comes first.
    ...[...accounts].sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred)).map((a) => ({
      key: `acct-${a.name}`,
      label: `Claude · ${a.name}${a.name === preferred ? " (default)" : ""}`,
      hint: `${asChat ? "chat" : "terminal"} · ${shortenPath(a.configDir)}`,
      logo: "claude",
      run: (alt?: boolean) => openClaude(a.name, alt),
    })),
    { key: "terminal", label: "Terminal", hint: "plain zsh with command blocks", logo: "terminal", run: () => start({}) },
    ...(tools.codex ? [{ key: "codex", label: "Codex", hint: "codex", logo: "codex", run: () => start({}, "codex") }] : []),
    ...(tools.gemini ? [{ key: "gemini", label: "Gemini CLI", hint: "gemini", logo: "gemini", run: () => start({}, "gemini") }] : []),
    {
      key: "more",
      label: "More agents…",
      hint: "several CLIs at once, worktrees, API keys",
      logo: "more",
      run: () => useUi.getState().set({ accountPicker: { target: "tab" } }),
    },
  ];
  const quickOpen = recents.filter((r) => r !== folder).slice(0, 5);

  const browseFolder = async () => {
    const picked = await ipc.pickFolder(folder).catch(() => null);
    if (picked) updatePane(paneId, { cwd: picked });
    promptRef.current?.focus();
  };

  const applyFolder = () => {
    const p = expandPath(draft);
    if (p) updatePane(paneId, { cwd: p });
    setEditing(false);
    promptRef.current?.focus();
  };

  /** The composer: a Claude chat (⌥: a terminal) on this prompt, in a fresh worktree when asked. */
  const begin = async (alt?: boolean) => {
    const text = prompt.trim();
    if (!text) return;
    const dir = await startDir(expandPath(folder), worktree && !!git, text.slice(0, 40));
    const chat = asChat !== !!alt;
    if (chat) queueFirstMessage(paneId, text);
    else queueInit(paneId, `claude ${shellQuote(text)}`);
    updatePane(paneId, { account, cwd: dir, launcher: undefined, ...(chat && { mode: "chat" as const }) });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) return;
    if (e.target instanceof HTMLTextAreaElement) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (prompt.trim()) void begin(e.altKey);
        else openClaude(account, e.altKey);
      }
      return;
    }
    if (e.key === "Escape" && picking) return setPicking(false);
    if (e.target instanceof HTMLInputElement) {
      if (e.key === "Escape") {
        setEditing(false);
        promptRef.current?.focus();
        e.preventDefault();
      }
      return;
    }
    // Option turns a digit into another character, so the key code says which number it was.
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (e.key === "Enter") openClaude(account, e.altKey);
    else if (digit && choices[Number(digit) - 1]) choices[Number(digit) - 1].run(e.altKey);
    else return;
    e.preventDefault();
  };

  return (
    <div className="start-screen" tabIndex={-1} ref={rootRef} onKeyDown={onKey}>
      <Bloom />
      <div className="start-inner">
        <h2 className="hello">
          What should we build <em>{timeWord(new Date())}</em>?
        </h2>
        <div className="where">
          in
          {editing ? (
            <input
              className="start-input"
              autoFocus
              spellCheck={false}
              placeholder="~/path/to/project"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFolder()}
              onBlur={() => setEditing(false)}
              aria-label="Folder path"
            />
          ) : (
            <span className="pick-wrap">
              <button className="pick" title={`${shortenPath(folder)}\nClick to pick another project`} onClick={() => setPicking(!picking)} aria-expanded={picking}>
                <span className="mono-badge">{repoBadge(basename(folder) || "~")}</span>
                {basename(folder) || "~"}
                <ChevronDownIcon width={12} height={12} />
              </button>
              {picking && (
                <div className="pick-menu" role="menu" onMouseDown={(e) => e.preventDefault()}>
                  {quickOpen.map((r) => (
                    <div key={r} className="recent-row" role="none">
                      <button role="menuitem" className="recent-open" onClick={() => { updatePane(paneId, { cwd: r }); setPicking(false); }} title={`Start in ${r}`}>
                        <span className="recent-name">{basename(r)}</span>
                        <span className="recent-path">{shortenPath(r)}</span>
                      </button>
                      <button className="icon-btn sm recent-del" onClick={() => useRecents.getState().remove(r)} title="Remove from recents" aria-label="Remove from recents">
                        <CloseIcon width={10} height={10} />
                      </button>
                    </div>
                  ))}
                  <button role="menuitem" className="pick-act" onClick={() => { setPicking(false); void browseFolder(); }}>
                    <FolderIcon width={12} height={12} />
                    Choose folder…
                  </button>
                  <button role="menuitem" className="pick-act" onClick={() => { setPicking(false); setDraft(shortenPath(cwd || workspace || "")); setEditing(true); }}>
                    Type a path…
                  </button>
                </div>
              )}
            </span>
          )}
          {git ? (
            <>
              {worktree ? "on a fresh worktree from" : "on"} <span className="mono br">{git.branch}</span>
            </>
          ) : (
            <span className="mono br">{shortenPath(folder)}</span>
          )}
        </div>
        <div className="chat-card start-card" onClick={() => promptRef.current?.focus()}>
          <label className="sr-only" htmlFor={`start-${paneId}`}>
            Message
          </label>
          <textarea
            id={`start-${paneId}`}
            ref={promptRef}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the change. Enter starts a Claude chat; ⌥Enter a terminal"
          />
          <div className="chat-card-bar">
            {accounts.length > 0 && (
              <label className="opt" title="The Claude account this thread runs as">
                <AgentLogo logo="claude" size={14} />
                <select value={account ?? ""} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
                  {accounts.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon width={12} height={12} className="cv" />
              </label>
            )}
            {git && (
              <button className="opt tog" aria-pressed={worktree} title="Give this thread its own git worktree" onClick={() => useUi.getState().set({ useWorktree: !worktree })}>
                <span className="sw" />
                New worktree
              </button>
            )}
            <span className="chat-card-gap" />
            <button className="chat-send" aria-label="Start" title="Start a chat (Enter)" disabled={!prompt.trim()} onClick={() => void begin()}>
              <ArrowUpIcon width={16} height={16} />
            </button>
          </div>
        </div>
        <div className="start-others">
          <span>Or open</span>
          {choices.map((c, i) => (
            <button key={c.key} className={`start-chip ${c.logo}`} onClick={(e) => c.run(e.altKey)} title={`${c.hint}${i < 9 ? ` (${i + 1})` : ""}`}>
              <span className="start-logo">
                {c.agent ? <AgentAvatar agent={c.agent} size={12} /> : c.logo === "terminal" ? <TerminalIcon width={13} height={13} /> : c.logo === "more" ? <SparkIcon width={13} height={13} /> : <AgentLogo logo={c.logo} size={13} />}
              </span>
              {c.label}
            </button>
          ))}
        </div>
        <Resume />
      </div>
    </div>
  );
}

/** The headline's one serif word, by the hour. */
function timeWord(d: Date) {
  const h = d.getHours();
  return h < 5 ? "tonight" : h < 12 ? "this morning" : h < 18 ? "this afternoon" : "tonight";
}

const waited = (at: number | undefined) => {
  const m = at ? Math.floor((Date.now() - at) / 60_000) : 0;
  return m < 1 ? "just now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
};

/** Threads waiting on you and PRs with something new, newest first: one click back in. */
function Resume() {
  const sessions = useAgents((s) => s.sessions);
  const panes = useLayout((s) => s.panes);
  const prs = usePrs((s) => s.byDir);
  const needs = Object.keys(panes).filter((id) => sessions[id]?.status === "needs_input");
  const prRows = Object.keys(panes)
    .filter((id) => !needs.includes(id) && !panes[id].settled)
    .map((id) => {
      const d = paneDir(id);
      const pr = d ? prs[d] : undefined;
      return { id, pr, why: prAttention(pr, panes[id].prSeenFeedback) };
    })
    .filter((r) => r.pr && r.why);
  if (!needs.length && !prRows.length) return null;
  return (
    <div className="resume">
      <h2>Pick up where you left off</h2>
      {needs.slice(0, 4).map((id) => (
        <ResumeRow key={id} paneId={id} lead={<span className="dot-needs" />} gold go="Open" sub={`Waiting on you for ${waited(sessions[id]?.updatedAt)}. ${sessions[id]?.message ?? ""}`} />
      ))}
      {prRows.slice(0, 3).map((r) => (
        <ResumeRow key={r.id} paneId={r.id} lead={<PrIcon className="bad" />} go="Review" title={`PR #${r.pr!.number} · ${r.pr!.title}`} sub={`Needs you: ${r.why}.${panes[r.id].babysit ? "" : " Babysit is off."}`} />
      ))}
    </div>
  );
}

function ResumeRow({ paneId, lead, gold, go, sub, title }: { paneId: string; lead: React.ReactNode; gold?: boolean; go: string; sub: string; title?: string }) {
  const chatTitle = useChatTitle(paneId);
  const dir = useLayout((s) => s.panes[paneId]?.cwd);
  return (
    <button className="rz" onClick={() => showPane(paneId)}>
      <span className={`ico${gold ? " gold" : ""}`}>{lead}</span>
      <span className="what">
        <b>{title ?? chatTitle ?? basename(dir) ?? "Thread"}</b>
        <span>{sub}</span>
      </span>
      <span className="go">
        {go}
        <ArrowIcon width={13} height={13} />
      </span>
    </button>
  );
}

/** One faint jellyfish per live thread drifting through the black: gold waits for you and holds still, blue works and rises. */
function Bloom() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let W = 0;
    let H = 0;
    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const pulseAt = (ph: number) => (ph < 0.3 ? 1 - Math.pow(1 - ph / 0.3, 3) : Math.pow(1 - (ph - 0.3) / 0.7, 2));
    const SLOTS = [
      { x: 0.075, y: 0.3, s: 34 },
      { x: 0.925, y: 0.62, s: 28 },
      { x: 0.085, y: 0.9, s: 26 },
      { x: 0.915, y: 0.27, s: 22 },
      { x: 0.06, y: 0.6, s: 24 },
      { x: 0.94, y: 0.92, s: 20 },
    ];
    const jelly = (x: number, y: number, s: number, p: number, a: number, t: number, c: string) => {
      const w = s * (1 - p * 0.16);
      const hb = s * 0.62 * (1 + p * 0.08);
      const g = cx.createRadialGradient(x, y - hb * 0.3, 2, x, y, s * 1.6);
      g.addColorStop(0, `rgba(${c},${a * 1.6})`);
      g.addColorStop(1, `rgba(${c},0)`);
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(x, y - hb * 0.2, s * 1.6, 0, 7);
      cx.fill();
      cx.fillStyle = `rgba(${c},${a * 2.4})`;
      cx.beginPath();
      cx.moveTo(x - w, y);
      cx.bezierCurveTo(x - w, y - hb * 1.35, x + w, y - hb * 1.35, x + w, y);
      for (let k = 4; k >= 0; k--) {
        const px = x - w + (2 * w * k) / 4;
        cx.quadraticCurveTo(px + w / 4, y + 5 + p * 3, px, y);
      }
      cx.fill();
      cx.strokeStyle = `rgba(${c},${a * 5})`;
      cx.lineWidth = 1;
      cx.stroke();
      cx.strokeStyle = `rgba(${c},${a * 2.2})`;
      cx.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) {
        const tx = x - w * 0.7 + (w * 1.4 * k) / 4;
        cx.beginPath();
        cx.moveTo(tx, y + 2);
        for (let j = 1; j <= 8; j++) cx.lineTo(tx + Math.sin(t * 1.3 + k + j * 0.7) * (2 + j * 0.8), y + 2 + j * s * 0.17);
        cx.stroke();
      }
    };
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!W || !cv.offsetParent) return;
      const t = (now - start) / 1000;
      const live = Object.values(useAgents.getState().sessions).filter((x) => x.status === "needs_input" || x.status === "working");
      cx.clearRect(0, 0, W, H);
      live.slice(0, SLOTS.length).forEach((a, i) => {
        const j = SLOTS[i];
        const off = (i * 0.37) % 1;
        const needs = a.status === "needs_input";
        const p = pulseAt((t * 22 / 60 + off) % 1);
        const sp = needs ? 0 : 7 + i;
        const y = sp ? ((((j.y * H - t * sp) % (H + 260)) + H + 260) % (H + 260)) - 130 : j.y * H + Math.sin(t * 0.5 + off * 6) * 6;
        jelly(j.x * W + Math.sin(t * 0.2 + off * 6) * 10, y, j.s, needs ? p * 0.4 : p, needs ? 0.1 : 0.085, t, needs ? "233,176,75" : "143,211,255");
      });
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="bloom" aria-hidden />;
}
