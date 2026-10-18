import type { Routine } from "../../lib/ipc";
import { runRoutine } from "../../lib/routines";
import { uid } from "../../store/layout";
import { useUi } from "../../store/ui";
import type { SectionProps } from "./registry";

const blank = (account: string): Routine => ({
  id: uid("routine"),
  name: "",
  enabled: true,
  kind: "daily",
  time: "09:00",
  minutes: 60,
  weekdaysOnly: true,
  account,
  cwd: "",
  prompt: "",
});

export function RoutinesSection({ draft, update, notify }: SectionProps) {
  const list = draft.routines ?? [];
  const accounts = draft.accounts.map((a) => a.name);
  const set = (id: string, patch: Partial<Routine>) => update((c) => (c.routines = (c.routines ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r))));

  return (
    <section className="set-group">
      <h3>Routines</h3>
      <p className="hint">
        A routine opens a Claude pane with its prompt on a schedule, while AureliaSpace is running. A daily run missed by
        more than two hours waits for the next day, and a run is skipped while the last one is still working.
      </p>
      {list.map((r) => (
        <div key={r.id} className="routine">
          <div className="routine-head">
            <label className="field check">
              <input type="checkbox" checked={r.enabled} onChange={(e) => set(r.id, { enabled: e.target.checked })} />
              <input className="routine-name" value={r.name} placeholder="Name, e.g. Morning triage" onChange={(e) => set(r.id, { name: e.target.value })} />
            </label>
            <button
              className="link-btn"
              disabled={!r.prompt.trim()}
              onClick={() => {
                runRoutine(r);
                useUi.getState().set({ settingsOpen: false });
              }}
            >
              Run now
            </button>
            <button className="link-btn danger" onClick={() => update((c) => (c.routines = (c.routines ?? []).filter((x) => x.id !== r.id)))}>
              Delete
            </button>
          </div>
          <div className="routine-when">
            <select value={r.kind} onChange={(e) => set(r.id, { kind: e.target.value as Routine["kind"] })}>
              <option value="daily">Every day at</option>
              <option value="every">Every</option>
            </select>
            {r.kind === "daily" ? (
              <input type="time" value={r.time} onChange={(e) => set(r.id, { time: e.target.value })} />
            ) : (
              <>
                <input type="number" min={5} value={r.minutes} onChange={(e) => set(r.id, { minutes: Math.max(5, Number(e.target.value) || 5) })} />
                <span>minutes</span>
              </>
            )}
            <label className="field check inline">
              <input type="checkbox" checked={r.weekdaysOnly} onChange={(e) => set(r.id, { weekdaysOnly: e.target.checked })} />
              <span>Weekdays only</span>
            </label>
          </div>
          <div className="routine-where">
            <select value={r.account} onChange={(e) => set(r.id, { account: e.target.value })}>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  Claude · {a}
                </option>
              ))}
            </select>
            <input value={r.cwd} placeholder="Folder, e.g. ~/dev/app" onChange={(e) => set(r.id, { cwd: e.target.value })} spellCheck={false} />
          </div>
          <textarea rows={3} value={r.prompt} placeholder="What Claude should do, e.g. Check CI on main and summarise failures" onChange={(e) => set(r.id, { prompt: e.target.value })} />
        </div>
      ))}
      <button
        onClick={() => {
          update((c) => (c.routines = [...(c.routines ?? []), blank(accounts[0] ?? "")]));
          notify("Routine added: save to schedule it");
        }}
      >
        Add routine
      </button>
    </section>
  );
}
