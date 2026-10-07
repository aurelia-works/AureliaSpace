import type { SectionProps } from "./registry";

export function VoiceSection({ draft, update }: SectionProps) {
  return (
    <section className="set-group">
      <h3>Voice</h3>
      <label className="field check">
        <input
          type="checkbox"
          checked={draft.voice?.shellCleanup ?? false}
          onChange={(e) => update((c) => (c.voice = { ...c.voice, shellCleanup: e.target.checked }))}
        />
        <span>Tidy dictation in shell panes ("dash dash" becomes --, trailing period dropped)</span>
      </label>
      <p className="hint">Dictation comes from Aurelia Voice via the mic button or ⌥⌘V. Claude panes always get the raw text.</p>
    </section>
  );
}
