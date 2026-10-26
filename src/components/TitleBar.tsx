import { basename } from "../lib/format";
import { useUi } from "../store/ui";
import { AureliaMark, SidebarIcon } from "./Icons";
import { UsageStrip } from "./UsageStrip";
import { NoticeBell } from "./Notices";

/** A pane's short title: the command running in it, else its folder. */
export function paneTitle(cwd: string | undefined, running: string | undefined): string {
  if (running) return running.split(/\s+/)[0];
  return basename(cwd) || "~";
}

export function TitleBar() {
  const nav = useUi((s) => s.nav);
  const ui = useUi.getState();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <AureliaMark className="brand-mark" width={22} height={22} />
        <span className="brand-name" data-tauri-drag-region>
          Aurelia<span>Space</span>
        </span>
        <DevMark />
      </div>
      <button
        className={`icon-btn quiet${nav ? " on" : ""}`}
        title="Sidebar (⌘\\)"
        aria-label="Sidebar"
        aria-pressed={!!nav}
        onClick={() => ui.set({ nav: nav ? null : "projects" })}
      >
        <SidebarIcon />
      </button>
      <span className="tb-sp" data-tauri-drag-region />
      <NoticeBell />
      <FontReset />
      <UsageStrip />
    </header>
  );
}

/** Only shown when the font size is off its default; one click resets it. */
function FontReset() {
  const fontDelta = useUi((s) => s.fontDelta);
  if (fontDelta === 0) return null;
  return (
    <button className="tb-font num" title="Font size offset (⌘0 resets)" onClick={() => useUi.getState().set({ fontDelta: 0 })}>
      A{fontDelta > 0 ? `+${fontDelta}` : fontDelta}
    </button>
  );
}

/** "AureliaSpace Dev" (npm run app:build:dev) runs next to the installed app: a tilted DEV sash on the brand's corner says which one this is. */
function DevMark() {
  return import.meta.env.VITE_AURELIA_DEV ? (
    <span className="brand-dev" aria-label="Dev build">
      <span>DEV</span>
    </span>
  ) : null;
}
