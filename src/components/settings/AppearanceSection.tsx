import { PALETTES, swatchColors } from "../../lib/palettes";
import { resolveDark } from "../../lib/theme";
import { useConfig } from "../../store/config";
import type { SectionProps } from "./registry";

export function AppearanceSection({ draft, update }: SectionProps) {
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  return (
    <>
      <section className="set-group">
        <h3>Theme</h3>
        <div className="seg">
          {(["system", "light", "dark"] as const).map((t) => (
            <button key={t} className={draft.theme === t ? "on" : ""} onClick={() => update((c) => (c.theme = t))}>
              {t}
            </button>
          ))}
        </div>
        <div className="palette-grid">
          {PALETTES.map((p) => {
            const [bg, accent, fg] = swatchColors(p, resolveDark(draft.theme));
            return (
              <button
                key={p.id}
                className={`palette-card${draft.palette === p.id ? " on" : ""}`}
                onClick={() => {
                  update((c) => (c.palette = p.id));
                  // Applies live (UI and every terminal); other edits stay in the draft.
                  const live = useConfig.getState().config;
                  if (live) useConfig.getState().save({ ...live, palette: p.id }).catch(() => {});
                }}
              >
                <span className="palette-swatch" style={{ background: bg }}>
                  <i style={{ background: accent }} />
                  <i style={{ background: fg }} />
                </span>
                {p.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="set-group">
        <h3>Terminal</h3>
        <label className="field">
          <span>Font</span>
          <input value={draft.terminal.fontFamily} onChange={(e) => update((c) => (c.terminal.fontFamily = e.target.value))} spellCheck={false} />
        </label>
        <label className="field">
          <span>Font size</span>
          <input type="number" min={8} max={32} value={draft.terminal.fontSize} onChange={(e) => update((c) => (c.terminal.fontSize = num(e.target.value, 13)))} />
        </label>
        <label className="field">
          <span>Line height</span>
          <input type="number" min={1} max={2} step={0.05} value={draft.terminal.lineHeight} onChange={(e) => update((c) => (c.terminal.lineHeight = num(e.target.value, 1.15)))} />
        </label>
        <label className="field">
          <span>Scrollback</span>
          <input type="number" min={100} step={1000} value={draft.terminal.scrollback} onChange={(e) => update((c) => (c.terminal.scrollback = Math.round(num(e.target.value, 10000))))} />
        </label>
        <label className="field check">
          <input type="checkbox" checked={draft.terminal.optionAsMeta} onChange={(e) => update((c) => (c.terminal.optionAsMeta = e.target.checked))} />
          <span>Option key acts as Meta</span>
        </label>
        <p className="hint">Scrollback applies to panes opened after saving.</p>
      </section>
    </>
  );
}
