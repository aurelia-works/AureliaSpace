import { useEffect } from "react";
import { useRemote } from "../lib/remote";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { UsageMeter } from "./UsageMeter";

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

/** Shown while a phone is connected to the remote (Settings → Remote): it can type into your panes. */
function PhoneChip() {
  const clients = useRemote((s) => s.clients);
  if (!clients) return null;
  const label = clients === 1 ? "Phone connected" : `${clients} phones connected`;
  return (
    <button className="sb-phone" title={`${label} (Settings → Remote)`} onClick={() => useUi.getState().set({ settingsOpen: true, settingsSection: "remote" })}>
      <svg width={10} height={12} viewBox="0 0 10 14" aria-hidden>
        <rect x="1" y="1" width="8" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      {clients > 1 ? clients : null}
    </button>
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
      <FontReset />
      <PhoneChip />
      <Fuel />
    </footer>
  );
}
