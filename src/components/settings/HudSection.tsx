import type { SectionProps } from "./registry";

export function HudSection({ draft, update }: SectionProps) {
  return (
    <section className="set-group">
      <h3>HUD</h3>
      <label className="field check">
        <input type="checkbox" checked={draft.hud?.enabled ?? false} onChange={(e) => update((c) => (c.hud = { ...c.hud, enabled: e.target.checked }))} />
        <span>Floating HUD of your sessions while you're in other apps (⇧⌘H)</span>
      </label>
      <p className="hint">Shown only while AureliaSpace isn't the focused app.</p>
    </section>
  );
}
