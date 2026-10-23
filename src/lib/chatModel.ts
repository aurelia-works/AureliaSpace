/**
 * The conversation a chat pane shows, built from Claude Code's stream-json lines
 * (src-tauri/src/chat.rs forwards them as `raw` events) and from transcript lines when a
 * chat resumes. Pure, so it can be tested on recorded lines.
 *
 * A message streams in as `stream_event`s (block start, deltas, stop), and each finished
 * block also arrives as an `assistant` line, which wins over what was streamed. Lines with
 * a `parent_tool_use_id` belong to a subagent and only count towards its Task call.
 */

export type ChatItem = (
  | { kind: "user"; id: string; text: string; images?: string[]; uuid?: string }
  | { kind: "text"; id: string; msg?: string; text: string; done: boolean; final?: boolean }
  | { kind: "thinking"; id: string; msg?: string; text: string; done: boolean; final?: boolean }
  | {
      kind: "tool";
      id: string;
      toolId: string;
      name: string;
      input: Record<string, unknown>;
      /** Input JSON as it streams, before the finished block replaces it. */
      partial: string;
      result?: string;
      isError?: boolean;
      /** Tool calls a subagent made under this one (Task / Agent). */
      steps: number;
      /** Those calls, latest last (capped), so the agent's progress can be shown. */
      sub?: { name: string; input: Json }[];
    }
  | { kind: "turn"; id: string; outcome: "completed" | "interrupted" | "failed"; error?: string; usage?: Usage; files: string[]; ms?: number }
  | { kind: "notice"; id: string; text: string; error?: boolean }
) & {
  /** When it happened (ms since epoch), if known: sent messages, and transcript lines with a timestamp. */
  at?: number;
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  contextTokens?: number | null;
  contextWindow?: number | null;
}

export interface Transcript {
  items: ChatItem[];
  /** Item id of each block of the message streaming now, by block index. */
  open: Record<number, string>;
  msg?: string;
  /** Files edited since the last turn ended. */
  files: string[];
  seq: number;
  /** The timestamp of the line being applied, stamped on the items it adds. */
  now?: number;
}

export const emptyTranscript = (): Transcript => ({ items: [], open: {}, files: [], seq: 0 });

/** Tools whose input names a file they change. */
const EDIT_TOOLS: Record<string, string> = { Edit: "file_path", MultiEdit: "file_path", Write: "file_path", NotebookEdit: "notebook_path" };

type Json = Record<string, any>;

function nextId(t: Transcript) {
  t.seq += 1;
  return `c${t.seq}`;
}

function update(t: Transcript, id: string, f: (item: any) => ChatItem): Transcript {
  return { ...t, items: t.items.map((i) => (i.id === id ? f(i) : i)) };
}

type NewItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> & { id?: string } : never) : never;

function push(t: Transcript, item: NewItem): Transcript {
  const id = item.id ?? nextId(t);
  return { ...t, items: [...t.items, { at: t.now, ...item, id } as ChatItem] };
}

function noteEdit(t: Transcript, name: string, input: Json | undefined): Transcript {
  const key = EDIT_TOOLS[name];
  const path = key && typeof input?.[key] === "string" ? (input[key] as string) : null;
  return path && !t.files.includes(path) ? { ...t, files: [...t.files, path] } : t;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : c?.type === "image" ? "[image]" : null))
    .filter((c) => c !== null)
    .join("\n");
}

/**
 * A user line as the chat shows it. Claude Code also writes its own lines as "user":
 * slash commands, background-task reports, interrupts, image notes, compaction summaries.
 * Those become quiet notices, or nothing.
 */
export function userLine(text: string): { kind: "user" | "notice"; text: string } | null {
  const t = text.trim();
  if (!t || t.startsWith("[Request interrupted by user") || t.startsWith("[Image: ") || t.startsWith("<local-command-") || t.startsWith("<system-reminder>")) return null;
  const tag = (name: string) => t.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim();
  if (t.startsWith("<command-name>") || t.startsWith("<command-message>")) {
    const cmd = tag("command-name") ?? tag("command-message");
    return cmd ? { kind: "notice", text: [cmd, tag("command-args")].filter(Boolean).join(" ") } : null;
  }
  if (t.startsWith("<task-notification>")) return { kind: "notice", text: `Background task: ${tag("summary") ?? tag("status") ?? "finished"}` };
  if (t.startsWith("This session is being continued from a previous conversation")) return { kind: "notice", text: "Continued from a summary of the earlier conversation" };
  return { kind: "user", text: t };
}

