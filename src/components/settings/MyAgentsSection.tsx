import { useState } from "react";
import { agentVariants, launchCustomAgent, PROVIDERS, variantOf } from "../../lib/agents";
import { shortenPath } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { AGENT_COLORS, useCustomAgents, type CustomAgent } from "../../store/customAgents";
import { useUi } from "../../store/ui";
import { AgentAvatar } from "../AgentChip";
import type { SectionProps } from "./registry";

type Draft = Omit<CustomAgent, "id"> & { id?: string };

const blank = (variant: string): Draft => ({ name: "", variant, color: "gold", instructions: "", args: "", command: "", folder: "", worktree: false });

/** Saved, named agents: pick a CLI, give it a name, colour and instructions, launch it in one click. */
export function MyAgentsSection({ draft: config, notify }: SectionProps) {
  const agents = useCustomAgents((s) => s.agents);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const variants = agentVariants(config.accounts);

  const save = () => {
    if (!edit) return;
    if (!edit.name.trim()) return notify("Give the agent a name.");
    if (edit.variant === "custom" && !edit.command?.trim()) return notify("Type the command this agent runs.");
    useCustomAgents.getState().save(edit);
    notify(`${edit.name.trim()} saved.`);
    setEdit(null);
  };

  const launch = (a: CustomAgent) => {
    useUi.getState().set({ settingsOpen: false });
    void launchCustomAgent(a, "tab");
  };

  return (
    <section className="set-group">
      <h3>My agents</h3>
      <p className="hint">
        Named agents you launch in one click from the start screen, ⌘P, or here. Each one remembers its CLI, colour, instructions and
        starting folder; its name labels its pane, board card and queue row. Saved immediately.
      </p>
      {agents.length > 0 && (
        <ul className="acct-list">
          {agents.map((a) => (
            <li key={a.id}>
              <div className="acct-row">
                <AgentAvatar agent={a} />
                <span className="my-agent-name">{a.name}</span>
                <code>{variantOf(a)?.label ?? "missing CLI or account"}</code>
                {removing === a.id ? (
                  <span className="acct-confirm">
                    Delete {a.name}?
                    <button className="link-btn danger" onClick={() => (useCustomAgents.getState().remove(a.id), setRemoving(null))}>
                      Delete
                    </button>
                    <button className="link-btn" onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="acct-actions">
                    <button className="link-btn" onClick={() => launch(a)}>
                      Launch
                    </button>
                    <button className="link-btn" onClick={() => setEdit({ ...blank(a.variant), ...a })}>
                      Edit
                    </button>
                    <button className="link-btn danger" onClick={() => setRemoving(a.id)}>
                      Delete
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <AgentForm edit={edit} setEdit={setEdit} variants={variants} onSave={save} />
      ) : (
        <button className="acct-add" onClick={() => setEdit(blank(variants[0]?.id ?? "custom"))}>
          + New agent
        </button>
      )}
    </section>
  );
}

function AgentForm({
  edit,
  setEdit,
  variants,
  onSave,
}: {
  edit: Draft;
  setEdit(d: Draft | null): void;
  variants: ReturnType<typeof agentVariants>;
  onSave(): void;
}) {
  const set = (patch: Partial<Draft>) => setEdit({ ...edit, ...patch });
  const variant = variants.find((v) => v.id === edit.variant);
  const isClaude = !!variant?.account;
  const isCustom = edit.variant === "custom";

  return (
    <div className="acct-form">
      <label className="field">
        <span>Name</span>
        <input value={edit.name} placeholder="e.g. Reviewer, Test fixer, Docs" onChange={(e) => set({ name: e.target.value })} autoFocus />
      </label>
      <label className="field">
        <span>Runs</span>
        <select value={edit.variant} onChange={(e) => set({ variant: e.target.value })}>
          {PROVIDERS.filter((p) => p.id !== "custom").map((p) => {
            const group = variants.filter((v) => v.provider === p.id);
            return group.length ? (
              <optgroup key={p.id} label={p.label}>
                {group.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
          <option value="custom">Custom command…</option>
        </select>
      </label>
      {isCustom && (
        <label className="field">
          <span>Command</span>
          <input value={edit.command ?? ""} placeholder="e.g. aider --model sonnet" spellCheck={false} onChange={(e) => set({ command: e.target.value })} />
        </label>
      )}
      {isClaude && (
        <label className="field">
          <span>Instructions</span>
          <textarea
            rows={4}
            value={edit.instructions ?? ""}
            placeholder="e.g. You review code. Don't edit files; list problems by severity with file:line."
            onChange={(e) => set({ instructions: e.target.value })}
          />
        </label>
      )}
      {!isClaude && !isCustom && (
        <label className="field">
          <span>Extra arguments</span>
          <input value={edit.args ?? ""} placeholder="optional, added after the command" spellCheck={false} onChange={(e) => set({ args: e.target.value })} />
        </label>
      )}
      {isClaude && <p className="hint">Added to Claude Code's system prompt for every session this agent starts.</p>}
      <div className="field">
        <span>Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Colour">
          {AGENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={edit.color === c}
              aria-label={c}
              className={`swatch c-${c}${edit.color === c ? " on" : ""}`}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
      </div>
      <label className="field">
        <span>Starting folder</span>
        <div className="field-row">
          <input value={edit.folder ?? ""} placeholder="the focused pane's folder" spellCheck={false} onChange={(e) => set({ folder: e.target.value })} />
          <button
            type="button"
            onClick={async () => {
              const picked = await ipc.pickFolder(edit.folder || "~").catch(() => null);
              if (picked) set({ folder: shortenPath(picked) });
            }}
          >
            Choose…
          </button>
        </div>
      </label>
      <label className="field check">
        <input type="checkbox" checked={!!edit.worktree} onChange={(e) => set({ worktree: e.target.checked })} />
        <span>Start in its own git worktree</span>
      </label>
      <div className="acct-form-actions">
        <button onClick={() => setEdit(null)}>Cancel</button>
        <button className="primary" onClick={onSave}>
          {edit.id ? "Save" : "Create agent"}
        </button>
      </div>
    </div>
  );
}
