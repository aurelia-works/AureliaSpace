import { useEffect, useMemo, useState } from "react";
import { ipc, type Config } from "../../lib/ipc";
import { applyAppearance } from "../../lib/terminals";
import { useConfig } from "../../store/config";
import { useUi } from "../../store/ui";
import { SECTIONS } from "./registry";

/** Accounts commit on their own (see AccountsSection), so they never count as draft changes. */
const withoutAccounts = (c: Config) => JSON.stringify({ ...c, accounts: null });

export function SettingsPage() {
  const open = useUi((s) => s.settingsOpen);
  const config = useConfig((s) => s.config);
  const [draft, setDraft] = useState<Config | null>(null);
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open && config) {
      setDraft(structuredClone(config));
      setMsg("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => useUi.getState().set({ settingsOpen: false });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const dirty = useMemo(() => !!draft && !!config && withoutAccounts(draft) !== withoutAccounts(config), [draft, config]);

  if (!open || !draft) return null;
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const update = (fn: (c: Config) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };

  const save = async () => {
    try {
      // Accounts may have changed on their own since the draft was taken; always keep the live list.
      const live = useConfig.getState().config;
      await useConfig.getState().save({ ...draft, accounts: live?.accounts ?? draft.accounts });
      applyAppearance();
      setMsg("Saved.");
    } catch (e) {
      setMsg(String(e));
    }
  };

  const discard = () => {
    if (config) setDraft(structuredClone(config));
    setMsg("");
  };

  const reload = async () => {
    const fresh = await useConfig.getState().load();
    setDraft(structuredClone(fresh));
    applyAppearance();
    setMsg("Reloaded config.json.");
  };

  return (
    <div className="settings-page" role="dialog" aria-label="Settings">
      <nav className="settings-nav">
        <h2>Settings</h2>
        {SECTIONS.map((s) => (
          <button key={s.id} className={s.id === section.id ? "on" : ""} onClick={() => setSectionId(s.id)}>
            {s.label}
          </button>
        ))}
        <div className="settings-nav-foot">
          <button onClick={() => ipc.revealConfig(true)}>Edit config.json</button>
          <button onClick={reload}>Reload from disk</button>
        </div>
      </nav>
      <div className="settings-main">
        <div className="settings-content">
          <section.Component draft={draft} update={update} notify={setMsg} />
        </div>
        <div className="settings-bar">
          <span className="msg">{msg || (dirty ? "Unsaved changes" : "")}</span>
          <button onClick={discard} disabled={!dirty}>
            Discard
          </button>
          <button className="primary" onClick={save} disabled={!dirty}>
            Save
          </button>
          <button onClick={close}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
