import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, applyLine, emptyTranscript, endTurn, fileStats, latestTodos, segments, toolSummary, userLine, type Transcript } from "./chatModel.ts";

const run = (lines: object[], t: Transcript = emptyTranscript()) => lines.reduce<Transcript>((acc, l) => applyLine(acc, l), t);

// Trimmed from a claude 2.1.309 stream-json run.
const se = (event: object) => ({ type: "stream_event", event, parent_tool_use_id: null });

test("streamed text grows with deltas and the assistant line finishes it", () => {
  let t = run([
    se({ type: "message_start", message: { id: "m1" } }),
    se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
  ]);
  assert.deepEqual(
    t.items.map((i) => [i.kind, (i as any).text, (i as any).done]),
    [["text", "Hello", false]],
  );
  t = run(
    [
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello!" }] }, parent_tool_use_id: null },
      se({ type: "content_block_stop", index: 0 }),
    ],
    t,
  );
  assert.equal(t.items.length, 1, "the finished line replaces, never duplicates");
  assert.equal((t.items[0] as any).text, "Hello!");
  assert.equal((t.items[0] as any).done, true);
});

test("a tool call gets its input, its result and counts as an edit", () => {
  const t = run([
    se({ type: "message_start", message: { id: "m1" } }),
    se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "Edit" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"file_pa' } }),
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "toolu_1", name: "Edit", input: { file_path: "/p/a.ts" } }] }, parent_tool_use_id: null },
    se({ type: "content_block_stop", index: 0 }),
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false }] }, parent_tool_use_id: null },
  ]);
  assert.equal(t.items.length, 1);
  const tool = t.items[0] as any;
  assert.deepEqual([tool.name, tool.input.file_path, tool.partial, tool.result, tool.isError], ["Edit", "/p/a.ts", "", "ok", false]);
  assert.deepEqual(t.files, ["/p/a.ts"]);

  const ended = endTurn(t, "completed", null, null);
  const turn = ended.items.at(-1) as any;
  assert.deepEqual([turn.kind, turn.files], ["turn", ["/p/a.ts"]]);
  assert.deepEqual(ended.files, [], "the next turn starts with no files");
});

test("subagent lines only count steps on their Task", () => {
  let t = run([{ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "task_1", name: "Task", input: { description: "look" } }] }, parent_tool_use_id: null }]);
  t = run(
    [
      { type: "assistant", message: { id: "s1", content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] }, parent_tool_use_id: "task_1" },
      { type: "assistant", message: { id: "s2", content: [{ type: "text", text: "found it" }] }, parent_tool_use_id: "task_1" },
    ],
    t,
  );
  assert.equal(t.items.length, 1);
  assert.equal((t.items[0] as any).steps, 1);
});

test("history lines (no stream events) build the same conversation", () => {
  const t = run([
    { type: "user", message: { role: "user", content: "hi" } },
    { type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "" }] } },
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hello" }] } },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "again" }] } },
  ]);
  assert.deepEqual(
    t.items.map((i) => [i.kind, (i as any).text]),
    [
      ["user", "hi"],
      ["text", "hello"],
      ["user", "again"],
    ],
  );
});

test("Claude Code's stand-in replies after an interrupt are left out", () => {
  const t = run([{ type: "assistant", message: { id: "s", model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } }]);
  assert.equal(t.items.length, 0);
});

test("sent messages show up and ids stay unique", () => {
  const t = addUser(addUser(emptyTranscript(), "one"), "two");
  assert.notEqual(t.items[0].id, t.items[1].id);
});

test("tool summaries pick the useful field, relative to the folder", () => {
  assert.equal(toolSummary("Bash", { command: "npm test\nmore" }), "npm test");
  assert.equal(toolSummary("Edit", { file_path: "/p/src/a.ts" }, "/p"), "src/a.ts");
  assert.equal(toolSummary("Grep", { pattern: "TODO" }), "TODO");
});

test("Claude Code's own user lines become notices or nothing", () => {
  assert.equal(userLine("[Request interrupted by user]"), null);
  assert.equal(userLine("[Image: original 2880x1800, displayed at 2000x1250.]"), null);
  assert.deepEqual(userLine("<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"), { kind: "notice", text: "/clear" });
  assert.deepEqual(userLine("<task-notification>\n<task-id>b1</task-id>\n<summary>Build finished</summary>\n</task-notification>"), {
    kind: "notice",
    text: "Background task: Build finished",
  });
  assert.deepEqual(userLine("  fix the bug  "), { kind: "user", text: "fix the bug" });
});

