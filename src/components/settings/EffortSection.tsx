import { EFFORT_LEVELS } from "../../lib/effort";
import type { EffortLevel } from "../../lib/ipc";
import type { SectionProps } from "./registry";

export function EffortSection({ draft, update }: SectionProps) {
  const eff = draft.effort ?? { auto: true, judge: true, floor: "low" as EffortLevel, ceiling: "high" as EffortLevel };
  const set = (patch: Partial<typeof eff>) => update((c) => (c.effort = { ...eff, ...patch }));
  const levelSelect = (value: EffortLevel, onChange: (v: EffortLevel) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as EffortLevel)}>
      {EFFORT_LEVELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <section className="set-group">
      <h3>Auto effort</h3>
      <label className="field check">
        <input type="checkbox" checked={eff.auto} onChange={(e) => set({ auto: e.target.checked })} />
        <span>Pick the effort for each prompt sent from the composer (⌘L) or a reply box</span>
      </label>
      <label className="field check">
        <input type="checkbox" checked={eff.judge} disabled={!eff.auto} onChange={(e) => set({ judge: e.target.checked })} />
        <span>Ask Haiku 5.5 when the rules aren't sure (about 2 s and $0.0002 on the pane's account)</span>
      </label>
      <label className="field">
        <span>Lowest</span>
        {levelSelect(eff.floor, (floor) => set({ floor }))}
      </label>
      <label className="field">
        <span>Highest</span>
        {levelSelect(eff.ceiling, (ceiling) => set({ ceiling }))}
      </label>
      <p className="hint">
        Rules settle clear cases at once: "fix the typo" goes low, a crash or failing test goes high, "continue" keeps
        what's set, and "ultrathink" asks for max. The level is set through <code>/effort</code>'s session-only choice,
        so your saved default never changes. It only switches on Opus 5.5 and Sonnet 5.5, where changing effort keeps
        the prompt cache; on other models it would rewrite most of it, so it stays put.
      </p>
    </section>
  );
}