function pushUser(t: Transcript, text: string, images: string[] = [], uuid?: string): Transcript {
  const line = userLine(text) ?? (images.length ? { kind: "user" as const, text: "" } : null);
  if (!line) return t;
  if (line.kind === "notice") return push(t, { kind: "notice", text: line.text });
  return push(t, { kind: "user", text: line.text, ...(images.length && { images }), ...(uuid && { uuid }) });
}

/** Pasted images in a user message, as data URLs for the bubble. */
function imagesOf(content: Json[]): string[] {
  return content
    .filter((c) => c?.type === "image" && c.source?.type === "base64" && typeof c.source.data === "string")
    .map((c) => `data:${c.source.media_type ?? "image/png"};base64,${c.source.data}`);
}

function findTool(t: Transcript, toolId: string) {
  for (let i = t.items.length - 1; i >= 0; i--) {
    const it = t.items[i];
    if (it.kind === "tool" && it.toolId === toolId) return it;
  }
  return undefined;
}

/** Shows a message the user sent (the CLI doesn't echo them back). */
export function addUser(t: Transcript, text: string, at = Date.now(), extra: { images?: string[]; uuid?: string } = {}): Transcript {
  return push({ ...t }, { kind: "user", text, at, ...(extra.images?.length && { images: extra.images }), ...(extra.uuid && { uuid: extra.uuid }) });
}

export function addNotice(t: Transcript, text: string, error = false): Transcript {
  return push({ ...t }, { kind: "notice", text, error });
}

/** Ends the turn: the outcome, its usage and the files it changed. */
export function endTurn(
  t: Transcript,
  outcome: "completed" | "interrupted" | "failed",
  error?: string | null,
  usage?: Usage | null,
  ms?: number | null,
): Transcript {
  // Whatever was still streaming is as finished as it gets.
  const items = t.items.map((i) => ((i.kind === "text" || i.kind === "thinking") && !i.done ? { ...i, done: true } : i));
  const next = push({ ...t, items, open: {} }, { kind: "turn", outcome, error: error ?? undefined, usage: usage ?? undefined, files: t.files, ms: ms ?? undefined, at: Date.now() });
  return { ...next, files: [] };
}

const SUB_KEEP = 100;

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

/** Claude's current todo list: the input of its latest TodoWrite call, or null if it never made one. */
export function latestTodos(items: ChatItem[]): Todo[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && it.name === "TodoWrite" && Array.isArray(it.input.todos)) {
      return (it.input.todos as Json[])
        .filter((x) => typeof x?.content === "string")
        .map((x) => ({ content: x.content, status: x.status === "completed" || x.status === "in_progress" ? x.status : "pending", activeForm: x.activeForm }));
    }
  }
  return null;
}

