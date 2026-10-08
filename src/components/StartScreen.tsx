import { accountForFolder } from "../lib/handoff";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { basename, expandPath, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { prepareCustomAgent, variantOf } from "../lib/agents";
import { queueInit } from "../lib/terminals";
import { useConfig } from "../store/config";
import { useCustomAgents, type CustomAgent } from "../store/customAgents";
import { useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { useUi } from "../store/ui";
import { AgentAvatar } from "./AgentChip";
import { AgentLogo } from "./AgentLogos";
import { CloseIcon, FolderIcon, SparkIcon, TerminalIcon } from "./Icons";

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
  run(): void;
}

/** Shown in a new empty tab: pick what to run here. The PTY is only created after a choice. */
export function StartScreen({ paneId }: { paneId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cwd = useLayout((s) => s.panes[paneId]?.cwd);
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const recents = useRecents((s) => s.folders);
  const customAgents = useCustomAgents((s) => s.agents);
  const workspace = useConfig((s) => s.config?.defaultWorkspace);
  const [tools, setTools] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let alive = true;
    detectTools().then((t) => alive && setTools(t));
    rootRef.current?.focus();
    return () => {
      alive = false;
    };
  }, []);

  const folder = cwd || workspace || "~";
  const preferred = accountForFolder(cwd || workspace);
  const { updatePane } = useLayout.getState();
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
    // The folder's preferred account (workspace override, else the default) comes first.
    ...[...accounts].sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred)).map((a) => ({
      key: `acct-${a.name}`,
      label: `Claude · ${a.name}${a.name === preferred ? " (default)" : ""}`,
      hint: shortenPath(a.configDir),
      logo: "claude",
      run: () => start({ account: a.name }),
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
    rootRef.current?.focus();
  };

  const applyFolder = () => {
    const p = expandPath(draft);
    if (p) updatePane(paneId, { cwd: p });
    setEditing(false);
    rootRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) {
      if (e.key === "Escape") {
        setEditing(false);
        rootRef.current?.focus();
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Enter") start({});
    else if (/^[1-9]$/.test(e.key) && choices[Number(e.key) - 1]) choices[Number(e.key) - 1].run();
    else return;
    e.preventDefault();
  };

  return (
    <div className="start-screen" tabIndex={-1} ref={rootRef} onKeyDown={onKey}>
      <div className="start-inner">
        <div className="label">New tab</div>
        <h1 className="start-title">
          Start in <span className="start-folder">{basename(folder)}</span>
        </h1>
        <div className="start-folder-row">
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
            <>
              <FolderIcon width={12} height={12} />
              <span className="start-path mono" title={folder}>
                {shortenPath(folder)}
              </span>
              <button
                className="link-btn"
                onClick={() => {
                  setDraft(shortenPath(cwd || workspace || ""));
                  setEditing(true);
                }}
              >
                Type path…
              </button>
              <button className="link-btn" onClick={browseFolder}>
                Choose folder…
              </button>
            </>
          )}
        </div>
        <div className="start-list" role="list">
          {choices.map((c, i) => (
            <button key={c.key} role="listitem" className={`start-row ${c.logo}`} onClick={c.run}>
              <span className="start-logo">
                {c.agent ? <AgentAvatar agent={c.agent} size={14} /> : c.logo === "terminal" ? <TerminalIcon width={16} height={16} /> : c.logo === "more" ? <SparkIcon width={16} height={16} /> : <AgentLogo logo={c.logo} size={16} />}
              </span>
              <span className="start-label">{c.label}</span>
              <span className="start-hint">{c.hint}</span>
              {i < 9 && <kbd>{i + 1}</kbd>}
            </button>
          ))}
        </div>
        {quickOpen.length > 0 && (
          <div className="start-recents">
            <div className="label">Recent folders</div>
            {quickOpen.map((r) => (
              <div key={r} className="recent-row">
                <button className="recent-open" onClick={() => updatePane(paneId, { cwd: r })} title={`Start in ${r}`}>
                  <span className="recent-name">{basename(r)}</span>
                  <span className="recent-path">{shortenPath(r)}</span>
                </button>
                <button className="icon-btn sm recent-del" onClick={() => useRecents.getState().remove(r)} title="Remove from recents" aria-label="Remove from recents">
                  <CloseIcon width={10} height={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="start-foot">
          <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>↵</kbd> terminal · <kbd>⌘P</kbd> go anywhere
        </div>
      </div>
    </div>
  );
}
