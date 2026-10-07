import { useEffect, useState } from "react";
import { ipc, type ProviderName } from "../../lib/ipc";
import type { SectionProps } from "./registry";

const providers: { id: ProviderName; label: string; note: string }[] = [
  { id: "ollama", label: "Ollama", note: "Local and offline, no key. Needs `ollama serve` and a pulled model." },
  { id: "gemini", label: "Gemini", note: "Free tier. Key from aistudio.google.com, stored in the macOS Keychain." },
  { id: "openrouter", label: "OpenRouter", note: "Free models (\":free\" suffix). Key stored in the macOS Keychain." },
];

export function SuggestionsSection({ draft, update, notify }: SectionProps) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const prov = draft.suggestions.provider;
  const provCfg = draft.suggestions[prov];

  useEffect(() => {
    Promise.all((["gemini", "openrouter"] as const).map(async (p) => [p, await ipc.hasApiKey(p)] as const)).then((r) =>
      setHasKey(Object.fromEntries(r)),
    );
  }, []);

  const saveKey = async () => {
    if (prov === "ollama") return;
    try {
      await ipc.setApiKey(prov, key);
      setHasKey({ ...hasKey, [prov]: key.trim().length > 0 });
      setKey("");
      notify(key.trim() ? "Key saved to Keychain." : "Key removed.");
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <section className="set-group">
      <h3>Command suggestions</h3>
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
  );
}
