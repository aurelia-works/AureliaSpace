import { useState } from "react";
import { ipc, type Account } from "../../lib/ipc";
import { shortenPath } from "../../lib/format";
import { useConfig } from "../../store/config";
import { useLayout } from "../../store/layout";
import type { SectionProps } from "./registry";

/** Account edits commit straight to config.json (not the page's draft): names are referenced by open panes. */
interface Edit {
  /** Name before editing; null while adding a new account. */
  orig: string | null;
  name: string;
  dir: string;
}

const norm = (p: string) => p.trim().replace(/\/+$/, "") || "/";

async function validate(e: Edit, accounts: Account[]): Promise<string | null> {
  const name = e.name.trim();
  const dir = e.dir.trim();
  if (!name) return "Give the account a name.";
  if (!/^[\w.-]+$/.test(name)) return "Use letters, numbers, dot, dash or underscore in the name.";
  if (accounts.some((a) => a.name !== e.orig && a.name.toLowerCase() === name.toLowerCase())) return `An account named "${name}" already exists.`;
  if (!dir) return "Choose a config folder.";
  if (accounts.some((a) => a.name !== e.orig && norm(a.configDir) === norm(dir))) return "Another account already uses that folder.";
  try {
    await ipc.listDir(dir);
  } catch {
    return "That folder doesn't exist.";
  }
  return null;
}

export function AccountsSection(props: SectionProps) {
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async (next: Account[]) => {
    const live = useConfig.getState().config;
    if (live) await useConfig.getState().save({ ...live, accounts: next });
  };

  const begin = (e: Edit) => {
    setEdit(e);
    setError("");
    setRemoving(null);
  };

  const choose = async () => {
    if (!edit) return;
    const picked = await ipc.pickFolder(edit.dir || "~").catch(() => null);
    if (picked) setEdit({ ...edit, dir: shortenPath(picked), name: edit.name || (picked.split("/").pop() ?? "").replace(/^\./, "") });
  };

  const save = async () => {
    if (!edit || busy) return;
    setBusy(true);
    try {
      const problem = await validate(edit, accounts);
      if (problem) return setError(problem);
      const entry = { name: edit.name.trim(), configDir: edit.dir.trim() };
      await commit(edit.orig === null ? [...accounts, entry] : accounts.map((a) => (a.name === edit.orig ? entry : a)));
      // Open panes remember their account by name; follow a rename so they can still respawn.
      if (edit.orig && edit.orig !== entry.name) {
        useLayout.setState((s) => ({
          panes: Object.fromEntries(Object.entries(s.panes).map(([id, p]) => [id, p.account === edit.orig ? { ...p, account: entry.name } : p])),
        }));
      }
      setEdit(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    try {
      await commit(accounts.filter((a) => a.name !== name));
      setRemoving(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const form = (
    <div className="acct-form">
      <label className="field">
        <span>Name</span>
        <input
          autoFocus
          value={edit?.name ?? ""}
          placeholder="e.g. work"
          onChange={(e) => edit && setEdit({ ...edit, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && save()}
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Config folder</span>
        <div className="field-row">
          <input
            value={edit?.dir ?? ""}
            placeholder="~/.claude-work"
            onChange={(e) => edit && setEdit({ ...edit, dir: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
            spellCheck={false}
          />
          <button type="button" onClick={choose}>
            Choose…
          </button>
        </div>
      </label>
      {error && <p className="set-error">{error}</p>}
      <div className="acct-form-actions">
        <button onClick={() => setEdit(null)}>Cancel</button>
        <button className="primary" disabled={busy} onClick={save}>
          {edit?.orig === null ? "Add account" : "Save account"}
        </button>
      </div>
    </div>
  );

  return (
    <>
    <section className="set-group">
      <h3>Claude accounts</h3>
      <p className="hint">
        Each account is a Claude config folder (<code>CLAUDE_CONFIG_DIR</code>), so you can run several logins side by side.
        Changes apply immediately.
      </p>
      <ul className="acct-list">
        {accounts.map((a) => (
          <li key={a.name}>
            {edit?.orig === a.name ? (
              form
            ) : (
              <div className="acct-row">
                <span className="account-chip">{a.name}</span>
                <code title={a.configDir}>{a.configDir}</code>
                {removing === a.name ? (
                  <span className="acct-confirm">
                    Remove? Open panes keep running.
                    <button className="link-btn danger" onClick={() => remove(a.name)}>
                      Remove
                    </button>
                    <button className="link-btn" onClick={() => setRemoving(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="acct-actions">
                    <button className="link-btn" onClick={() => begin({ orig: a.name, name: a.name, dir: a.configDir })}>
                      Edit
                    </button>
                    <button className="link-btn danger" disabled={accounts.length <= 1} title={accounts.length <= 1 ? "Keep at least one account" : ""} onClick={() => setRemoving(a.name)}>
                      Remove
                    </button>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {edit?.orig === null ? (
        form
      ) : (
        <button className="acct-add" onClick={() => begin({ orig: null, name: "", dir: "" })}>
          + Add account
        </button>
      )}
      {!edit && error && <p className="set-error">{error}</p>}
    </section>
    <AccountDefaults {...props} />
    </>
  );
}

/** Which account new Claude panes start on, globally and per workspace folder. */
function AccountDefaults({ draft, update }: SectionProps) {
  const names = draft.accounts.map((a) => a.name);
  const overrides = Object.entries(draft.workspaceAccounts ?? {});
  const setOverride = (folder: string, account: string | null) =>
    update((c) => {
      const next = { ...(c.workspaceAccounts ?? {}) };
      if (account === null) delete next[folder];
      else next[folder] = account;
      c.workspaceAccounts = next;
    });
  const addOverride = async () => {
    const folder = await ipc.pickFolder().catch(() => null);
    if (folder) setOverride(folder.replace(/\/+$/, ""), draft.defaultAccount || names[0]);
  };
  const select = (value: string, onChange: (v: string) => void, empty?: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );

  return (
    <section className="set-group">
      <h3>Default account</h3>
      <label className="field">
        <span>New conversations</span>
        {select(draft.defaultAccount ?? "", (v) => update((c) => (c.defaultAccount = v)), "First in the list")}
      </label>
      <p className="hint">Pre-selected in the launcher (⌘E) and listed first on the start screen. A workspace override wins inside that folder.</p>
      <ul className="acct-list">
        {overrides.map(([folder, account]) => (
          <li key={folder}>
            <div className="acct-row">
              <code title={folder}>{shortenPath(folder)}</code>
              {select(account, (v) => setOverride(folder, v))}
              <span className="acct-actions">
                <button className="link-btn danger" onClick={() => setOverride(folder, null)}>
                  Remove
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <button className="acct-add" onClick={addOverride}>
        + Workspace override
      </button>
    </section>
  );
}
