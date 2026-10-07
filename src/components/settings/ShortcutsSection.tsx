import { shortcutHelp } from "../../lib/shortcuts";

export function ShortcutsSection() {
  return (
    <section className="set-group">
      <h3>Shortcuts</h3>
      <dl className="shortcuts">
        {shortcutHelp.map((s) => (
          <div key={s.keys}>
            <dt>{s.keys}</dt>
            <dd>{s.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
