import { useEffect, useMemo, useRef, useState } from "react";
import { launchCustomAgent, variantOf } from "../lib/agents";
import { openInBrowserPane } from "../lib/browser";
import { basename, shortenPath } from "../lib/format";
import { handOff } from "../lib/handoff";
import { toggleHud } from "../lib/hudBridge";
import { jumpToWaiting } from "../lib/shortcuts";
import { clearTerminal, showPane } from "../lib/terminals";
import { toggleVoice, useVoice } from "../lib/voice";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useCustomAgents } from "../store/customAgents";
import { activeTab, focusedPaneId, paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useUi } from "../store/ui";
import { SearchIcon } from "./Icons";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

interface Item {
  id: string;
  group: "Panes" | "Actions";
  label: string;
  hint?: string;
  keys?: string;
  state?: Visual | "shell";
  run(): void;
}

/** Subsequence match; lower is better, null = no match. Word starts and contiguous runs score best. */
function score(text: string, q: string): number | null {
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let total = 0;
  let last = -1;
  for (const ch of q.toLowerCase()) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    const boundary = at === 0 || /[\s·/:._-]/.test(t[at - 1]);
    total += at - (last + 1) + (boundary ? 0 : 2);
    last = at;
    ti = at + 1;
  }
  return total;
}

function paneItems(): Item[] {
  const { tabs, panes } = useLayout.getState();
  const sessions = useAgents.getState().sessions;
  const runtime = useRuntime.getState().panes;
  const out: Item[] = [];
  tabs.forEach((tab, ti) =>
    paneIds(tab.root).forEach((id) => {
      const p = panes[id];
      const s = sessions[id];
      const dir = s?.cwd ?? p?.cwd;
      const custom = p?.customAgent ? useCustomAgents.getState().agents.find((a) => a.id === p.customAgent)?.name : undefined;
      const what = custom ?? (p?.browser ? "browser" : s ? (s.account ?? "claude") : (p?.agent ?? runtime[id]?.running?.split(/\s+/)[0] ?? "shell"));
      const v = s ? visualOf(s) : undefined;
      out.push({
        id: `pane:${id}`,
        group: "Panes",
        label: `${basename(dir) || "~"} · ${what}`,
        hint: `tab ${ti + 1}${v ? ` · ${stateLabel[v]}` : ""} · ${shortenPath(dir)}`,
        state: v ?? "shell",
        run: () => showPane(id),
      });
    }),
  );
  // Whoever needs you floats to the top of an empty query.
  return out.sort((a, b) => (a.state === "shell" ? 9 : urgency[a.state as Visual]) - (b.state === "shell" ? 9 : urgency[b.state as Visual]));
}

