import { ipc } from "../../lib/ipc";
import { shortenPath } from "../../lib/format";
import type { SectionProps } from "./registry";

export function GeneralSection({ draft, update }: SectionProps) {
  return (
    <>
      <section className="set-group">
        <h3>Workspace</h3>
        <label className="field">
          <span>Default folder</span>
          <div className="field-row">
            <input
              value={draft.defaultWorkspace ?? ""}
              placeholder="~"
              onChange={(e) => update((c) => (c.defaultWorkspace = e.target.value))}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={async () => {
                const picked = await ipc.pickFolder(draft.defaultWorkspace || "~").catch(() => null);
                if (picked) update((c) => (c.defaultWorkspace = shortenPath(picked)));
              }}
            >
              Choose…
            </button>
          </div>
        </label>
        <p className="hint">
          Where new tabs and Claude panes start when there's no folder to inherit, e.g. <code>~/Developer</code>. Splits
          still open in the current pane's folder.
        </p>
      </section>

      <section className="set-group">
        <h3>Editor</h3>
        <label className="field">
          <span>Command</span>
          <input
            value={draft.editor ?? ""}
            placeholder="auto: Cursor, then VS Code, then default app"
            onChange={(e) => update((c) => (c.editor = e.target.value))}
            spellCheck={false}
          />
        </label>
        <p className="hint">
          Used for ⌘-clicked paths and the files sidebar. Receives <code>path:line:col</code>, e.g. <code>zed</code> or{" "}
          <code>code -g</code>.
        </p>
      </section>

      <section className="set-group">
        <h3>Notifications</h3>
        <label className="field check">
          <input type="checkbox" checked={draft.notifications} onChange={(e) => update((c) => (c.notifications = e.target.checked))} />
          <span>Notify when a background agent finishes or needs input</span>
        </label>
      </section>

      <section className="set-group">
        <h3>Prompt cache</h3>
        <div className="seg">
          {([5, 60] as const).map((m) => (
            <button key={m} className={(draft.cache?.ttlMinutes ?? 60) === m ? "on" : ""} onClick={() => update((c) => (c.cache = { ...c.cache, ttlMinutes: m }))}>
              {m === 5 ? "5 min" : "1 hour"}
            </button>
          ))}
        </div>
        <p className="hint">How long Claude's prompt cache stays warm after a request; used for the cache timers on panes and the Agents board.</p>
      </section>
    </>
  );
}