export function applyLine(t0: Transcript, m: Json): Transcript {
  const stamp = typeof m.timestamp === "string" ? Date.parse(m.timestamp) : NaN;
  let t: Transcript = { ...t0, now: Number.isNaN(stamp) ? undefined : stamp };
  const parent = m.parent_tool_use_id;
  if (parent) {
    // A subagent's own work: count its tool calls on the Task that started it.
    const task = findTool(t, parent);
    const calls: Json[] = m.type === "assistant" ? (m.message?.content ?? []).filter((c: Json) => c?.type === "tool_use") : [];
    if (!task || !calls.length) return t;
    const more = calls.map((c) => ({ name: String(c.name), input: c.input ?? {} }));
    return update(t, task.id, (i) => (i.kind === "tool" ? { ...i, steps: i.steps + calls.length, sub: [...(i.sub ?? []), ...more].slice(-SUB_KEEP) } : i));
  }

  if (m.type === "stream_event") {
    const ev = m.event ?? {};
    switch (ev.type) {
      case "message_start":
        return { ...t, msg: ev.message?.id, open: {} };
      case "content_block_start": {
        const cb = ev.content_block ?? {};
        const id = nextId(t);
        if (cb.type === "text") t = push(t, { id, kind: "text", msg: t.msg, text: cb.text ?? "", done: false });
        else if (cb.type === "thinking") t = push(t, { id, kind: "thinking", msg: t.msg, text: cb.thinking ?? "", done: false });
        else if (cb.type === "tool_use" || cb.type === "server_tool_use")
          t = push(t, { id, kind: "tool", toolId: cb.id, name: cb.name, input: {}, partial: "", steps: 0 });
        else return t;
        return { ...t, open: { ...t.open, [ev.index]: id } };
      }
      case "content_block_delta": {
        const id = t.open[ev.index];
        const d = ev.delta ?? {};
        if (!id) return t;
        if (d.type === "text_delta") return update(t, id, (i) => ({ ...i, text: i.text + (d.text ?? "") }));
        if (d.type === "thinking_delta") return update(t, id, (i) => ({ ...i, text: i.text + (d.thinking ?? "") }));
        if (d.type === "input_json_delta") return update(t, id, (i) => ({ ...i, partial: i.partial + (d.partial_json ?? "") }));
        return t;
      }
      case "content_block_stop": {
        const id = t.open[ev.index];
        return id ? update(t, id, (i) => (i.kind === "tool" ? i : { ...i, done: true })) : t;
      }
      default:
        return t;
    }
  }

  if (m.type === "assistant") {
    // Claude Code's own stand-in after an interrupted turn ("No response requested."), not Claude's words.
    if (m.message?.model === "<synthetic>") return t;
    const msg = m.message?.id;
    for (const c of m.message?.content ?? []) {
      if (c?.type === "tool_use" || c?.type === "server_tool_use") {
        const input = (c.input ?? {}) as Json;
        const known = findTool(t, c.id);
        t = known ? update(t, known.id, (i) => ({ ...i, input, partial: "" })) : push(t, { kind: "tool", toolId: c.id, name: c.name, input, partial: "", steps: 0 });
        t = noteEdit(t, c.name, input);
      } else if (c?.type === "text" || c?.type === "thinking") {
        const text: string = (c.type === "text" ? c.text : c.thinking) ?? "";
        // The streamed block it finishes: same message, same kind, not finished by a line yet.
        const open = Object.values(t.open)
          .map((id) => t.items.find((i) => i.id === id))
          .find((i) => (i?.kind === "text" || i?.kind === "thinking") && i.kind === c.type && i.msg === msg && !i.final);
        if (open) t = update(t, open.id, (i) => ({ ...i, text: text || i.text, final: true }));
        else if (text.trim()) t = push(t, { kind: c.type, msg, text, done: true });
      }
    }
    return t;
  }

  if (m.type === "user") {
    const content = m.message?.content;
    const uuid = typeof m.uuid === "string" ? m.uuid : undefined;
    if (typeof content === "string") return pushUser(t, content, [], uuid);
    if (!Array.isArray(content)) return t;
    for (const c of content) {
      if (c?.type !== "tool_result") continue;
      const tool = findTool(t, c.tool_use_id);
      if (tool) t = update(t, tool.id, (i) => ({ ...i, result: textOf(c.content), isError: !!c.is_error }));
    }
    return pushUser(t, textOf(content.filter((c) => c?.type === "text")), imagesOf(content), uuid);
  }

  return t;
}

/** Short one-line summary of a tool call, e.g. `Bash  npm test` or `Edit  src/app.ts`. */
export function toolSummary(_name: string, input: Record<string, unknown>, cwd?: string): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const rel = (p: string) => (cwd && p.startsWith(cwd.replace(/\/+$/, "") + "/") ? p.slice(cwd.replace(/\/+$/, "").length + 1) : p);
  const first =
    s("command") ||
    rel(s("file_path") || s("notebook_path") || s("path")) ||
    s("pattern") ||
    s("url") ||
    s("query") ||
    s("description") ||
    s("prompt") ||
    s("skill");
  return first.split("\n")[0];
}

