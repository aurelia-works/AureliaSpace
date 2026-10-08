import { useEffect } from "react";
import { basename } from "../lib/format";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { paneIds, useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { StatusGlyph, stateLabel, visualOf } from "./StatusGlyph";
import { UsageMeter } from "./UsageMeter";

/** One pip per agent in tab order: the whole fleet at a glance from any mode. Click to go there. */
function Fleet() {
  const sessions = useAgents((s) => s.sessions);
  const tabs = useLayout((s) => s.tabs);
  const agents = tabs.flatMap((t, ti) => paneIds(t.root).map((id) => ({ id, tab: ti }))).filter((p) => sessions[p.id]);
  if (agents.length === 0) return <div className="sb-fleet" />;
  return (
    <div className="sb-fleet" aria-label="Agents">
      <div className="pips">
        {agents.map(({ id, tab }) => {
          const s = sessions[id];
          const v = visualOf(s);
          const where = `${s.account ?? "claude"} · ${basename(s.cwd) || "—"} · tab ${tab + 1}`;
          return (
            <button key={id} className={`pip ${v}`} onClick={() => showPane(id)} title={`${where}: ${stateLabel[v]}`} aria-label={`${where}: ${stateLabel[v]}`}>
              <StatusGlyph state={v} title="" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Only shown when the font size is off its default; one click resets it. */
function FontReset() {
  const fontDelta = useUi((s) => s.fontDelta);
  if (fontDelta === 0) return <div className="sb-focus" />;
  return (
    <div className="sb-focus">
      <button className="sb-font num" title="Font size offset (⌘0 resets)" onClick={() => useUi.getState().set({ fontDelta: 0 })}>
        A{fontDelta > 0 ? `+${fontDelta}` : fontDelta}
      </button>
    </div>
  );
}

/** 5h / 7d usage for every account that has a pane open (all accounts when none do). */
function Fuel() {
  const accounts = useConfig((s) => s.config?.accounts) ?? [];
  const inUse = useLayout((s) => [...new Set(Object.values(s.panes).map((p) => p.account).filter(Boolean))].join("\n"));
  const usage = useUsage((s) => s.usage);
  const used = inUse ? inUse.split("\n") : [];
  const shown = used.length ? accounts.filter((a) => used.includes(a.name)) : accounts;
  const missing = shown.filter((a) => !(a.name in usage)).map((a) => a.name).join("\n");
  // Polling only covers accounts with panes open; fetch the rest once so the bar isn't stuck on "usage…".
  useEffect(() => {
    if (missing) missing.split("\n").forEach((a) => void useUsage.getState().refresh(a));
  }, [missing]);
  if (!shown.length) return null;
  return (
    <div className="sb-fuel">
      {shown.map((a) => (
        <span key={a.name} className="sb-account">
          <span className="sb-account-name">{a.name}</span>
          <UsageMeter usage={usage[a.name]} compact />
        </span>
      ))}
    </div>
  );
}

export function StatusBar() {
  return (
    <footer className="statusbar">
      <Fleet />
      <FontReset />
      <Fuel />
    </footer>
  );
}
