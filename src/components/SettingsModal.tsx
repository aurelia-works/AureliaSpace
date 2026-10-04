import { useEffect, useState } from "react";
import { ipc, type Config, type ProviderName } from "../lib/ipc";
import { shortcutHelp } from "../lib/shortcuts";
import { applyAppearance } from "../lib/terminals";
import { useConfig } from "../store/config";
import { useUi } from "../store/ui";

const providers: { id: ProviderName; label: string; note: string }[] = [
  { id: "ollama", label: "Ollama", note: "Local and offline, no key. Needs `ollama serve` and a pulled model." },
  { id: "gemini", label: "Gemini", note: "Free tier. Key from aistudio.google.com, stored in the macOS Keychain." },
  { id: "openrouter", label: "OpenRouter", note: "Free models (\":free\" suffix). Key stored in the macOS Keychain." },
];

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen);
  const config = useConfig((s) => s.config);
  const [draft, setDraft] = useState<Config | null>(null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open && config) {
      setDraft(structuredClone(config));
      setKey("");
      setMsg("");
      Promise.all((["gemini", "openrouter"] as const).map(async (p) => [p, await ipc.hasApiKey(p)] as const)).then((r) =>
        setHasKey(Object.fromEntries(r)),
      );
    }
  }, [open, config]);

  if (!open || !draft) return null;
  const close = () => useUi.getState().set({ settingsOpen: false });
  const prov = draft.suggestions.provider;
  const provCfg = draft.suggestions[prov];
  const update = (fn: (c: Config) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };

  const save = async () => {
    try {
      await useConfig.getState().save(draft);
      applyAppearance();
      close();
    } catch (e) {
      setMsg(String(e));
    }
  };

  const saveKey = async () => {
    if (prov === "ollama") return;
    try {
      await ipc.setApiKey(prov, key);
      setHasKey({ ...hasKey, [prov]: key.trim().length > 0 });
      setKey("");
      setMsg(key.trim() ? "Key saved to Keychain." : "Key removed.");
    } catch (e) {
      setMsg(String(e));
    }
  };

  const reload = async () => {
    await useConfig.getState().load();
    applyAppearance();
    setMsg("Reloaded config.json.");
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="link-btn" onClick={() => ipc.revealConfig(true)}>
            Edit config.json
          </button>
        </div>

        <div className="settings-body">
          <section>
            <h4>Command suggestions</h4>
            <div className="seg wide">
              {providers.map((p) => (
                <button key={p.id} className={prov === p.id ? "on" : ""} onClick={() => update((c) => (c.suggestions.provider = p.id))}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="hint">{providers.find((p) => p.id === prov)?.note}</p>
            <label className="field">
              <span>Model</span>
              <input value={provCfg.model} onChange={(e) => update((c) => (c.suggestions[prov].model = e.target.value))} spellCheck={false} />
            </label>
            {prov === "ollama" ? (
              <label className="field">
                <span>Server</span>
                <input value={provCfg.baseUrl} onChange={(e) => update((c) => (c.suggestions.ollama.baseUrl = e.target.value))} spellCheck={false} />
              </label>
            ) : (
              <label className="field">
                <span>API key</span>
                <input
                  type="password"
                  value={key}
                  placeholder={hasKey[prov] ? "•••••••• saved in Keychain (enter to replace, empty to remove)" : "paste key"}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveKey()}
                />
                <button onClick={saveKey}>{key ? "Save key" : hasKey[prov] ? "Remove" : "Save key"}</button>
              </label>
            )}
          </section>

          <section>
            <h4>Appearance</h4>
            <div className="seg">
              {(["system", "light", "dark"] as const).map((t) => (
                <button key={t} className={draft.theme === t ? "on" : ""} onClick={() => update((c) => (c.theme = t))}>
                  {t}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Font size</span>
              <input
                type="number"
                min={8}
                max={32}
                value={draft.terminal.fontSize}
                onChange={(e) => update((c) => (c.terminal.fontSize = Number(e.target.value) || 13))}
              />
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={draft.terminal.optionAsMeta}
                onChange={(e) => update((c) => (c.terminal.optionAsMeta = e.target.checked))}
              />
              <span>Option key acts as Meta</span>
            </label>
            <label className="field check">
              <input type="checkbox" checked={draft.notifications} onChange={(e) => update((c) => (c.notifications = e.target.checked))} />
              <span>Notify when a background agent finishes or needs input</span>
            </label>
          </section>

          <section>
            <h4>Editor</h4>
            <label className="field">
              <span>Command</span>
              <input
                value={draft.editor ?? ""}
                placeholder="auto: Cursor, then VS Code, then default app"
                onChange={(e) => update((c) => (c.editor = e.target.value))}
                spellCheck={false}
              />
            </label>
            <p className="hint">
              Used for ⌘-clicked paths and the files sidebar. Receives <code>path:line:col</code>, e.g. <code>zed</code> or{" "}
              <code>code -g</code>.
            </p>
          </section>

          <section>
            <h4>
              Claude accounts <span className="hint inline">edit in config.json</span>
            </h4>
            <ul className="accounts-list">
              {draft.accounts.map((a) => (
                <li key={a.name}>
                  <span className="account-chip">{a.name}</span>
                  <code>{a.configDir}</code>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4>Shortcuts</h4>
            <dl className="shortcuts">
              {shortcutHelp.map((s) => (
                <div key={s.keys}>
                  <dt>{s.keys}</dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <div className="modal-foot actions">
          <span className="msg">{msg}</span>
          <button className="link-btn" onClick={reload}>
            Reload from disk
          </button>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
