/**
 * One line for a run of tool calls, the way a person would say it: "Ran 2 commands, edited
 * 3 files and 4 more". Commands, edits and agents lead; reads and searches come after. No
 * imports, so it runs under `node --test`.
 */

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

type Kind = { order: number; say: (n: number) => string; key?: (input: Record<string, unknown>) => unknown };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const path = (i: Record<string, unknown>) => i.file_path ?? i.notebook_path ?? i.path;

const KINDS: Record<string, Kind> = {
  command: { order: 0, say: (n) => `ran ${plural(n, "command")}` },
  edit: { order: 1, say: (n) => `edited ${plural(n, "file")}`, key: path },
  agent: { order: 2, say: (n) => `started ${plural(n, "agent")}` },
  read: { order: 3, say: (n) => `read ${plural(n, "file")}`, key: path },
  search: { order: 4, say: (n) => `searched ${plural(n, "time")}` },
  web: { order: 5, say: (n) => `looked up ${plural(n, "page")}` },
};

const KIND_OF: Record<string, string> = {
  Bash: "command",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Task: "agent",
  Agent: "agent",
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebFetch: "web",
  WebSearch: "web",
};

export function toolPhrase(tools: ToolCall[], max = 2): string {
  const counts = new Map<string, Set<unknown>>();
  let other = 0;
  tools.forEach((t, i) => {
    const kind = KIND_OF[t.name];
    if (!kind) return void other++;
    // Files count once however often they're touched; everything else counts each call.
    const id = KINDS[kind].key?.(t.input) ?? i;
    if (!counts.has(kind)) counts.set(kind, new Set());
    counts.get(kind)!.add(id);
  });
  const parts = [...counts].sort(([a], [b]) => KINDS[a].order - KINDS[b].order).map(([k, ids]) => ({ k, n: ids.size }));
  const shown = parts.slice(0, max).map(({ k, n }) => KINDS[k].say(n));
  const rest = parts.slice(max).reduce((n, p) => n + p.n, 0) + other;
  let line = shown.join(", ");
  if (rest) line = line ? `${line} and ${rest} more` : plural(rest, "tool");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
