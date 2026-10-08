import { useState } from "react";
import { agentVariants, launchCustomAgent, launchTeam, PROVIDERS, variantOf } from "../../lib/agents";
import { shortenPath } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { AGENT_COLORS, useCustomAgents, type AgentTeam, type CustomAgent } from "../../store/customAgents";
import { useUi } from "../../store/ui";
import { AgentAvatar, AgentChip } from "../AgentChip";
import type { SectionProps } from "./registry";

type Draft = Omit<CustomAgent, "id"> & { id?: string };

const blank = (variant: string): Draft => ({
  name: "",
  variant,
  color: "gold",
  instructions: "",
  args: "",
  command: "",
  folder: "",
  worktree: false,
});

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
    <>
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
      {agents.length > 0 && <TeamsGroup agents={agents} notify={notify} />}
    </>
  );
}

const MAX_TEAM = 16;

/** Saved lineups: several agents that open together as a grid in a new tab. */
function TeamsGroup({ agents, notify }: { agents: CustomAgent[]; notify(msg: string): void }) {
  const teams = useCustomAgents((s) => s.teams);
  const [edit, setEdit] = useState<(Omit<AgentTeam, "id"> & { id?: string }) | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const byId = (id: string) => agents.find((a) => a.id === id);
  const count = (id: string) => edit?.agentIds.filter((x) => x === id).length ?? 0;
  const setCount = (id: string, n: number) => {
    if (!edit) return;
    const others = edit.agentIds.filter((x) => x !== id);
    const room = MAX_TEAM - others.length;
    setEdit({
      ...edit,
      agentIds: [...others, ...Array(Math.max(0, Math.min(n, room))).fill(id)],
    });
  };
  const save = () => {
    if (!edit) return;
    if (!edit.name.trim()) return notify("Give the team a name.");
    if (!edit.agentIds.length) return notify("Add at least one agent to the team.");
    // Keep members grouped in the order the agents are listed.
    const ordered = agents.flatMap((a) => edit.agentIds.filter((x) => x === a.id));
    useCustomAgents.getState().saveTeam({ ...edit, agentIds: ordered });
    notify(`${edit.name.trim()} saved.`);
    setEdit(null);
  };
  const launch = (t: AgentTeam) => {
    useUi.getState().set({ settingsOpen: false });
    void launchTeam(t);
  };

  return (
    <section className="set-group">
      <h3>Teams</h3>
      <p className="hint">A team opens all of its agents at once, side by side in a new tab. Up to {MAX_TEAM} panes.</p>
      {teams.length > 0 && (
        <ul className="acct-list">
          {teams.map((t) => (
            <li key={t.id}>
              <div className="acct-row">
                <span className="my-agent-name">{t.name}</span>
                <span className="team-members">
                  {t.agentIds.map((id, i) => {
                    const a = byId(id);
                    return a ? <AgentChip key={i} agent={a} /> : null;
                  })}
                </span>
                {removing === t.id ? (
                  <span className="acct-confirm">
                    Delete {t.name}?
                    <button className="link-btn danger" onClick={() => (useCustomAgents.getState().removeTeam(t.id), setRemoving(null))}>
                      Delete
                    </button>
                    <button className="link-btn" onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="acct-actions">
                    <button className="link-btn" onClick={() => launch(t)}>
                      Launch
                    </button>
                    <button className="link-btn" onClick={() => setEdit({ ...t })}>
                      Edit
                    </button>
                    <button className="link-btn danger" onClick={() => setRemoving(t.id)}>
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
        <div className="acct-form">
          <label className="field">
            <span>Name</span>
            <input
              value={edit.name}
              placeholder="e.g. Ship it: builder + reviewer + tests"
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              autoFocus
            />
          </label>
          {agents.map((a) => (
            <div key={a.id} className="field">
              <span className="team-pick">
                <AgentAvatar agent={a} size={12} />
                {a.name}
              </span>
              <div className="stepper" role="group" aria-label={`${a.name} count`}>
                <button
                  type="button"
                  aria-label={`Fewer ${a.name}`}
                  disabled={count(a.id) === 0}
                  onClick={() => setCount(a.id, count(a.id) - 1)}
                >
                  −
                </button>
                <span className="num">{count(a.id)}</span>
                <button
                  type="button"
                  aria-label={`More ${a.name}`}
                  disabled={count(a.id) >= 4 || edit.agentIds.length >= MAX_TEAM}
                  onClick={() => setCount(a.id, count(a.id) + 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
          <div className="acct-form-actions">
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button className="primary" onClick={save}>
              {edit.id ? "Save" : "Create team"}
            </button>
          </div>
        </div>
      ) : (
        <button className="acct-add" onClick={() => setEdit({ name: "", agentIds: [] })}>
          + New team
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
          <input
            value={edit.command ?? ""}
            placeholder="e.g. aider --model sonnet"
            spellCheck={false}
            onChange={(e) => set({ command: e.target.value })}
          />
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
          <input
            value={edit.args ?? ""}
            placeholder="optional, added after the command"
            spellCheck={false}
            onChange={(e) => set({ args: e.target.value })}
          />
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
          <input
            value={edit.folder ?? ""}
            placeholder="the focused pane's folder"
            spellCheck={false}
            onChange={(e) => set({ folder: e.target.value })}
          />
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
