import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { SectionProps } from "./registry";

const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";

export function SubagentsSection({ draft, update }: SectionProps) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    ipc
      .which("opencode")
      .then(setInstalled)
      .catch(() => setInstalled(false));
  }, []);
  const sub = draft.subagents ?? {
    enabled: true,
    model: DEFAULT_MODEL,
    timeoutMinutes: 15,
  };
  const set = (patch: Partial<typeof sub>) =>
    update((c) => (c.subagents = { ...sub, ...patch }));

  return (
    <>
      <section className="set-group">
        <h3>Orchestration</h3>
        <label className="field check">
          <input
            type="checkbox"
            checked={draft.orchestrator !== false}
            onChange={(e) => update((c) => (c.orchestrator = e.target.checked))}
          />
          <span>Let Claude panes see and drive other panes</span>
        </label>
        <p className="hint">
          Adds <code>aurelia_*</code> tools: list panes, read one's output, send
          one a message (queued while it works, refused while it waits on you),
          open a Claude pane on a task, and show an HTML page in a browser pane.
          Takes effect for Claude sessions started after saving.
        </p>
      </section>
      <section className="set-group">
        <h3>DeepSeek subagents</h3>
        <label className="field check">
          <input
            type="checkbox"
            checked={sub.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span>Let Claude hand tasks to DeepSeek agents through OpenCode</span>
        </label>
        <p className="hint">
          Claude panes get a <code>deepseek_agent</code> tool. Each call starts
          a fresh OpenCode agent on your OpenCode Go plan with one or two tasks,
          read-only unless Claude asks to edit; destructive git and{" "}
          <code>rm -rf</code> are blocked. It doesn't touch your Claude limits.
          Takes effect for Claude sessions started after saving.
        </p>
        {installed === false && (
          <p className="hint warn">
            <code>opencode</code> isn't installed, so the tool stays hidden.
            Install it, then sign in to OpenCode Go with{" "}
            <code>opencode auth login</code>.
          </p>
        )}
        <label className="field">
          <span>Model</span>
          <input
            value={sub.model}
            placeholder={DEFAULT_MODEL}
            onChange={(e) => set({ model: e.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Time limit (minutes)</span>
          <input
            type="number"
            min={1}
            max={120}
            value={sub.timeoutMinutes}
            onChange={(e) =>
              set({
                timeoutMinutes: Math.max(
                  1,
                  Math.min(120, Number(e.target.value) || 15),
                ),
              })
            }
          />
        </label>
        <p className="hint">
          Any OpenCode model as <code>provider/model</code>, optionally with{" "}
          <code>#low</code> or <code>#high</code>. Opus models are refused. An
          agent still running at the limit is stopped and its partial report
          returned.
        </p>
      </section>
    </>
  );
}
