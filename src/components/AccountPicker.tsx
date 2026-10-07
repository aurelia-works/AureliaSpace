import { useEffect, useMemo, useState } from "react";
import { accountForFolder } from "../lib/handoff";
import { agentVariants, customVariant, launchAgents, providerById, type AgentVariant } from "../lib/agents";
import { basename, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { launchClaude } from "../lib/launch";
import { queueInit } from "../lib/terminals";
import { useConfig } from "../store/config";
import { focusedPaneId, useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { toast, useUi } from "../store/ui";
import { useUsage } from "../store/usage";
import { AgentLogo } from "./AgentLogos";
import { UsageMeter } from "./UsageMeter";

const MAX_PER_AGENT = 12;
const CUSTOM_KEY = "aurelia.customAgent";

const readCustom = () => {
  try {
    return localStorage.getItem(CUSTOM_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Agent launcher: pick coding-agent CLIs and how many of each, then open them as panes. */
export function AccountPicker() {
  const picker = useUi((s) => s.accountPicker);
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const workspace = useConfig((s) => s.config?.defaultWorkspace);
  const worktree = useUi((s) => s.useWorktree);
  const recents = useRecents((s) => s.folders);
  const usage = useUsage((s) => s.usage);
  const fetchedAt = useUsage((s) => s.fetchedAt);
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState(readCustom);
  const [folder, setFolder] = useState<string | undefined>();
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<string[]>([]);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(0);

  const task = picker?.task;
  const variants = useMemo(() => {
    const all = [...agentVariants(accounts), customVariant(custom)];
    return task ? all.filter((x) => x.account) : all;
  }, [accounts, custom, task]);

  useEffect(() => {
    if (!picker) return;
    setCounts({});
    setKeyDraft("");
    setBusy(false);
    const from = focusedPaneId();
    const dir = useLayout.getState().panes[from ?? ""]?.cwd || workspace || undefined;
    setFolder(dir);
    // Start on the folder's preferred account (workspace override, else the default).
    const preferred = accountForFolder(dir);
    setIndex(Math.max(0, variants.findIndex((v) => preferred && v.account === preferred)));
    accounts.forEach((a) => useUsage.getState().refresh(a.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);

  // Detect installed CLIs and saved keys; `scan` re-runs it after an install.
  useEffect(() => {
    if (!picker) return;
    let alive = true;
    const bins = [...new Set(variants.filter((x) => !x.custom).map((x) => x.tool.bin))];
    Promise.all(bins.map((b) => ipc.which(b).catch(() => false).then((ok) => [b, ok] as const))).then(
      (r) => alive && setInstalled(Object.fromEntries(r)),
    );
    const ids = [...new Set(variants.flatMap((x) => x.secrets.map((s) => s.key.id)))];
    ipc.agentKeysPresent(ids).then((r) => alive && setKeys(r), () => {});
    return () => {
      alive = false;
    };
  }, [picker, variants, scan]);

  if (!picker) return null;
  const close = () => useUi.getState().set({ accountPicker: null });
  const { target } = picker;
  const setTarget = (t: "split" | "tab") => useUi.getState().set({ accountPicker: { target: t, task } });
  const toggleWorktree = () => useUi.getState().set({ useWorktree: !worktree });

  const isInstalled = (x: AgentVariant) => x.custom || installed[x.tool.bin] !== false;
  const missingKey = (x: AgentVariant) => x.secrets.find((s) => !keys.includes(s.key.id));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sel = variants[index];

  const setCount = (id: string, n: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, Math.min(MAX_PER_AGENT, n)) }));

  const launch = async (items: { variant: AgentVariant; count: number }[], where = target) => {
    if (busy || !items.length) return;
    for (const { variant } of items) {
      if (variant.custom && !custom.trim()) return toast("Type a command for the custom agent", true);
      if (!isInstalled(variant)) return toast(`${variant.label}: ${variant.tool.bin} is not installed. Install it first.`, true);
      const key = missingKey(variant);
      if (key) {
        setIndex(variants.indexOf(variant));
        return toast(`${variant.label} needs a ${key.key.label}`, true);
      }
    }
    setBusy(true);
    close();
    if (task) {
      launchClaude({ account: items[0].variant.account!, where, worktree, task });
      return;
    }
    if (custom.trim()) {
      try {
        localStorage.setItem(CUSTOM_KEY, custom.trim());
      } catch {
        /* ignore */
      }
    }
    await launchAgents(items.map((i) => ({ ...i, custom })), where, folder, worktree);
  };

  const launchSelected = (where = target) => {
    const chosen = variants.filter((x) => (counts[x.id] ?? 0) > 0).map((x) => ({ variant: x, count: counts[x.id] }));
    if (chosen.length) launch(chosen, where);
    else if (sel) launch([{ variant: sel, count: 1 }], where);
  };

  const browse = async () => {
    const picked = await ipc.pickFolder(folder).catch(() => null);
    if (picked) setFolder(picked);
  };

  const saveKey = async (id: string) => {
    if (!keyDraft.trim()) return;
    try {
      await ipc.setAgentKey(id, keyDraft);
      setKeys((k) => [...new Set([...k, id])]);
      setKeyDraft("");
    } catch (e) {
      toast(`Couldn't save key: ${e}`, true);
    }
  };

  const removeKey = async (id: string) => {
    await ipc.setAgentKey(id, "").catch(() => {});
    setKeys((k) => k.filter((x) => x !== id));
  };

  const runInstall = (cmd: string) => {
    close();
    const id = useLayout.getState().newTab({ cwd: folder });
    queueInit(id, cmd);
    toast("Installing in a new tab. Reopen the launcher when it finishes.");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
      if (e.key === "Enter" && e.target.dataset.role === "key" && sel?.secrets.length) {
        const k = missingKey(sel);
        if (k) saveKey(k.key.id);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "w" && !e.metaKey) toggleWorktree();
    else if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, variants.length - 1));
    else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
    else if (!task && (e.key === "ArrowRight" || e.key === "+" || e.key === "=") && sel) setCount(sel.id, (counts[sel.id] ?? 0) + 1);
    else if (!task && (e.key === "ArrowLeft" || e.key === "-") && sel) setCount(sel.id, (counts[sel.id] ?? 0) - 1);
    else if (e.key === "Tab") setTarget(target === "split" ? "tab" : "split");
    else if (e.key === "Enter") launchSelected(e.shiftKey ? (target === "split" ? "tab" : "split") : target);
    else if (/^[1-9]$/.test(e.key) && variants[Number(e.key) - 1] && !variants[Number(e.key) - 1].custom)
      launch([{ variant: variants[Number(e.key) - 1], count: 1 }]);
    else return;
    e.preventDefault();
  };

  const shownRecents = recents.filter((r) => r !== folder).slice(0, 5);

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal picker agent-launcher" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="modal-head">
          <h2>{task ? "Start task with Claude as…" : "Launch agents"}</h2>
          <div className="seg">
            <button className={target === "split" ? "on" : ""} onClick={() => setTarget("split")} title="Only used when launching a single agent">
              Split
            </button>
            <button className={target === "tab" ? "on" : ""} onClick={() => setTarget("tab")}>
              New tab
            </button>
          </div>
        </div>
        {task && <div className="picker-task">◆ {task.title}</div>}
        {!task && (
          <div className="launch-folder">
            <span className="launch-folder-label">Folder</span>
            <span className="launch-folder-path" title={folder}>
              {folder ? shortenPath(folder) : "inherited from the focused pane"}
            </span>
            <button className="start-link" onClick={browse}>
              Choose…
            </button>
            {shownRecents.length > 0 && (
              <span className="launch-recents">
                {shownRecents.map((r) => (
                  <button key={r} className="chip" title={r} onClick={() => setFolder(r)}>
                    {basename(r)}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        <label className="picker-option">
          <input type="checkbox" checked={worktree} onChange={toggleWorktree} />
          <span>
            Own git worktree <span className="hint inline">new branch from HEAD, so parallel agents don't collide · W</span>
          </span>
        </label>
        <ul className="picker-list launch-list">
          {variants.map((x, i) => {
            const n = counts[x.id] ?? 0;
            const ok = isInstalled(x);
            const needsKey = missingKey(x);
            return (
              <li key={x.id}>
                <div
                  className={`launch-row${i === index ? " sel" : ""}${ok ? "" : " dim"}${n > 0 ? " picked" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => (task ? launch([{ variant: x, count: 1 }]) : setCount(x.id, n > 0 ? 0 : 1))}
                >
                  <span className="picker-key">{i < 9 && !x.custom ? i + 1 : ""}</span>
                  <span className="launch-logo">
                    <AgentLogo logo={providerById(x.provider).logo} />
                  </span>
                  <span className="launch-main">
                    <span className="picker-name">{x.label}</span>
                    <span className="launch-note">
                      {x.account ? shortenPath(accounts.find((a) => a.name === x.account)?.configDir) : x.note}
                      {!ok && " · not installed"}
                      {ok && needsKey && " · key needed"}
                    </span>
                  </span>
                  {x.account && <UsageMeter usage={fetchedAt[x.account] ? usage[x.account] : undefined} />}
                  {!task && (
                    <span className="stepper" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setCount(x.id, n - 1)} disabled={n === 0} aria-label="Fewer">
                        −
                      </button>
                      <span className={n > 0 ? "on" : ""}>{n}</span>
                      <button onClick={() => setCount(x.id, n + 1)} disabled={n >= MAX_PER_AGENT} aria-label="More">
                        +
                      </button>
                    </span>
                  )}
                </div>
                {i === index && x.custom && (
                  <div className="launch-detail">
                    <input
                      className="launch-input"
                      placeholder="e.g. aider --model sonnet"
                      spellCheck={false}
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                  </div>
                )}
                {i === index && !ok && (
                  <div className="launch-detail">
                    <code className="launch-cmd">{x.tool.install}</code>
                    <button className="start-link" onClick={() => navigator.clipboard.writeText(x.tool.install).then(() => toast("Install command copied"))}>
                      Copy
                    </button>
                    <button className="start-link" onClick={() => runInstall(x.tool.install)}>
                      Run in new tab
                    </button>
                    <button className="start-link" onClick={() => setScan((n) => n + 1)}>
                      Recheck
                    </button>
                    <button className="start-link" onClick={() => ipc.openUrl(x.tool.docs)}>
                      Docs
                    </button>
                  </div>
                )}
                {i === index && ok && x.secrets.map((s) =>
                  keys.includes(s.key.id) ? (
                    <div className="launch-detail" key={s.env}>
                      <span className="launch-note">{s.key.label} saved in the Keychain</span>
                      <button className="start-link" onClick={() => removeKey(s.key.id)}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="launch-detail" key={s.env}>
                      <input
                        className="launch-input"
                        data-role="key"
                        type="password"
                        placeholder={`${s.key.label} (stored in the macOS Keychain)`}
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        autoComplete="off"
                      />
                      <button className="start-link" onClick={() => saveKey(s.key.id)}>
                        Save
                      </button>
                      <button className="start-link" onClick={() => ipc.openUrl(s.key.url)}>
                        Get a key
                      </button>
                    </div>
                  ),
                )}
              </li>
            );
          })}
        </ul>
        <div className="modal-foot actions">
          <span className="msg">
            {task
              ? "↑↓ select · ↵ open · Tab toggles target"
              : `↑↓ select · ←→ count (max ${MAX_PER_AGENT} each) · ↵ launch · Tab toggles target${total > 1 ? " · several agents open in a new tab grid" : ""}`}
          </span>
          {!task && (
            <button className="primary" onClick={() => launchSelected()} disabled={busy || (total === 0 && !sel)}>
              {total > 0 ? `Launch ${total} agent${total > 1 ? "s" : ""}` : "Launch selected"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