/**
 * The conversation as the chat draws it: each user message, then one block of Claude's
 * work up to the next message. A block's activity (thinking, tool calls, notes between
 * them) folds away under "Worked for…"; its answer is the text after the last tool call.
 * Split at user messages, not turn ends: a resumed chat's history has no turn ends.
 */
export type Segment =
  | { kind: "user"; item: Extract<ChatItem, { kind: "user" }> }
  | { kind: "notice"; item: Extract<ChatItem, { kind: "notice" }> }
  | {
      kind: "work";
      id: string;
      activity: ChatItem[];
      answer: Extract<ChatItem, { kind: "text" }>[];
      end?: Extract<ChatItem, { kind: "turn" }>;
      /** The message it answers was sent at, and the last thing in it happened at. */
      startAt?: number;
      lastAt?: number;
      /** That message's uuid, which Claude Code's file checkpoints go by. */
      from?: string;
    };

export function segments(items: ChatItem[]): Segment[] {
  const out: Segment[] = [];
  let run: ChatItem[] = [];
  let startAt: number | undefined;
  let from: string | undefined;
  const close = () => {
    if (!run.length) return;
    const end = run.at(-1)?.kind === "turn" ? (run.pop() as Extract<ChatItem, { kind: "turn" }>) : undefined;
    let cut = run.length;
    while (cut > 0 && run[cut - 1].kind === "text") cut--;
    const lastAt = [...run].reverse().find((i) => i.at !== undefined)?.at;
    out.push({
      kind: "work",
      id: (run[0] ?? end)!.id,
      activity: run.slice(0, cut),
      answer: run.slice(cut) as Extract<ChatItem, { kind: "text" }>[],
      end,
      startAt,
      lastAt,
      from,
    });
    run = [];
  };
  for (const item of items) {
    if (item.kind === "user") {
      close();
      out.push({ kind: "user", item });
      startAt = item.at;
      from = item.uuid;
    } else if (item.kind === "notice") {
      close();
      out.push({ kind: "notice", item });
    } else {
      run.push(item);
      if (item.kind === "turn") close();
    }
  }
  close();
  return out;
}

/** Lines added and removed per file by the edits in `items` that went through, from the tool inputs. */
export function fileStats(items: ChatItem[]): Record<string, { added: number; removed: number }> {
  const stats: Record<string, { added: number; removed: number }> = {};
  for (const [path, hunks] of Object.entries(turnEdits(items)))
    stats[path] = hunks.reduce((s, h) => ({ added: s.added + h.added.length, removed: s.removed + h.removed.length }), { added: 0, removed: 0 });
  return stats;
}

/** One change in a file: the lines Claude's edit took out and put in (shared lines trimmed). */
export interface Hunk {
  removed: string[];
  added: string[];
}

/** The changes these items made, per file, from the edit tools' inputs (only calls that ran). */
export function turnEdits(items: ChatItem[]): Record<string, Hunk[]> {
  const edits: Record<string, Hunk[]> = {};
  const lines = (v: unknown) => (typeof v === "string" && v ? v.split("\n") : []);
  const add = (path: string, before: unknown, after: unknown) => {
    const a = lines(before);
    const b = lines(after);
    // Lines both sides share at the start and end aren't changes.
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    edits[path].push({ removed: a.slice(head, a.length - tail), added: b.slice(head, b.length - tail) });
  };
  for (const i of items) {
    // No result: denied, or the chat stopped before it ran.
    if (i.kind !== "tool" || i.result === undefined || i.isError) continue;
    const path = i.input[EDIT_TOOLS[i.name]];
    if (typeof path !== "string") continue;
    edits[path] ??= [];
    if (i.name === "Edit") add(path, i.input.old_string, i.input.new_string);
    else if (i.name === "MultiEdit" && Array.isArray(i.input.edits)) for (const e of i.input.edits as Json[]) add(path, e.old_string, e.new_string);
    else if (i.name === "Write") add(path, "", i.input.content);
  }
  return edits;
}
