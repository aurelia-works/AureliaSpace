import { test } from "node:test";
import assert from "node:assert/strict";
import { toolPhrase } from "./toolPhrase.ts";

const t = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

test("commands and edits lead, files count once", () => {
  const tools = [t("Read", { file_path: "a" }), t("Bash"), t("Edit", { file_path: "a" }), t("Edit", { file_path: "a" }), t("Write", { file_path: "b" }), t("Bash")];
  assert.equal(toolPhrase(tools), "Ran 2 commands, edited 2 files and 1 more");
});

test("singulars and a lone kind", () => {
  assert.equal(toolPhrase([t("Bash")]), "Ran 1 command");
  assert.equal(toolPhrase([t("Grep"), t("Glob"), t("Read", { file_path: "x" })]), "Read 1 file, searched 2 times");
});

test("unknown tools count as more, or stand alone", () => {
  assert.equal(toolPhrase([t("Agent"), t("mcp__x__y"), t("TodoWrite")]), "Started 1 agent and 2 more");
  assert.equal(toolPhrase([t("mcp__x__y"), t("TodoWrite")]), "2 tools");
});