test("image tool results say so instead of showing nothing", () => {
  const t = run([
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.png" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: {} }] }] } },
  ]);
  assert.equal((t.items[0] as any).result, "[image]");
});

test("a turn folds its tool calls away and keeps the text after the last one as the answer", () => {
  let t = addUser(emptyTranscript(), "fix it", 1000);
  t = run(
    [
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Looking." }] } },
      { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
      { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Done." }] } },
    ],
    t,
  );
  t = endTurn(t, "completed", null, null, 4200);
  const segs = segments(t.items);
  assert.deepEqual(
    segs.map((s) => s.kind),
    ["user", "work"],
  );
  const work = segs[1] as Extract<(typeof segs)[number], { kind: "work" }>;
  assert.deepEqual(
    work.activity.map((i) => i.kind),
    ["text", "tool"],
  );
  assert.deepEqual(
    work.answer.map((i) => i.text),
    ["Done."],
  );
  assert.equal(work.end?.ms, 4200);
  assert.equal(work.startAt, 1000);
});

test("resumed history (no turn ends) still splits at each message, timed from its timestamps", () => {
  const t = run([
    { type: "user", message: { role: "user", content: "one" }, timestamp: "2026-10-23T10:00:00.000Z" },
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] }, timestamp: "2026-10-23T10:00:05.000Z" },
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "a" }] }, timestamp: "2026-10-23T10:00:30.000Z" },
    { type: "user", message: { role: "user", content: "two" }, timestamp: "2026-10-23T10:01:00.000Z" },
    { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "b" }] }, timestamp: "2026-10-23T10:01:02.000Z" },
  ]);
  const segs = segments(t.items);
  assert.deepEqual(
    segs.map((s) => s.kind),
    ["user", "work", "user", "work"],
  );
  const first = segs[1] as Extract<(typeof segs)[number], { kind: "work" }>;
  assert.equal(first.end, undefined);
  assert.equal(first.lastAt! - first.startAt!, 30_000);
  assert.equal((segs[3] as any).activity.length, 0, "an answer with no tool calls has nothing to fold");
});

test("file stats count changed lines from the edit inputs", () => {
  const t = run([
    {
      type: "assistant",
      message: {
        id: "m1",
        content: [
          { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/p/a.ts", old_string: "x\ny\nz", new_string: "x\nY\nY2\nz" } },
          { type: "tool_use", id: "t2", name: "Write", input: { file_path: "/p/b.md", content: "1\n2" } },
          { type: "tool_use", id: "t3", name: "Write", input: { file_path: "/p/denied.md", content: "x" } },
        ],
      },
    },
    { type: "user", message: { content: ["t1", "t2"].map((id) => ({ type: "tool_result", tool_use_id: id, content: "ok" })) } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "declined", is_error: true }] } },
  ]);
  assert.deepEqual(fileStats(t.items), { "/p/a.ts": { added: 2, removed: 1 }, "/p/b.md": { added: 2, removed: 0 } }, "only edits that went through count");
});

test("pasted images in history come back as thumbnails, an image alone still counts as a message", () => {
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
  const t = run([
    { type: "user", message: { role: "user", content: [img, { type: "text", text: "what is this?" }] } },
    { type: "user", message: { role: "user", content: [img] } },
  ]);
  assert.deepEqual(
    t.items.map((i) => [(i as any).text, (i as any).images]),
    [
      ["what is this?", ["data:image/png;base64,AAAA"]],
      ["", ["data:image/png;base64,AAAA"]],
    ],
  );
});

test("a subagent's calls are kept on its Task, and the latest TodoWrite is the todo list", () => {
  const use = (id: string, name: string, input: object, parent: string | null = null) => ({
    type: "assistant",
    message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] },
    parent_tool_use_id: parent,
  });
  const t = run([
    use("t1", "Task", { description: "Find the bug" }),
    use("s1", "Grep", { pattern: "foo" }, "t1"),
    use("s2", "Read", { file_path: "/a.ts" }, "t1"),
    use("w1", "TodoWrite", { todos: [{ content: "one", status: "pending" }] }),
    use("w2", "TodoWrite", { todos: [{ content: "one", status: "completed" }, { content: "two", status: "in_progress", activeForm: "Doing two" }] }),
  ]);
  const task = t.items.find((i) => i.kind === "tool" && i.name === "Task") as any;
  assert.equal(task.steps, 2);
  assert.deepEqual(task.sub.map((s: any) => s.name), ["Grep", "Read"]);
  assert.deepEqual(latestTodos(t.items)?.map((x) => x.status), ["completed", "in_progress"]);
  assert.equal(latestTodos([]), null);
});