function actionItems(): Item[] {
  const ui = useUi.getState();
  const layout = useLayout.getState();
  const pane = focusedPaneId();
  const tab = activeTab();
  const cfg = useConfig.getState().config;
  const setTheme = (theme: "system" | "light" | "dark") => cfg && void useConfig.getState().save({ ...cfg, theme });
  const items: (Item | false)[] = [
    { id: "agents", group: "Actions", label: "Agents board", keys: "⇧⌘1", run: () => ui.set({ mode: "agents", reviewOpen: false }) },
    { id: "terminals", group: "Actions", label: "Terminals", keys: "⇧⌘2", run: () => ui.set({ mode: "terminals", reviewOpen: false }) },
    { id: "review", group: "Actions", label: "Review uncommitted changes", keys: "⇧⌘3", run: () => ui.set({ reviewOpen: true }) },
    { id: "jump", group: "Actions", label: "Jump to the agent waiting longest", keys: "⌘J", run: () => void jumpToWaiting() },
    { id: "launch", group: "Actions", label: "Launch agents…", hint: "Claude accounts, Codex, Gemini, more", keys: "⇧⌘E", run: () => ui.set({ accountPicker: { target: "tab" } }) },
    { id: "claude-split", group: "Actions", label: "New Claude pane as account (split)", keys: "⌘E", run: () => ui.set({ accountPicker: { target: "split" } }) },
    { id: "tab", group: "Actions", label: "New tab", keys: "⌘T", run: () => layout.newTab({ cwd: pane ? layout.panes[pane]?.cwd : undefined, launcher: true }) },
    { id: "grid", group: "Actions", label: "New grid tab (2–16 panes)", keys: "⌘G", run: () => ui.set({ gridOpen: true }) },
    !!pane && { id: "split-r", group: "Actions", label: "Split right", keys: "⌘D", run: () => layout.splitPane(pane, "row") },
    !!pane && { id: "split-d", group: "Actions", label: "Split down", keys: "⇧⌘D", run: () => layout.splitPane(pane, "column") },
    !!pane && { id: "close-pane", group: "Actions", label: "Close pane", keys: "⌘W", run: () => layout.closePane(pane) },
    !!tab && { id: "close-tab", group: "Actions", label: "Close tab", keys: "⇧⌘W", run: () => layout.closeTab(tab.id) },
    !!pane && { id: "suggest", group: "Actions", label: "Suggest a shell command", keys: "⌘I", run: () => (ui.set({ mode: "terminals", suggestPaneId: pane }), showPane(pane)) },
    { id: "browser", group: "Actions", label: "Open browser pane", keys: "⇧⌘B", run: () => openInBrowserPane(pane, "") },
    !!pane && { id: "clear", group: "Actions", label: "Clear pane", keys: "⌘K", run: () => clearTerminal(pane) },
    !!pane && !!useAgents.getState().sessions[pane]?.transcriptPath && { id: "handoff", group: "Actions", label: "Hand off this session to a fresh pane", run: () => void handOff(pane) },
    { id: "nav-ws", group: "Actions", label: "Navigator: workspace", keys: "⌘\\", run: () => ui.set({ nav: ui.nav === "projects" ? null : "projects" }) },
    { id: "nav-files", group: "Actions", label: "Navigator: files", keys: "⇧⌘F", run: () => ui.set({ nav: ui.nav === "files" ? null : "files" }) },
    { id: "rail", group: "Actions", label: "Toggle Queue rail", keys: "⌘B", run: () => ui.set({ agentPanelOpen: !ui.agentPanelOpen }) },
    { id: "hud", group: "Actions", label: "Toggle floating HUD", keys: "⇧⌘H", run: toggleHud },
    useVoice.getState().installed && !!pane && { id: "voice", group: "Actions", label: "Dictate into the focused pane", keys: "⌥⌘V", run: () => toggleVoice(pane) },
    { id: "font+", group: "Actions", label: "Bigger text", keys: "⌘+", run: () => ui.set({ fontDelta: Math.min(ui.fontDelta + 1, 16) }) },
    { id: "font-", group: "Actions", label: "Smaller text", keys: "⌘-", run: () => ui.set({ fontDelta: Math.max(ui.fontDelta - 1, -6) }) },
    { id: "font0", group: "Actions", label: "Reset text size", keys: "⌘0", run: () => ui.set({ fontDelta: 0 }) },
    { id: "theme-dark", group: "Actions", label: "Theme: dark", run: () => setTheme("dark") },
    { id: "theme-light", group: "Actions", label: "Theme: light", run: () => setTheme("light") },
    { id: "theme-system", group: "Actions", label: "Theme: follow system", run: () => setTheme("system") },
    { id: "settings", group: "Actions", label: "Settings", keys: "⌘,", run: () => ui.set({ settingsOpen: true }) },
    ...useCustomAgents.getState().agents.map((a) => ({
      id: `agent:${a.id}`,
      group: "Actions" as const,
      label: `Launch ${a.name}`,
      hint: variantOf(a)?.label,
      run: () => void launchCustomAgent(a, "tab"),
    })),
    { id: "new-agent", group: "Actions", label: "New custom agent…", run: () => ui.set({ settingsOpen: true, settingsSection: "my-agents" }) },
  ];
  return items.filter((x): x is Item => !!x);
}

/** ⌘P: one box to reach any pane (by folder, account, state) or run any action. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (open ? [...paneItems(), ...actionItems()] : []), [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const scored = all.map((it) => ({ it, s: score(`${it.label} ${it.hint ?? ""}`, q.trim()) })).filter((x) => x.s !== null);
    if (q.trim()) scored.sort((a, b) => a.s! - b.s!);
    return scored.map((x) => x.it).slice(0, 60);
  }, [all, q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;
  const close = () => useUi.getState().set({ paletteOpen: false });
  const run = (it: Item | undefined) => {
    if (!it) return;
    close();
    requestAnimationFrame(() => it.run());
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) setIndex((i) => Math.min(results.length - 1, i + 1));
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) setIndex((i) => Math.max(0, i - 1));
    else if (e.key === "Enter") run(results[index]);
    else return;
    e.preventDefault();
  };

  let lastGroup = "";
  return (
    <div className="scrim top" onMouseDown={close}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="cmdk-input">
          <SearchIcon width={14} height={14} />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            placeholder="Jump to a pane or run an action…"
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-activedescendant={results[index] ? `pi-${results[index].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {results.length === 0 && <p className="empty cmdk-empty">No match.</p>}
          {results.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {head && <div className="cmdk-group label">{head}</div>}
                <div
                  id={`pi-${it.id}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  className={`cmdk-item${i === index ? " sel" : ""}`}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => run(it)}
                >
                  {it.state ? <StatusGlyph state={it.state} /> : <span className="cmdk-dot" />}
                  <span className="cmdk-label">{it.label}</span>
                  {it.hint && <span className="cmdk-hint">{it.hint}</span>}
                  {it.keys && <kbd>{it.keys}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
