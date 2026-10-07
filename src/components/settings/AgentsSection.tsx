import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { SectionProps } from "./registry";

/** Keys the agent launcher injects into a pane's environment. Gemini is shared with suggestions. */
const keys: { id: string; label: string; note: string }[] = [
  { id: "openai", label: "OpenAI", note: "Codex without a ChatGPT plan (pay per token)." },
  { id: "gemini", label: "Gemini", note: "Gemini CLI; also used for command suggestions." },
  { id: "deepseek", label: "DeepSeek", note: "DeepSeek through Claude Code or OpenCode." },
  { id: "xai", label: "xAI", note: "Grok through the Grok CLI or OpenCode." },
];

export function AgentsSection({ notify }: SectionProps) {
  const [present, setPresent] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    ipc.agentKeysPresent(keys.map((k) => k.id)).then(setPresent).catch(() => {});
  }, []);

  const save = async (id: string) => {
    const key = drafts[id] ?? "";
    try {
      await ipc.setAgentKey(id, key);
      setPresent((p) => (key.trim() ? [...new Set([...p, id])] : p.filter((x) => x !== id)));
      setDrafts({ ...drafts, [id]: "" });
      notify(key.trim() ? "Key saved to Keychain." : "Key removed.");
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <section className="set-group">
      <h3>Agent API keys</h3>
      <p className="hint">Stored in the macOS Keychain and passed only to the agents that need them. Open the launcher with ⌘E.</p>
      {keys.map((k) => {
        const has = present.includes(k.id);
        const value = drafts[k.id] ?? "";
        return (
          <label key={k.id} className="field" title={k.note}>
            <span>{k.label}</span>
            <input
              type="password"
              value={value}
              placeholder={has ? "•••••••• saved (enter to replace, empty to remove)" : k.note}
              onChange={(e) => setDrafts({ ...drafts, [k.id]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && save(k.id)}
            />
            {(value || has) && <button onClick={() => save(k.id)}>{value ? "Save key" : "Remove"}</button>}
          </label>
        );
      })}
    </section>
  );
}
