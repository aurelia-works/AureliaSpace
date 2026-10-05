import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { basename, expandPath, shortenPath } from "../lib/format";
import { queueInit } from "../lib/terminals";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";

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
  accent?: boolean;
  run(): void;
}

/** Shown in a new empty tab: pick what to run here. The PTY is only created after a choice. */
export function StartScreen({ paneId }: { paneId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cwd = useLayout((s) => s.panes[paneId]?.cwd);
  const accounts = useConfig((s) => s.config?.accounts ?? []);
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
  const { updatePane } = useLayout.getState();
  const start = (patch: { account?: string }, command?: string) => {
    if (command) queueInit(paneId, command);
    updatePane(paneId, { ...patch, launcher: undefined });
  };

  const choices: Choice[] = [
    ...accounts.map((a) => ({
      key: `acct-${a.name}`,
      label: `Claude · ${a.name}`,
      hint: shortenPath(a.configDir),
      accent: true,
      run: () => start({ account: a.name }),
    })),
    { key: "terminal", label: "Terminal", hint: "plain shell", run: () => start({}) },
    ...(tools.codex ? [{ key: "codex", label: "Codex", hint: "codex", run: () => start({}, "codex") }] : []),
    ...(tools.gemini ? [{ key: "gemini", label: "Gemini CLI", hint: "gemini", run: () => start({}, "gemini") }] : []),
  ];

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
        <h1 className="start-title">
          Start in <span className="start-folder">{basename(folder)}</span>
        </h1>
        <p className="start-sub">Pick what to run here. Nothing starts until you choose.</p>
        <div className="start-grid">
          {choices.map((c, i) => (
            <button key={c.key} className={`start-card${c.accent ? " claude" : ""}`} onClick={c.run}>
              {i < 9 && <span className="start-key">{i + 1}</span>}
              <span className="start-label">{c.label}</span>
              <span className="start-hint">{c.hint}</span>
            </button>
          ))}
        </div>
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
            />
          ) : (
            <>
              <span className="start-path" title={folder}>
                {shortenPath(folder)}
              </span>
              <button
                className="start-link"
                onClick={() => {
                  setDraft(shortenPath(cwd || workspace || ""));
                  setEditing(true);
                }}
              >
                Change folder…
              </button>
            </>
          )}
        </div>
        <div className="start-foot">
          <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>↵</kbd> terminal
        </div>
      </div>
    </div>
  );
}
