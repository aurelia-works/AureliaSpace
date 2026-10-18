import { useEffect, useState } from "react";
import { fillTemplate, templateFields } from "../lib/template";
import { openDraft } from "../store/prompts";
import { useUi } from "../store/ui";

/** Asks for a saved prompt's `{{fields}}` before it goes into the composer (Warp-style workflows). */
export function PromptFill() {
  const fill = useUi((s) => s.promptFill);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => setValues({}), [fill]);
  if (!fill) return null;
  const fields = templateFields(fill.text);
  const close = () => useUi.getState().set({ promptFill: null });
  const done = () => {
    close();
    openDraft(fill.paneId, fillTemplate(fill.text, values));
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form
        className="modal prompt-fill"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && close()}
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <div className="modal-head">
          <h2>Fill in the prompt</h2>
        </div>
        <div className="prompt-fill-body">
          <pre className="prompt-fill-preview">{fillTemplate(fill.text, values)}</pre>
          {fields.map((f, i) => (
            <label key={f} className="field">
              <span>{f}</span>
              <input autoFocus={i === 0} value={values[f] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} spellCheck={false} />
            </label>
          ))}
        </div>
        <div className="modal-foot actions">
          <span className="msg">↵ puts it in the composer; nothing is sent yet</span>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Use prompt
          </button>
        </div>
      </form>
    </div>
  );
}
