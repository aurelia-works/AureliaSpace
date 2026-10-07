import type { SectionProps } from "./registry";

export function IntegrationsSection({ draft, update }: SectionProps) {
  const d = draft.discord;
  const set = (patch: Partial<typeof d>) => update((c) => (c.discord = { ...c.discord, ...patch }));

  return (
    <section className="set-group">
      <h3>Discord</h3>
      <label className="field check">
        <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Show "Playing AureliaSpace" on my Discord profile</span>
      </label>
      <label className="field check">
        <input type="checkbox" checked={d.hideProject} onChange={(e) => set({ hideProject: e.target.checked })} />
        <span>Hide project names</span>
      </label>
      <p className="hint">Appears automatically while the Discord app is open, like a game's status.</p>
    </section>
  );
}
