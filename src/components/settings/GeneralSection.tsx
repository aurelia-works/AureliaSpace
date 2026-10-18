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
        <label className="field check">
          <input type="checkbox" checked={draft.openFilesInApp !== false} onChange={(e) => update((c) => (c.openFilesInApp = e.target.checked))} />
          <span>Open files in AureliaSpace</span>
        </label>
        <p className="hint">
          ⌘-clicked paths, search hits and problems open in an editor pane beside the terminal (⌘S saves; a file an agent
          changed reloads when you come back to it). ⌥⌘-click, folders and binary files use the command below.
        </p>
        <label className="field">
          <span>External editor</span>
          <input
            value={draft.editor ?? ""}
            placeholder="auto: Cursor, then VS Code, then default app"
            onChange={(e) => update((c) => (c.editor = e.target.value))}
            spellCheck={false}
          />
        </label>
        <p className="hint">
          Receives <code>path:line:col</code>, e.g. <code>zed</code> or{" "}
          <code>code -g</code>.
        </p>
      </section>

      <section className="set-group">
        <h3>Claude panes</h3>
        <label className="field">
          <span>Start in</span>
          <select value={draft.claudePermissionMode ?? ""} onChange={(e) => update((c) => (c.claudePermissionMode = e.target.value))}>
            <option value="">Claude's default (ask before edits)</option>
            <option value="acceptEdits">Auto-edit: accept file edits, ask for commands</option>
            <option value="plan">Plan mode: read and plan, no changes</option>
            <option value="auto">Auto: Claude decides what's safe to run</option>
            <option value="bypassPermissions">Bypass: never ask (risky)</option>
          </select>
        </label>
        <p className="hint">
          Applies to Claude panes AureliaSpace starts, as <code>claude --permission-mode</code>. Each pane's mode chip switches it
          later (Shift+Tab in Claude).
        </p>
      </section>

      <section className="set-group">
        <h3>Restore</h3>
        <label className="field check">
          <input type="checkbox" checked={draft.resumeOnLaunch !== false} onChange={(e) => update((c) => (c.resumeOnLaunch = e.target.checked))} />
          <span>Reopen each Claude pane's conversation when AureliaSpace starts</span>
        </label>
        <p className="hint">Restored panes run <code>claude --resume</code> on the conversation they last had, instead of starting blank.</p>
        <label className="field check">
          <input
            type="checkbox"
            checked={draft.terminal.keepAlive !== false}
            onChange={(e) => update((c) => (c.terminal.keepAlive = e.target.checked))}
          />
          <span>Keep terminals running while AureliaSpace quits, restarts or updates</span>
        </label>
        <p className="hint">
          Shells and agents live in a small background process and pick up where they were when the app comes back, with
          their recent output. Closing a pane ends its shell; one left without the app for 3 days is ended too. Applies to
          panes opened after the change.
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
